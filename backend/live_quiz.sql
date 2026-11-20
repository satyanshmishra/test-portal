-- =====================================================================
--  LIVE QUIZ for test.satyansh.blog
--  Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
--  It is safe to run again later (it only replaces functions / adds what is missing).
--
--  After running it, add your own login email as the quiz host (one line, run separately):
--     insert into public.live_admins(email) values ('your-email@example.com') on conflict do nothing;
--
--  Run backend/spam_guard.sql first (spam check, real names, blocked accounts).
--
--  Students never see correct answers before the host reveals them:
--  answers are stored in live_keys, which nobody can read directly;
--  checking and scoring happen inside the database functions below.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.live_admins (
  email text primary key
);

create table if not exists public.live_sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  host        uuid not null,
  title       text not null default 'Live Quiz',
  status      text not null default 'lobby',      -- lobby | question | reveal | board | ended
  q_index     int  not null default -1,
  q_total     int  not null default 0,
  q_public    jsonb,                               -- current question WITHOUT its answer
  starts_at   timestamptz,
  ends_at     timestamptz,
  reveal      jsonb,                               -- filled only after the host reveals
  board       jsonb,                               -- top 10 leaderboard
  settings    jsonb not null default '{}'::jsonb,
  v           int  not null default 0,             -- bumped on every change (students poll this)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists live_sessions_code_idx on public.live_sessions(code);

create table if not exists public.live_keys (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  q_index    int  not null,
  type       text not null default 'mcq',
  ans        text not null,
  tol        numeric,
  q          text,          -- question / options / solution: shown to students only in their
  opts       jsonb,         -- Results section after the quiz has ended
  sol        text,
  dur        int,
  primary key (session_id, q_index)
);
-- for databases where the first version was already run
alter table public.live_keys add column if not exists q    text;
alter table public.live_keys add column if not exists opts jsonb;
alter table public.live_keys add column if not exists sol  text;
alter table public.live_keys add column if not exists dur  int;

create table if not exists public.live_players (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  user_id    uuid not null,
  name       text not null,
  score      int  not null default 0,
  streak     int  not null default 0,
  correct    int  not null default 0,
  answered   int  not null default 0,
  total_ms   bigint not null default 0,
  rank       int,
  prev_rank  int,
  joined_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table public.live_players add column if not exists banned   boolean not null default false;  -- removed by the host
alter table public.live_players add column if not exists flag     int     not null default 0;      -- spam score of the name
alter table public.live_players add column if not exists flag_why jsonb;

create table if not exists public.live_answers (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  q_index    int  not null,
  user_id    uuid not null,
  answer     text not null,
  correct    boolean not null,
  base       int not null default 0,
  points     int not null default 0,
  ms         int not null default 0,
  at         timestamptz not null default now(),
  primary key (session_id, q_index, user_id)
);

-- ---------- row level security ----------
alter table public.live_admins  enable row level security;   -- no policies: nobody reads it directly
alter table public.live_keys    enable row level security;   -- no policies: answers stay hidden
alter table public.live_answers enable row level security;   -- no policies: read only through functions
alter table public.live_sessions enable row level security;
alter table public.live_players  enable row level security;

drop policy if exists live_sessions_read on public.live_sessions;
create policy live_sessions_read on public.live_sessions
  for select to authenticated using (true);

-- ---------- helpers ----------
create or replace function public.live_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from live_admins
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

drop policy if exists live_players_read on public.live_players;
create policy live_players_read on public.live_players
  for select to authenticated using (user_id = auth.uid() or public.live_is_admin());

create or replace function public.live_now() returns timestamptz
language sql stable as $$ select now(); $$;

create or replace function public.live_host_(p uuid) returns public.live_sessions
language plpgsql security definer set search_path = public as $$
declare s live_sessions;
begin
  select * into s from live_sessions where id = p;
  if not found then raise exception 'Quiz not found'; end if;
  if s.host <> auth.uid() or not live_is_admin() then raise exception 'Only the quiz host can do this'; end if;
  return s;
end $$;

-- ---------- host: create a quiz ----------
-- p_keys: [{"type":"mcq","ans":"2","q":"...","opts":[...],"sol":"...","dur":30}, {"type":"num","ans":"3.5","tol":0.01,...}]  (in order)
-- p_settings: {"neg":true,"negPts":250,"streak":true}
create or replace function public.live_create(p_title text, p_keys jsonb, p_settings jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; i int := 0; k jsonb;
begin
  if not live_is_admin() then raise exception 'This account is not set as a quiz host'; end if;
  if jsonb_typeof(p_keys) <> 'array' or jsonb_array_length(p_keys) = 0 then raise exception 'No questions selected'; end if;
  if jsonb_array_length(p_keys) > 200 then raise exception 'At most 200 questions in one live quiz'; end if;

  -- old unfinished quizzes of this host are closed
  update live_sessions set status = 'ended', v = v + 1, updated_at = now()
   where host = auth.uid() and status <> 'ended';

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from live_sessions where code = v_code and status <> 'ended');
  end loop;

  insert into live_sessions(code, host, title, q_total, settings)
  values (v_code, auth.uid(), left(coalesce(nullif(trim(p_title), ''), 'Live Quiz'), 120),
          jsonb_array_length(p_keys), coalesce(p_settings, '{}'::jsonb))
  returning id into v_id;

  for k in select value from jsonb_array_elements(p_keys) loop
    insert into live_keys(session_id, q_index, type, ans, tol, q, opts, sol, dur)
    values (v_id, i, coalesce(k ->> 'type', 'mcq'), coalesce(k ->> 'ans', ''), nullif(k ->> 'tol', '')::numeric,
            k ->> 'q', case when jsonb_typeof(k -> 'opts') = 'array' then k -> 'opts' end, k ->> 'sol', nullif(k ->> 'dur', '')::int);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- ---------- host: show a question ----------
create or replace function public.live_show(p_session uuid, p_index int, p_public jsonb, p_dur int, p_lead int default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions; lead int := greatest(0, least(coalesce(p_lead, 3), 10)); dur int := greatest(5, least(coalesce(p_dur, 30), 900));
begin
  s := live_host_(p_session);
  if p_index < 0 or p_index >= s.q_total then raise exception 'Wrong question number'; end if;
  update live_sessions
     set status = 'question', q_index = p_index, q_public = p_public, reveal = null,
         starts_at = now() + make_interval(secs => lead),
         ends_at   = now() + make_interval(secs => lead + dur),
         v = v + 1, updated_at = now()
   where id = p_session
  returning jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at, 'now', now()) into p_public;
  return p_public;
end $$;

-- ---------- student: join with a code ----------
-- The name always comes from the account (Google name, else the sign-up name); p_name is ignored.
-- settings.locked = no new players, settings.googleOnly = only accounts that signed in with Google.
create or replace function public.live_join(p_code text, p_name text default '')
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare s live_sessions; p live_players; nm text; r jsonb; sc int; was boolean;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if exists (select 1 from blocked_users where user_id = auth.uid()) then
    raise exception 'BLOCKED: This account was marked as spam. Please log in with your real name and your own email.';
  end if;
  select * into s from live_sessions
   where code = trim(coalesce(p_code, '')) and status <> 'ended'
   order by created_at desc limit 1;
  if not found then raise exception 'No live quiz is running with this code'; end if;

  select * into p from live_players where session_id = s.id and user_id = auth.uid();
  was := found;
  if was and p.banned then raise exception 'REMOVED: The host has removed you from this quiz.'; end if;
  if not was and coalesce((s.settings ->> 'locked')::boolean, false) then
    raise exception 'Entry is closed for this quiz. Ask your teacher.';
  end if;
  if not was and coalesce((s.settings ->> 'googleOnly')::boolean, false)
     and not exists (select 1 from auth.identities where user_id = auth.uid() and provider = 'google') then
    raise exception 'GOOGLE: For this quiz, log in with "Continue with Google".';
  end if;

  nm := public.real_name(auth.uid());
  begin
    r := public.spam_check(nm, auth.jwt() ->> 'email'); sc := coalesce((r ->> 'score')::int, 0);
  exception when others then r := null; sc := 0;
  end;
  insert into live_players(session_id, user_id, name, rank, flag, flag_why)
  values (s.id, auth.uid(), nm, null, sc, r -> 'reasons')
  on conflict (session_id, user_id) do update set name = excluded.name, flag = excluded.flag, flag_why = excluded.flag_why;
  if not was and sc >= 3 then
    begin
      insert into spam_alerts(user_id, email, name, score, reasons, source, session_id)
      values (auth.uid(), auth.jwt() ->> 'email', nm, sc, r -> 'reasons', 'live_join', s.id);
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title, 'code', s.code, 'name', nm);
end $$;

-- ---------- student: answer ----------
create or replace function public.live_submit(p_session uuid, p_index int, p_answer text)
returns text language plpgsql security definer set search_path = public as $$
declare s live_sessions; k live_keys; p live_players; ok boolean := false; ms int; dur numeric; b int;
        a text := left(trim(coalesce(p_answer, '')), 20);
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into s from live_sessions where id = p_session;
  if not found or s.status <> 'question' or s.q_index <> p_index then return 'closed'; end if;
  if now() < s.starts_at then return 'early'; end if;
  if now() > s.ends_at + interval '1.5 seconds' then return 'late'; end if;
  select * into p from live_players where session_id = p_session and user_id = auth.uid();
  if not found then return 'not_joined'; end if;
  if p.banned then return 'banned'; end if;
  if a = '' then return 'empty'; end if;

  select * into k from live_keys where session_id = p_session and q_index = p_index;
  if k.type = 'mcq' then
    ok := a ~ '^\d+$' and k.ans ~ '^\d+$' and a::int = k.ans::int;
  else
    ok := a ~ '^-?\d+(\.\d+)?$' and k.ans ~ '^-?\d+(\.\d+)?$'
          and abs(a::numeric - k.ans::numeric) <= coalesce(k.tol, 0.001) + 0.000000001;
  end if;

  ms  := greatest(0, floor(extract(epoch from (now() - s.starts_at)) * 1000))::int;
  dur := greatest(1, extract(epoch from (s.ends_at - s.starts_at)) * 1000);
  if ok then b := round(1000 * (1 - 0.5 * least(1, ms / dur)));            -- 1000 (instant) … 500 (last second)
  elsif coalesce((s.settings ->> 'neg')::boolean, false) then b := -abs(coalesce((s.settings ->> 'negPts')::int, 250));
  else b := 0; end if;

  insert into live_answers(session_id, q_index, user_id, answer, correct, base, points, ms)
  values (p_session, p_index, auth.uid(), a, ok, b, b, ms)
  on conflict do nothing;
  if not found then return 'dup'; end if;
  return 'ok';
end $$;

-- ---------- names on the shared screen: a flagged name is never shown ----------
create or replace function public.live_show_name_(p_name text, p_flag int) returns text
language sql immutable as $$ select case when coalesce(p_flag, 0) >= 6 then 'Hidden name' else p_name end; $$;

create or replace function public.live_board_(p_session uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', live_show_name_(name, flag), 'score', score, 'rank', rank,
                                               'prev', prev_rank, 'streak', streak) order by rank, name), '[]'::jsonb)
    from (select * from live_players where session_id = p_session and not banned and rank is not null
           order by rank, name limit 10) t;
$$;

-- ---------- host: stop the timer and reveal ----------
create or replace function public.live_reveal(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions; k live_keys; st boolean; dist jsonb; fastest jsonb; brd jsonb;
        n_ans int; n_ok int; n_pl int; rv jsonb;
begin
  s := live_host_(p_session);
  if s.status <> 'question' then return jsonb_build_object('reveal', s.reveal, 'board', s.board); end if;
  select * into k from live_keys where session_id = p_session and q_index = s.q_index;
  st := coalesce((s.settings ->> 'streak')::boolean, true);

  -- streak bonus: +100 for each earlier correct answer in a row (max +500)
  update live_answers a
     set points = a.base + case when st and a.correct then least(p.streak, 5) * 100 else 0 end
    from live_players p
   where a.session_id = p_session and a.q_index = s.q_index
     and p.session_id = a.session_id and p.user_id = a.user_id;

  update live_players p
     set score    = p.score + x.pts,
         streak   = case when x.ok then p.streak + 1 else 0 end,
         correct  = p.correct + case when x.ok then 1 else 0 end,
         answered = p.answered + case when x.did then 1 else 0 end,
         total_ms = p.total_ms + case when x.ok then x.ms else 0 end
    from (select pl.user_id, an.user_id is not null as did, coalesce(an.correct, false) as ok,
                 coalesce(an.points, 0) as pts, coalesce(an.ms, 0) as ms
            from live_players pl
            left join live_answers an on an.session_id = pl.session_id and an.user_id = pl.user_id and an.q_index = s.q_index
           where pl.session_id = p_session and not pl.banned) x
   where p.session_id = p_session and p.user_id = x.user_id;

  update live_players p set prev_rank = p.rank, rank = r.rk
    from (select user_id, rank() over (order by score desc, total_ms asc) as rk
            from live_players where session_id = p_session and not banned) r
   where p.session_id = p_session and p.user_id = r.user_id;

  select coalesce(jsonb_object_agg(answer, c), '{}'::jsonb) into dist
    from (select answer, count(*) c from live_answers where session_id = p_session and q_index = s.q_index group by answer) d;
  select count(*), count(*) filter (where correct) into n_ans, n_ok
    from live_answers where session_id = p_session and q_index = s.q_index;
  select count(*) into n_pl from live_players where session_id = p_session and not banned;
  select jsonb_build_object('name', live_show_name_(p.name, p.flag), 'ms', a.ms) into fastest
    from live_answers a join live_players p on p.session_id = a.session_id and p.user_id = a.user_id
   where a.session_id = p_session and a.q_index = s.q_index and a.correct and not p.banned
   order by a.ms asc limit 1;
  brd := live_board_(p_session);

  rv := jsonb_build_object('q', s.q_index, 'type', k.type, 'ans', k.ans, 'tol', k.tol, 'dist', dist,
                           'answered', n_ans, 'correct', n_ok, 'players', n_pl, 'fastest', fastest);
  update live_sessions
     set status = 'reveal', reveal = rv, board = brd, ends_at = least(ends_at, now()), v = v + 1, updated_at = now()
   where id = p_session;
  return jsonb_build_object('reveal', rv, 'board', brd);
end $$;

-- ---------- host: change screen (board / ended) ----------
create or replace function public.live_stage(p_session uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare s live_sessions;
begin
  s := live_host_(p_session);
  if p_status not in ('lobby', 'board', 'ended') then raise exception 'Unknown stage'; end if;
  update live_sessions set status = p_status, v = v + 1, updated_at = now() where id = p_session;
end $$;

-- ---------- host: live counts while a question is open (and lobby names) ----------
-- names: only names safe to show on the shared screen; flagged: how many need a look (no names)
create or replace function public.live_host_stats(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions; r jsonb;
begin
  s := live_host_(p_session);
  select jsonb_build_object(
    'players',  (select count(*) from live_players where session_id = p_session and not banned),
    'answered', (select count(*) from live_answers a join live_players p on p.session_id = a.session_id and p.user_id = a.user_id
                  where a.session_id = p_session and a.q_index = s.q_index and not p.banned),
    'names',    case when coalesce((s.settings ->> 'hideNames')::boolean, false) then '[]'::jsonb else
                (select coalesce(jsonb_agg(name order by joined_at), '[]'::jsonb)
                   from (select name, joined_at from live_players
                          where session_id = p_session and not banned and flag < 6 order by joined_at limit 300) n) end,
    'flagged',  (select count(*) from live_players where session_id = p_session and not banned and flag >= 3),
    'settings', s.settings,
    'now', now())
  into r;
  return r;
end $$;

-- ---------- student: my score, rank and last answer ----------
create or replace function public.live_me(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions; p live_players; a live_answers; last jsonb;
begin
  select * into s from live_sessions where id = p_session;
  if not found then raise exception 'Quiz not found'; end if;
  select * into p from live_players where session_id = p_session and user_id = auth.uid();
  if not found then return jsonb_build_object('joined', false); end if;
  if p.banned then return jsonb_build_object('joined', true, 'banned', true, 'name', p.name); end if;
  select * into a from live_answers where session_id = p_session and user_id = auth.uid() and q_index = s.q_index;
  if found then
    if s.status = 'question' then last := jsonb_build_object('q', a.q_index, 'answer', a.answer);
    else last := jsonb_build_object('q', a.q_index, 'answer', a.answer, 'correct', a.correct, 'points', a.points, 'ms', a.ms);
    end if;
  end if;
  return jsonb_build_object('joined', true, 'name', p.name, 'score', p.score, 'rank', p.rank, 'prev', p.prev_rank,
                            'streak', p.streak, 'correct', p.correct, 'answered', p.answered,
                            'players', (select count(*) from live_players where session_id = p_session and not banned),
                            'last', last);
end $$;

-- ---------- host: full results (for CSV download) ----------
create or replace function public.live_results(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions; r jsonb;
begin
  s := live_host_(p_session);
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.name, 'score', p.score, 'rank', p.rank, 'correct', p.correct, 'answered', p.answered,
           'removed', p.banned, 'flag', p.flag,
           'avg_ms', case when p.correct > 0 then p.total_ms / p.correct else null end,
           'email', (select email from auth.users u where u.id = p.user_id),
           'answers', (select coalesce(jsonb_object_agg(a.q_index::text,
                              jsonb_build_object('a', a.answer, 'c', a.correct, 'p', a.points, 'ms', a.ms)), '{}'::jsonb)
                         from live_answers a where a.session_id = p.session_id and a.user_id = p.user_id)
         ) order by p.rank nulls last, p.name), '[]'::jsonb)
    into r from live_players p where p.session_id = p_session;
  return jsonb_build_object('title', s.title, 'code', s.code, 'q_total', s.q_total, 'created_at', s.created_at, 'players', r);
end $$;

-- only logged-in users may call the functions
revoke execute on function public.live_create(text, jsonb, jsonb), public.live_show(uuid, int, jsonb, int, int),
                           public.live_join(text, text), public.live_submit(uuid, int, text), public.live_reveal(uuid),
                           public.live_stage(uuid, text), public.live_host_stats(uuid), public.live_me(uuid),
                           public.live_results(uuid), public.live_host_(uuid)
  from public, anon;
grant execute on function public.live_create(text, jsonb, jsonb), public.live_show(uuid, int, jsonb, int, int),
                          public.live_join(text, text), public.live_submit(uuid, int, text), public.live_reveal(uuid),
                          public.live_stage(uuid, text), public.live_host_stats(uuid), public.live_me(uuid),
                          public.live_results(uuid), public.live_now(), public.live_is_admin()
  to authenticated;

-- ---------- host: add or cut time while a question is open ----------
create or replace function public.live_extend(p_session uuid, p_secs int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions; e timestamptz;
begin
  s := live_host_(p_session);
  if s.status <> 'question' then raise exception 'No question is running'; end if;
  e := greatest(s.ends_at + make_interval(secs => greatest(-600, least(coalesce(p_secs, 0), 600))),
                greatest(now(), s.starts_at) + interval '3 seconds');
  update live_sessions set ends_at = e, v = v + 1, updated_at = now() where id = p_session;
  return jsonb_build_object('starts_at', s.starts_at, 'ends_at', e, 'now', now());
end $$;

-- ---------- student: my finished live quizzes (for the Results section) ----------
create or replace function public.live_my_history()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title', s.title, 'at', s.created_at,
           'questions', least(s.q_index + 1, s.q_total), 'score', p.score, 'rank', p.rank,
           'correct', p.correct, 'answered', p.answered,
           'players', (select count(*) from live_players x where x.session_id = s.id))
         order by s.created_at desc), '[]'::jsonb)
    from live_players p join live_sessions s on s.id = p.session_id
   where p.user_id = auth.uid() and s.q_index >= 0
     and (s.status = 'ended' or s.updated_at < now() - interval '6 hours');
$$;

-- ---------- student: full review of one finished live quiz ----------
create or replace function public.live_my_review(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions; p live_players; qs jsonb; an jsonb;
begin
  select * into s from live_sessions where id = p_session;
  if not found then raise exception 'Quiz not found'; end if;
  if not (s.status = 'ended' or s.updated_at < now() - interval '6 hours') then raise exception 'This quiz is still running'; end if;
  select * into p from live_players where session_id = p_session and user_id = auth.uid();
  if not found and not live_is_admin() then raise exception 'You did not play this quiz'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'q', q, 'opts', opts, 'ans', ans, 'tol', tol, 'sol', sol, 'dur', dur)
                  order by q_index), '[]'::jsonb) into qs
    from live_keys where session_id = p_session and q_index <= s.q_index;
  select coalesce(jsonb_object_agg(q_index::text, jsonb_build_object('a', answer, 'c', correct, 'p', points, 'ms', ms)), '{}'::jsonb) into an
    from live_answers where session_id = p_session and user_id = auth.uid();
  return jsonb_build_object('id', s.id, 'title', s.title, 'at', s.created_at, 'settings', s.settings, 'questions', qs, 'answers', an,
                            'score', p.score, 'rank', p.rank, 'correct', p.correct,
                            'players', (select count(*) from live_players where session_id = p_session));
end $$;

revoke execute on function public.live_extend(uuid, int), public.live_my_history(), public.live_my_review(uuid) from public, anon;
grant execute on function public.live_extend(uuid, int), public.live_my_history(), public.live_my_review(uuid) to authenticated;

-- =====================================================================
--  HOST CONTROL (live-control.html — open it on the phone while the laptop shares the screen)
-- =====================================================================

-- the host's running quiz (newest), so the phone finds it without typing anything
create or replace function public.live_active()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s live_sessions;
begin
  if not live_is_admin() then raise exception 'Only the quiz host can do this'; end if;
  select * into s from live_sessions where host = auth.uid() and status <> 'ended' order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', s.id, 'code', s.code, 'title', s.title, 'status', s.status, 'q_index', s.q_index,
                            'q_total', s.q_total, 'settings', s.settings);
end $$;

-- every player with email, score and spam flag
create or replace function public.live_players_admin(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare s live_sessions; r jsonb;
begin
  s := live_host_(p_session);
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.user_id, 'name', p.name, 'email', u.email, 'score', p.score, 'rank', p.rank,
           'correct', p.correct, 'answered', p.answered, 'joined_at', p.joined_at, 'banned', p.banned,
           'flag', p.flag, 'why', p.flag_why,
           'google', exists (select 1 from auth.identities i where i.user_id = p.user_id and i.provider = 'google'),
           'blocked', exists (select 1 from blocked_users b where b.user_id = p.user_id))
         order by p.banned, p.flag desc, p.joined_at desc), '[]'::jsonb)
    into r
    from live_players p left join auth.users u on u.id = p.user_id
   where p.session_id = p_session;
  return jsonb_build_object('status', s.status, 'q_index', s.q_index, 'q_total', s.q_total, 'code', s.code,
                            'title', s.title, 'settings', s.settings, 'players', r, 'now', now());
end $$;

-- ranks and leaderboard again, without removed players
create or replace function public.live_rerank_(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update live_players set rank = null where session_id = p_session and banned;
  update live_players p set rank = r.rk
    from (select user_id, rank() over (order by score desc, total_ms asc) as rk
            from live_players where session_id = p_session and not banned and rank is not null) r
   where p.session_id = p_session and p.user_id = r.user_id;
  update live_sessions set board = live_board_(p_session) where id = p_session and board is not null;
end $$;

-- remove (p_ban = true) or bring back (false) a player
create or replace function public.live_kick(p_session uuid, p_user uuid, p_ban boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions;
begin
  s := live_host_(p_session);
  update live_players set banned = p_ban where session_id = p_session and user_id = p_user;
  if not found then raise exception 'This player is not in the quiz'; end if;
  if p_ban then delete from live_answers where session_id = p_session and user_id = p_user and q_index = s.q_index; end if;
  perform live_rerank_(p_session);
  -- kv tells the removed phone to check itself (one small refresh for everyone)
  update live_sessions
     set settings = jsonb_set(settings, '{kv}', to_jsonb(coalesce((settings ->> 'kv')::int, 0) + 1)),
         v = v + 1, updated_at = now()
   where id = p_session;
  return jsonb_build_object('ok', true);
end $$;

-- switches: locked (no new players), googleOnly, hideNames (lobby names off the shared screen)
create or replace function public.live_set(p_session uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s live_sessions; k text; st jsonb;
begin
  s := live_host_(p_session);
  st := s.settings;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k in ('locked', 'googleOnly', 'hideNames') then
      st := jsonb_set(st, array[k], to_jsonb(coalesce((p_patch ->> k)::boolean, false)));
    end if;
  end loop;
  update live_sessions set settings = st, updated_at = now() where id = p_session;   -- no v bump: students need not reload
  return st;
end $$;

revoke execute on function public.live_active(), public.live_players_admin(uuid), public.live_kick(uuid, uuid, boolean),
                           public.live_set(uuid, jsonb), public.live_rerank_(uuid), public.live_board_(uuid)
  from public, anon;
grant execute on function public.live_active(), public.live_players_admin(uuid), public.live_kick(uuid, uuid, boolean),
                          public.live_set(uuid, jsonb)
  to authenticated;

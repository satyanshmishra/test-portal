-- =====================================================================
--  TEST PAPERS + RESULTS IN SUPABASE  (replaces the Google Sheet / Apps Script)
--  Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
--  Safe to run again (nothing is deleted).
--  Needs live_quiz.sql (already run): the teacher account is the one in live_admins.
--
--  tp_papers    one row per paper; the full paper JSON (with answers) is in "data"
--  tp_attempts  one row per submitted test (same columns as the old Results sheet)
--  tp_logins    one row per student login
--
--  Nobody reads these tables directly (RLS on, no policies). Students and the
--  teacher use the functions below:
--    * timed tests reach the student WITHOUT answers and solutions; the server
--      grades the test and sends the answer key back only after submitting
--    * Practice Sheets (not "Timed Test") come with answers, since they are
--      checked instantly on the sheet page
-- =====================================================================

-- ---------- tables ----------
create table if not exists public.tp_papers (
  id           text primary key,
  name         text not null,
  exam         text not null default '',
  subject      text not null default '',
  duration_min int  not null default 60,
  n_questions  int  not null default 0,
  max_marks    numeric not null default 0,
  active       boolean not null default true,
  ord          int  not null default 0,
  category     text not null default 'topic',
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.tp_attempts (
  id          bigserial primary key,
  user_id     uuid,                       -- empty only for old results that matched no account
  email       text not null default '',
  phone       text not null default '',
  name        text not null default '',
  paper_id    text not null,
  paper_name  text not null default '',
  score       numeric not null default 0,
  max_marks   numeric not null default 0,
  pct         numeric not null default 0,
  correct     int not null default 0,
  wrong       int not null default 0,
  skipped     int not null default 0,
  accuracy    int not null default 0,
  minutes     numeric not null default 0,
  auto        boolean not null default false,
  strong      text not null default '',
  weak        text not null default '',
  qwise       text not null default '',
  status      text not null default '',   -- '' | 'Extra attempt' | 'Reopened <time>'
  data        jsonb not null default '{}'::jsonb,   -- {ans, mark, time, auto, taken, submitAt, start}
  submit_at   bigint,                     -- the browser's submit time (ms): a resent submission is stored once
  sheet_row   int unique,                 -- row number in the old Results sheet (migration only)
  created_at  timestamptz not null default now()
);
create index if not exists tp_attempts_user  on public.tp_attempts(user_id, paper_id);
create index if not exists tp_attempts_paper on public.tp_attempts(paper_id);
create index if not exists tp_attempts_nouser on public.tp_attempts(phone, email) where user_id is null;

create table if not exists public.tp_logins (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  user_id uuid,
  name    text not null default '',
  phone   text not null default '',
  email   text not null default ''
);

alter table public.tp_papers   enable row level security;
alter table public.tp_attempts enable row level security;
alter table public.tp_logins   enable row level security;

-- ---------- small helpers ----------
-- number from text, like JavaScript parseFloat ("12.5", " -3", "4abc" → 4); null when there is none
create or replace function public.tp_num(t text) returns numeric
language sql immutable as $$
  select (substring(coalesce(t, '') from '^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)'))::numeric
$$;

create or replace function public.tp_phone(p text) returns text
language sql immutable as $$
  select case
    when length(d) = 12 and left(d, 2) = '91' then substr(d, 3)
    when length(d) = 11 and left(d, 1) = '0'  then substr(d, 2)
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function public.tp_ist(t timestamptz) returns text
language sql immutable as $$ select to_char(t at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') $$;

-- a Practice Sheet (instant checking, answers in the browser) — not a "Timed Test" kept in that folder
create or replace function public.tp_is_practice(cat text, exam text) returns boolean
language sql immutable as $$ select coalesce(cat, '') = 'sheet' and coalesce(exam, '') !~* 'timed test' $$;

create or replace function public.tp_clean_cat(c text, dur numeric) returns text
language sql immutable as $$
  select case when lower(trim(coalesce(c, ''))) in ('topic', 'full', 'main3h', 'sheet') then lower(trim(c))
              when coalesce(dur, 0) >= 180 then 'main3h' else 'topic' end
$$;

create or replace function public.tp_base36(n bigint) returns text
language plpgsql immutable as $$
declare s text := ''; d text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
begin
  if n = 0 then return '0'; end if;
  while n > 0 loop s := substr(d, (n % 36)::int + 1, 1) || s; n := n / 36; end loop;
  return s;
end $$;

-- maximum marks ("attempt any N" sections count only N questions)
create or replace function public.tp_max_marks(d jsonb) returns numeric
language sql immutable as $$
  with secs as (select s from jsonb_array_elements(coalesce(d->'sections', '[]'::jsonb)) s),
       cnt  as (select q->>'section' as sid, count(*) as n
                from jsonb_array_elements(coalesce(d->'questions', '[]'::jsonb)) q group by 1)
  select case
    when not exists (select 1 from secs) then 4 * jsonb_array_length(coalesce(d->'questions', '[]'::jsonb))
    else coalesce((select sum(
           (case when coalesce(tp_num(s->>'maxAttempt'), 0) > 0
                 then least(tp_num(s->>'maxAttempt'), coalesce(c.n, 0)) else coalesce(c.n, 0) end)
           * coalesce(tp_num(s->>'correct'), 4))
         from secs left join cnt c on c.sid = s->>'id'), 0)
  end
$$;

-- the same marking as the test page (and the old Apps Script)
create or replace function public.tp_grade(d jsonb, ans jsonb) returns jsonb
language plpgsql immutable as $$
declare
  secs jsonb := '{}'::jsonb; s jsonb; q jsonb; i int; used jsonb := '{}'::jsonb; sid text;
  corr numeric; wr numeric; cap numeric; av text; bonus boolean; att boolean; ok boolean; m numeric;
  v numeric; key numeric; tol numeric;
  score numeric := 0; c int := 0; w int := 0; u int := 0; marks jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(ans) is distinct from 'array' then ans := '[]'::jsonb; end if;
  for s in select value from jsonb_array_elements(coalesce(d->'sections', '[]'::jsonb)) loop
    secs := secs || jsonb_build_object(coalesce(s->>'id', ''), s);
  end loop;
  for q, i in select value, (ordinality - 1)::int from jsonb_array_elements(coalesce(d->'questions', '[]'::jsonb)) with ordinality order by ordinality loop
    sid := coalesce(q->>'section', '');
    s := secs->sid;
    if s is null then corr := 4; wr := -1; cap := 0;
    else corr := coalesce(tp_num(s->>'correct'), 0); wr := coalesce(tp_num(s->>'wrong'), 0);
         cap := greatest(coalesce(tp_num(s->>'maxAttempt'), 0), 0); end if;
    av := case when ans->i is null or jsonb_typeof(ans->i) = 'null' then null else ans->>i end;
    if av = '' then av := null; end if;
    bonus := lower(coalesce(q->>'bonus', '')) in ('true', '1', 'yes');
    att := bonus or av is not null;
    if cap > 0 and att then
      used := used || jsonb_build_object(sid, coalesce((used->>sid)::int, 0) + 1);
      if (used->>sid)::int > cap then av := null; bonus := false; end if;   -- over the "attempt any N" limit: not counted
    end if;
    m := 0;
    if bonus then c := c + 1; m := corr;                                    -- NTA bonus question: full marks to everyone
    elsif av is null then u := u + 1;
    else
      key := tp_num(q->>'ans');
      if q->>'type' = 'mcq' then
        ok := av ~ '^\s*[+-]?\d+(\.\d+)?\s*$' and key is not null and av::numeric = key;
      else
        v := tp_num(av); tol := coalesce(tp_num(q->>'tol'), 0.001);
        ok := v is not null and key is not null and abs(v - key) <= tol + 0.000000001;
      end if;
      if ok then c := c + 1; m := corr; else w := w + 1; m := wr; end if;
    end if;
    marks := marks || to_jsonb(m); score := score + m;
  end loop;
  return jsonb_build_object('score', score, 'c', c, 'w', w, 'u', u, 'marks', marks);
end $$;

-- paper as the browser uses it: {id, settings{..., category}, sections, instructions, questions}
create or replace function public.tp_full(p public.tp_papers) returns jsonb
language sql stable as $$
  select (p.data - 'id' - 'keyHidden')
         || jsonb_build_object('id', p.id,
                               'settings', coalesce(p.data->'settings', '{}'::jsonb) || jsonb_build_object('category', p.category))
$$;

-- the same paper with answers and solutions taken out (timed tests before submitting)
create or replace function public.tp_strip(d jsonb) returns jsonb
language sql immutable as $$
  select d || jsonb_build_object('keyHidden', true, 'questions',
    coalesce((select jsonb_agg(q - 'ans' - 'sol' - 'tol' - 'solution' - 'explanation' order by n)
              from jsonb_array_elements(coalesce(d->'questions', '[]'::jsonb)) with ordinality t(q, n)), '[]'::jsonb))
$$;

create or replace function public.tp_item(p public.tp_papers) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'exam', p.exam, 'subject', p.subject,
    'durationMin', p.duration_min, 'questions', p.n_questions, 'maxMarks', p.max_marks, 'active', p.active,
    'order', p.ord, 'created', tp_ist(p.created_at), 'updated', tp_ist(p.updated_at), 'category', p.category)
$$;

-- ---------- who is calling ----------
-- {id, email, name, phone} of the logged-in student (email must be confirmed)
create or replace function public.tp_auth() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u record;
begin
  if auth.uid() is null then raise exception 'AUTH: Please log in again.'; end if;
  select id, email, email_confirmed_at, raw_user_meta_data as m into u from auth.users where id = auth.uid();
  if not found or u.email is null then raise exception 'AUTH: Please log in again.'; end if;
  if u.email_confirmed_at is null then raise exception 'AUTH: Please confirm your email first.'; end if;
  return jsonb_build_object('id', u.id, 'email', lower(u.email),
    'name', left(trim(coalesce(u.m->>'full_name', u.m->>'name', '')), 80),
    'phone', tp_phone(u.m->>'phone'));
end $$;

-- is this result one of this student's? (old results without an account match by email or phone)
create or replace function public.tp_mine(a public.tp_attempts, me jsonb) returns boolean
language sql immutable as $$
  select case when a.user_id is not null then a.user_id = (me->>'id')::uuid
              else (a.email <> '' and a.email = me->>'email') or (a.phone <> '' and a.phone = me->>'phone') end
$$;

create or replace function public.tp_admin_check() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regprocedure('public.live_is_admin()') is null or not public.live_is_admin() then
    raise exception 'Only the teacher account can do this';
  end if;
end $$;

-- =====================================================================
--  STUDENTS
-- =====================================================================
create or replace function public.tp_papers_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform tp_auth();
  return coalesce((select jsonb_agg(tp_item(p) order by p.ord, p.created_at) from tp_papers p where p.active), '[]'::jsonb);
end $$;

create or replace function public.tp_paper(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p tp_papers;
begin
  perform tp_auth();
  select * into p from tp_papers where id = p_id and active;
  if not found then raise exception 'Paper not found'; end if;
  if tp_is_practice(p.category, p.exam) then return tp_full(p); end if;
  return tp_strip(tp_full(p));
end $$;

create or replace function public.tp_my_attempts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me jsonb := tp_auth();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('paperId', a.paper_id, 'paperName', a.paper_name,
             'score', a.score, 'maxMarks', a.max_marks, 'time', tp_ist(a.created_at)) order by a.id)
           from tp_attempts a where tp_mine(a, me) and a.status !~* 'reopen'), '[]'::jsonb);
end $$;

create or replace function public.tp_me(p_log boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me jsonb := tp_auth();
begin
  if p_log then
    insert into tp_logins(user_id, name, phone, email) values ((me->>'id')::uuid, me->>'name', me->>'phone', me->>'email');
  end if;
  return jsonb_build_object('ok', true, 'user', me, 'attempts', tp_my_attempts());
end $$;

-- a past attempt, with the full paper (answers + solutions) for the result and solutions pages
create or replace function public.tp_my_attempt(p_paper text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me jsonb := tp_auth(); a tp_attempts; p tp_papers;
begin
  select * into a from tp_attempts t where tp_mine(t, me) and t.paper_id = p_paper and t.status !~* 'reopen'
   order by t.id desc limit 1;
  if not found then raise exception 'No attempt found'; end if;
  select * into p from tp_papers where id = p_paper;
  return a.data || jsonb_build_object('name', a.name, 'timestamp', tp_ist(a.created_at), 'score', a.score,
                                      'paper', case when p.id is null then null else tp_full(p) end);
end $$;

-- submit a test: graded here, stored once, answer key sent back
create or replace function public.tp_submit(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me jsonb := tp_auth(); pr tp_papers; g jsonb; ans jsonb; sub bigint; fp jsonb;
  qw text; nm text; taken numeric; att int; already boolean; mx numeric;
begin
  select * into pr from tp_papers where id = p->>'paperId';
  if not found then raise exception 'Paper not found'; end if;
  ans := case when jsonb_typeof(p->'ans') = 'array' then p->'ans' else '[]'::jsonb end;
  g := tp_grade(pr.data, ans); mx := pr.max_marks; fp := tp_full(pr);
  sub := nullif(trunc(coalesce(tp_num(p->>'submitAt'), 0)), 0)::bigint;
  perform pg_advisory_xact_lock(hashtext((me->>'id') || '|' || pr.id));
  if sub is not null and exists (select 1 from tp_attempts where user_id = (me->>'id')::uuid and paper_id = pr.id and submit_at = sub) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'score', g->'score', 'maxMarks', mx, 'paper', fp);
  end if;
  already := exists (select 1 from tp_attempts a where tp_mine(a, me) and a.paper_id = pr.id and a.status !~* 'reopen');
  select string_agg('Q' || t.n || ':' || sh.s ||
           case when (g->'marks'->>(t.n::int - 1))::numeric > 0 then '✓' when sh.s = '-' then '' else '✗' end, ' ' order by t.n)
    into qw
    from jsonb_array_elements(coalesce(pr.data->'questions', '[]'::jsonb)) with ordinality t(q, n)
    cross join lateral (select case
        when ans->(t.n::int - 1) is null or jsonb_typeof(ans->(t.n::int - 1)) = 'null' or ans->>(t.n::int - 1) = '' then '-'
        when t.q->>'type' = 'mcq' then coalesce(nullif(substr('ABCDEFGH', tp_num(ans->>(t.n::int - 1))::int + 1, 1), ''), '?')
        else left(ans->>(t.n::int - 1), 20) end as s) sh;
  nm := coalesce(nullif(me->>'name', ''), left(trim(coalesce(p->>'name', '')), 80));
  taken := greatest(coalesce(tp_num(p->>'taken'), 0), 0);
  att := (g->>'c')::int + (g->>'w')::int;
  insert into tp_attempts(user_id, email, phone, name, paper_id, paper_name, score, max_marks, pct, correct, wrong, skipped,
                          accuracy, minutes, auto, strong, weak, qwise, status, data, submit_at)
  values ((me->>'id')::uuid, me->>'email', me->>'phone', nm, pr.id, pr.name, (g->>'score')::numeric, mx,
          case when mx > 0 then round((g->>'score')::numeric / mx * 100, 1) else 0 end,
          (g->>'c')::int, (g->>'w')::int, (g->>'u')::int,
          case when att > 0 then round((g->>'c')::numeric / att * 100) else 0 end,
          round(taken / 60000, 2), coalesce(p->>'auto', '') = 'true',
          left(coalesce(p->>'strong', ''), 2000), left(coalesce(p->>'weak', ''), 2000), coalesce(qw, ''),
          case when already then 'Extra attempt' else '' end,
          jsonb_build_object('ans', ans, 'mark', coalesce(p->'mark', '[]'::jsonb), 'time', coalesce(p->'time', '[]'::jsonb),
                             'auto', coalesce(p->>'auto', '') = 'true', 'taken', taken, 'submitAt', coalesce(sub, 0),
                             'start', coalesce(tp_num(p->>'start'), 0)),
          sub);
  return jsonb_build_object('ok', true, 'score', g->'score', 'maxMarks', mx, 'paper', fp);
end $$;

-- =====================================================================
--  TEACHER (admin page, upload script, live quiz host)
-- =====================================================================
create or replace function public.tp_admin_papers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform tp_admin_check();
  return coalesce((select jsonb_agg(tp_item(p) order by p.ord, p.created_at) from tp_papers p), '[]'::jsonb);
end $$;

create or replace function public.tp_admin_get(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p tp_papers;
begin
  perform tp_admin_check();
  select * into p from tp_papers where id = p_id;
  if not found then raise exception 'Paper not found'; end if;
  return tp_full(p);
end $$;

-- add a paper (p_id empty) or replace an existing one
create or replace function public.tp_admin_save(p_paper jsonb, p_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb; cat text; nid text; d jsonb; mx numeric; ms bigint;
begin
  perform tp_admin_check();
  if p_paper is null or jsonb_typeof(p_paper->'questions') <> 'array' or jsonb_array_length(p_paper->'questions') = 0 then
    raise exception 'Paper has no questions';
  end if;
  st := coalesce(p_paper->'settings', '{}'::jsonb);
  if coalesce(trim(st->>'paperName'), '') = '' then raise exception 'Paper name is required'; end if;
  cat := tp_clean_cat(st->>'category', tp_num(st->>'durationMin'));
  st := st || jsonb_build_object('category', cat);
  d := (p_paper - 'id' - 'keyHidden') || jsonb_build_object('settings', st);
  mx := tp_max_marks(d);
  if coalesce(p_id, '') <> '' then
    update tp_papers set name = st->>'paperName', exam = coalesce(st->>'exam', ''), subject = coalesce(st->>'subject', ''),
           duration_min = coalesce(tp_num(st->>'durationMin'), 60)::int, n_questions = jsonb_array_length(d->'questions'),
           max_marks = mx, category = cat, data = d, updated_at = now()
     where id = p_id;
    if not found then raise exception 'Paper not found'; end if;
    return jsonb_build_object('ok', true, 'id', p_id);
  end if;
  ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  loop
    nid := 'P' || tp_base36(ms);
    exit when not exists (select 1 from tp_papers where id = nid);
    ms := ms + 1;
  end loop;
  insert into tp_papers(id, name, exam, subject, duration_min, n_questions, max_marks, active, ord, category, data)
  values (nid, st->>'paperName', coalesce(st->>'exam', ''), coalesce(st->>'subject', ''),
          coalesce(tp_num(st->>'durationMin'), 60)::int, jsonb_array_length(d->'questions'), mx, true,
          coalesce((select max(ord) from tp_papers), 0) + 1, cat, d);
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- change active / order / category: {"active": false} {"order": 5} {"category": "sheet"}
create or replace function public.tp_admin_set(p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform tp_admin_check();
  if p_patch ? 'category' and lower(p_patch->>'category') not in ('topic', 'full', 'main3h', 'sheet') then
    raise exception 'Unknown folder';
  end if;
  update tp_papers set
    active   = case when p_patch ? 'active' then (p_patch->>'active')::boolean else active end,
    ord      = case when p_patch ? 'order' then coalesce(tp_num(p_patch->>'order'), 0)::int else ord end,
    category = case when p_patch ? 'category' then lower(p_patch->>'category') else category end,
    data     = case when p_patch ? 'category'
                    then jsonb_set(data, '{settings,category}', to_jsonb(lower(p_patch->>'category'))) else data end
   where id = p_id;
  if not found then raise exception 'Paper not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- delete a paper (results already submitted for it are kept)
create or replace function public.tp_admin_delete(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform tp_admin_check();
  delete from tp_papers where id = p_id;
  if not found then raise exception 'Paper not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tp_admin_results(p_limit int default 1000) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform tp_admin_check();
  return jsonb_build_object('ok', true, 'total', (select count(*) from tp_attempts),
    'results', coalesce((select jsonb_agg(x.o order by x.id desc) from (
       select a.id, jsonb_build_object('row', a.id, 'time', tp_ist(a.created_at), 'name', a.name, 'phone', a.phone,
         'paperId', a.paper_id, 'paperName', a.paper_name, 'score', a.score, 'maxMarks', a.max_marks, 'pct', a.pct,
         'correct', a.correct, 'wrong', a.wrong, 'skipped', a.skipped, 'accuracy', a.accuracy, 'minutes', a.minutes,
         'auto', case when a.auto then 'Yes' else 'No' end, 'status', a.status, 'email', a.email,
         'userId', coalesce(a.user_id::text, ''), 'strong', a.strong, 'weak', a.weak, 'qwise', a.qwise) as o
       from tp_attempts a order by a.id desc limit greatest(1, least(coalesce(p_limit, 1000), 20000))) x), '[]'::jsonb));
end $$;

-- let a student attempt a paper again (the old result stays, marked "Reopened")
create or replace function public.tp_admin_reopen(p_paper text, p_user text default '', p_phone text default '', p_email text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform tp_admin_check();
  update tp_attempts a set status = 'Reopened ' || tp_ist(now())
   where a.paper_id = p_paper and a.status !~* 'reopen'
     and ( (coalesce(p_user, '') <> '' and a.user_id::text = p_user)
        or (a.user_id is null and coalesce(p_email, '') <> '' and a.email = lower(p_email))
        or (a.user_id is null and tp_phone(p_phone) <> '' and a.phone = tp_phone(p_phone))
        or (coalesce(p_user, '') = '' and coalesce(p_email, '') = '' and tp_phone(p_phone) <> '' and a.phone = tp_phone(p_phone)) );
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'reopened', n);
end $$;

create or replace function public.tp_admin_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform tp_admin_check();
  return jsonb_build_object('papers', (select count(*) from tp_papers),
    'attempts', (select count(*) from tp_attempts),
    'fromSheet', (select count(*) from tp_attempts where sheet_row is not null),
    'noAccount', (select count(*) from tp_attempts where user_id is null));
end $$;

-- ---------- one-time move from the Google Sheet (tools/migrate_sheets_to_supabase.py) ----------
create or replace function public.tp_ts(t text) returns timestamptz
language plpgsql stable as $$
begin
  return coalesce(nullif(t, '')::timestamptz, now());
exception when others then return now();
end $$;

-- keeps the old paper id, so saved progress, old results and uploaded_log.json still match
create or replace function public.tp_admin_import_paper(p_id text, p_paper jsonb, p_active boolean, p_order int,
                                                        p_category text, p_created text, p_updated text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st jsonb; d jsonb; cat text;
begin
  perform tp_admin_check();
  if coalesce(p_id, '') = '' or p_paper is null or jsonb_typeof(p_paper->'questions') <> 'array' then
    raise exception 'Bad paper %', p_id;
  end if;
  st := coalesce(p_paper->'settings', '{}'::jsonb);
  cat := tp_clean_cat(coalesce(p_category, st->>'category'), tp_num(st->>'durationMin'));
  d := (p_paper - 'id' - 'keyHidden') || jsonb_build_object('settings', st || jsonb_build_object('category', cat));
  insert into tp_papers(id, name, exam, subject, duration_min, n_questions, max_marks, active, ord, category, data, created_at, updated_at)
  values (p_id, coalesce(nullif(st->>'paperName', ''), p_id), coalesce(st->>'exam', ''), coalesce(st->>'subject', ''),
          coalesce(tp_num(st->>'durationMin'), 60)::int, jsonb_array_length(d->'questions'), tp_max_marks(d),
          coalesce(p_active, true), coalesce(p_order, 0), cat, d, tp_ts(p_created), tp_ts(p_updated))
  on conflict (id) do update set name = excluded.name, exam = excluded.exam, subject = excluded.subject,
     duration_min = excluded.duration_min, n_questions = excluded.n_questions, max_marks = excluded.max_marks,
     active = excluded.active, ord = excluded.ord, category = excluded.category, data = excluded.data,
     created_at = excluded.created_at, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- rows: [{row, time, name, phone, paperId, paperName, score, maxMarks, pct, correct, wrong, skipped, accuracy,
--         minutes, auto, strong, weak, qwise, status, data, email, userId}]  — a row already moved is skipped
create or replace function public.tp_admin_import_attempts(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; uid uuid; em text; ph text; ins int := 0; skip int := 0; linked int := 0; d jsonb;
begin
  perform tp_admin_check();
  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if exists (select 1 from tp_attempts where sheet_row = (r->>'row')::int) then skip := skip + 1; continue; end if;
    em := lower(trim(coalesce(r->>'email', ''))); ph := tp_phone(r->>'phone'); uid := null;
    if coalesce(r->>'userId', '') ~ '^[0-9a-fA-F-]{36}$' then
      select id into uid from auth.users where id = (r->>'userId')::uuid;
    end if;
    if uid is null and em <> '' then select id into uid from auth.users where lower(email) = em limit 1; end if;
    if uid is null and ph <> '' and (select count(*) from auth.users where tp_phone(raw_user_meta_data->>'phone') = ph) = 1 then
      select id into uid from auth.users where tp_phone(raw_user_meta_data->>'phone') = ph;
    end if;
    if uid is not null then linked := linked + 1; end if;
    begin d := coalesce(nullif(r->>'data', '')::jsonb, '{}'::jsonb); exception when others then d := '{}'::jsonb; end;
    if jsonb_typeof(d) <> 'object' then d := '{}'::jsonb; end if;
    insert into tp_attempts(user_id, email, phone, name, paper_id, paper_name, score, max_marks, pct, correct, wrong, skipped,
                            accuracy, minutes, auto, strong, weak, qwise, status, data, submit_at, sheet_row, created_at)
    values (uid, em, ph, coalesce(r->>'name', ''), coalesce(r->>'paperId', ''), coalesce(r->>'paperName', ''),
            coalesce(tp_num(r->>'score'), 0), coalesce(tp_num(r->>'maxMarks'), 0), coalesce(tp_num(r->>'pct'), 0),
            coalesce(tp_num(r->>'correct'), 0)::int, coalesce(tp_num(r->>'wrong'), 0)::int, coalesce(tp_num(r->>'skipped'), 0)::int,
            coalesce(tp_num(r->>'accuracy'), 0)::int, coalesce(tp_num(r->>'minutes'), 0),
            lower(coalesce(r->>'auto', '')) in ('yes', 'true'),
            coalesce(r->>'strong', ''), coalesce(r->>'weak', ''), coalesce(r->>'qwise', ''), coalesce(r->>'status', ''),
            d, nullif(trunc(coalesce(tp_num(d->>'submitAt'), 0)), 0)::bigint, (r->>'row')::int, tp_ts(r->>'time'));
    ins := ins + 1;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', ins, 'skipped', skip, 'linked', linked);
end $$;

-- ---------- who may call what ----------
do $$
declare f text;
begin
  foreach f in array array[
    'tp_auth()', 'tp_admin_check()', 'tp_papers_list()', 'tp_paper(text)', 'tp_my_attempts()', 'tp_me(boolean)',
    'tp_my_attempt(text)', 'tp_submit(jsonb)', 'tp_admin_papers()', 'tp_admin_get(text)', 'tp_admin_save(jsonb,text)',
    'tp_admin_set(text,jsonb)', 'tp_admin_delete(text)', 'tp_admin_results(int)', 'tp_admin_reopen(text,text,text,text)',
    'tp_admin_counts()', 'tp_admin_import_paper(text,jsonb,boolean,int,text,text,text)', 'tp_admin_import_attempts(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

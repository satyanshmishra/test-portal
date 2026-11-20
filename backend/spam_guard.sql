-- =====================================================================
--  SPAM GUARD for test.satyansh.blog (Test Portal + Doubt Portal + Live Quiz)
--  Run this in Supabase → SQL Editor → New query → paste → Run.
--  Run it BEFORE backend/live_quiz.sql. Safe to run again (word lists are only added to).
--
--  What it does
--   • spam_check(name, email): scores a name / email (abusive words in English, Hinglish
--     and Hindi, junk names like "test" / "asdf", keyboard mashing, digits, temp-mail domains).
--   • Sign-up / name change with an ABUSIVE name is refused by the database itself.
--   • Suspicious sign-ups and name changes are written to spam_alerts (host sees them on
--     live-control.html).
--   • blocked_users: accounts the host marked as spam. They cannot join live quizzes and
--     see "use your real name and email" when they log in.
--   • The word lists live in tables (spam_words, spam_safe, spam_domains), so new words can be
--     added from live-control.html without touching this file.
-- =====================================================================

-- ---------- word lists ----------
-- regex built from a word: each run of a letter may repeat ("gaand" → g+a{2,}n+d+)
create or replace function public.spam_rx(w text) returns text
language plpgsql immutable as $$
declare i int := 1; n int := char_length(w); c text; k int; r text := '';
begin
  while i <= n loop
    c := substr(w, i, 1); k := 1;
    while i + k <= n and substr(w, i + k, 1) = c loop k := k + 1; end loop;
    r := r || c || case when k = 1 then '+' else '{' || k || ',}' end;
    i := i + k;
  end loop;
  return r;
end $$;

create table if not exists public.spam_words (
  word     text primary key,                 -- lower case, letters only (English or Devanagari)
  mode     text not null default 'sub' check (mode in ('sub', 'token')),
                                             -- sub   = found anywhere in the name ("fuckboy", "f u c k")
                                             -- token = only a whole word ("gand", but not "sugandh")
  weight   int  not null default 10,         -- 10 = abusive (refused), 6 = junk / mild, 3 = odd
  note     text,
  added_at timestamptz not null default now(),
  rx       text generated always as (public.spam_rx(word)) stored
);
create table if not exists public.spam_safe (word text primary key);       -- real names that contain a listed word
create table if not exists public.spam_domains (domain text primary key);  -- temporary / fake email domains

create table if not exists public.spam_alerts (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  email      text,
  name       text,
  score      int,
  reasons    jsonb,
  source     text,          -- signup | name_change | live_join
  session_id uuid,
  seen       boolean not null default false
);
create index if not exists spam_alerts_at_idx on public.spam_alerts(at desc);

create table if not exists public.blocked_users (
  user_id uuid primary key,
  email   text,
  name    text,
  reason  text,
  at      timestamptz not null default now()
);

alter table public.spam_words    enable row level security;   -- no policies: only through functions
alter table public.spam_safe     enable row level security;
alter table public.spam_domains  enable row level security;
alter table public.spam_alerts   enable row level security;
alter table public.blocked_users enable row level security;

-- ---------- starter lists (extend from live-control.html → Words) ----------
insert into public.spam_words(word, mode, weight, note) values
-- English, abusive (anywhere in the name)
 ('fuck','sub',10,'en'),('fuk','sub',10,'en'),('fck','sub',10,'en'),('fuq','sub',10,'en'),('motherfuck','sub',10,'en'),
 ('bitch','sub',10,'en'),('biatch','sub',10,'en'),('slut','sub',10,'en'),('whore','sub',10,'en'),('pussy','sub',10,'en'),
 ('cunt','sub',10,'en'),('nigga','sub',10,'en'),('nigger','sub',10,'en'),('bastard','sub',10,'en'),('asshole','sub',10,'en'),
 ('arsehole','sub',10,'en'),('dickhead','sub',10,'en'),('boob','sub',10,'en'),('horny','sub',10,'en'),('nude','sub',10,'en'),
 ('naked','sub',10,'en'),('sexy','sub',10,'en'),('dildo','sub',10,'en'),('blowjob','sub',10,'en'),('handjob','sub',10,'en'),
 ('cumshot','sub',10,'en'),('penis','sub',10,'en'),('vagina','sub',10,'en'),('rapist','sub',10,'en'),('xxx','sub',10,'en'),
 ('milf','sub',10,'en'),('hentai','sub',10,'en'),('onlyfans','sub',10,'en'),('pornhub','sub',10,'en'),('bullshit','sub',10,'en'),
 ('jerkoff','sub',10,'en'),('wanker','sub',10,'en'),('fucker','sub',10,'en'),('sucker','sub',6,'en'),('loser','sub',6,'en'),
-- English, abusive (whole word only, because they hide inside real names)
 ('sex','token',10,'en'),('porn','token',10,'en'),('porno','token',10,'en'),('dick','token',10,'en'),('cock','token',10,'en'),
 ('cum','token',10,'en'),('ass','token',10,'en'),('shit','token',10,'en'),('shitty','token',10,'en'),('tits','token',10,'en'),
 ('fag','token',10,'en'),('hoe','token',10,'en'),('hoes','token',10,'en'),('rape','token',10,'en'),('piss','token',6,'en'),
 ('wtf','token',6,'en'),('stfu','token',6,'en'),('idiot','token',6,'en'),('stupid','token',6,'en'),('moron','token',6,'en'),
-- Hinglish, abusive (anywhere)
 ('madarchod','sub',10,'hi'),('maderchod','sub',10,'hi'),('madharchod','sub',10,'hi'),('madrchod','sub',10,'hi'),('mdrchod','sub',10,'hi'),
 ('madarjat','sub',10,'hi'),('madarjaat','sub',10,'hi'),('bhenchod','sub',10,'hi'),('behenchod','sub',10,'hi'),('bahenchod','sub',10,'hi'),
 ('bhanchod','sub',10,'hi'),('benchod','sub',10,'hi'),('behnchod','sub',10,'hi'),('bhencho','sub',10,'hi'),('betichod','sub',10,'hi'),
 ('bhaichod','sub',10,'hi'),('bhosdi','sub',10,'hi'),('bhosda','sub',10,'hi'),('bhosad','sub',10,'hi'),('bhosri','sub',10,'hi'),
 ('bhosdike','sub',10,'hi'),('bosdike','sub',10,'hi'),('bosdk','sub',10,'hi'),('bsdk','sub',10,'hi'),('chutiya','sub',10,'hi'),
 ('chutiye','sub',10,'hi'),('chutia','sub',10,'hi'),('chootiya','sub',10,'hi'),('chutya','sub',10,'hi'),('chutiyap','sub',10,'hi'),
 ('chutmar','sub',10,'hi'),('chutad','sub',10,'hi'),('gaand','sub',10,'hi'),('gaandu','sub',10,'hi'),('gandu','sub',10,'hi'),
 ('gandfat','sub',10,'hi'),('gandphat','sub',10,'hi'),('gandmar','sub',10,'hi'),('gandmasti','sub',10,'hi'),('lavda','sub',10,'hi'),
 ('lauda','sub',10,'hi'),('lawda','sub',10,'hi'),('lawde','sub',10,'hi'),('lavde','sub',10,'hi'),('laude','sub',10,'hi'),
 ('lodu','sub',10,'hi'),('lode','sub',10,'hi'),('loda','sub',10,'hi'),('jhaant','sub',10,'hi'),('jhant','sub',10,'hi'),
 ('jhatu','sub',10,'hi'),('jhaatu','sub',10,'hi'),('haramkhor','sub',10,'hi'),('haramzada','sub',10,'hi'),('haramzadi','sub',10,'hi'),
 ('haramjada','sub',10,'hi'),('harami','sub',10,'hi'),('kamina','sub',10,'hi'),('kaminey','sub',10,'hi'),('kameena','sub',10,'hi'),
 ('kameene','sub',10,'hi'),('bhadwa','sub',10,'hi'),('bhadva','sub',10,'hi'),('bhadwe','sub',10,'hi'),('bhadve','sub',10,'hi'),
 ('bhadua','sub',10,'hi'),('chinal','sub',10,'hi'),('chhinal','sub',10,'hi'),('hijda','sub',10,'hi'),('hijde','sub',10,'hi'),
 ('hijra','sub',10,'hi'),('randwa','sub',10,'hi'),('randibaz','sub',10,'hi'),('randikhana','sub',10,'hi'),('kutta','sub',10,'hi'),
 ('kutte','sub',10,'hi'),('kutiya','sub',10,'hi'),('kuttiya','sub',10,'hi'),('chodu','sub',10,'hi'),('chodna','sub',10,'hi'),
 ('chodne','sub',10,'hi'),('chudai','sub',10,'hi'),('chudwa','sub',10,'hi'),('chudakkad','sub',10,'hi'),('terimaa','sub',10,'hi'),
 ('terimaki','sub',10,'hi'),('teribehen','sub',10,'hi'),('teribahen','sub',10,'hi'),('teribhen','sub',10,'hi'),('ullukapatha','sub',6,'hi'),
 ('ullukepathe','sub',6,'hi'),('chakka','sub',6,'hi'),
-- Hinglish (whole word only)
 ('gand','token',10,'hi'),('lund','token',10,'hi'),('randi','token',10,'hi'),('chut','token',10,'hi'),('choot','token',10,'hi'),
 ('tatti','token',10,'hi'),('suar','token',10,'hi'),('suwar','token',10,'hi'),('kamine','token',10,'hi'),('dalla','token',10,'hi'),
 ('mc','token',10,'hi'),('bc','token',10,'hi'),('mkc','token',10,'hi'),('bkl','token',10,'hi'),('bkc','token',10,'hi'),
 ('tmkc','token',10,'hi'),('mkb','token',10,'hi'),('bhkl','token',10,'hi'),('lodue','token',10,'hi'),
-- Hindi (Devanagari; ड़ is read as ड and ँ as ं)
 ('मादरचोद','sub',10,'dev'),('मादरजात','sub',10,'dev'),('भेनचोद','sub',10,'dev'),('बहनचोद','sub',10,'dev'),('बहिनचोद','sub',10,'dev'),
 ('भोसडी','sub',10,'dev'),('भोसडा','sub',10,'dev'),('भोसडे','sub',10,'dev'),('चूतिया','sub',10,'dev'),('चुतिया','sub',10,'dev'),
 ('चूतिये','sub',10,'dev'),('चूत','sub',10,'dev'),('गांडू','sub',10,'dev'),('गांड','sub',10,'dev'),('लौडा','sub',10,'dev'),
 ('लौडे','sub',10,'dev'),('लवडा','sub',10,'dev'),('लोडू','sub',10,'dev'),('लंड','sub',10,'dev'),('रंडी','sub',10,'dev'),
 ('रंडवा','sub',10,'dev'),('हरामी','sub',10,'dev'),('हरामजादा','sub',10,'dev'),('हरामखोर','sub',10,'dev'),('कमीना','sub',10,'dev'),
 ('कमीने','sub',10,'dev'),('कुत्ता','sub',10,'dev'),('कुत्ते','sub',10,'dev'),('कुतिया','sub',10,'dev'),('भडवा','sub',10,'dev'),
 ('भडवे','sub',10,'dev'),('झाटू','sub',10,'dev'),('झांट','sub',10,'dev'),('चोद','sub',10,'dev'),('चुदाई','sub',10,'dev'),
 ('छिनाल','sub',10,'dev'),('हिजडा','sub',10,'dev'),('सेक्स','sub',10,'dev'),('पोर्न','sub',10,'dev'),('टट्टी','sub',10,'dev'),
-- junk / fake names (whole word)
 ('test','token',6,'junk'),('tester','token',6,'junk'),('testing','token',6,'junk'),('abc','token',6,'junk'),('abcd','token',6,'junk'),
 ('xyz','token',6,'junk'),('user','token',6,'junk'),('username','token',6,'junk'),('student','token',6,'junk'),('admin','token',6,'junk'),
 ('null','token',6,'junk'),('none','token',6,'junk'),('nil','token',6,'junk'),('na','token',6,'junk'),('nan','token',6,'junk'),
 ('undefined','token',6,'junk'),('unknown','token',6,'junk'),('anonymous','token',6,'junk'),('anon','token',6,'junk'),('guest','token',6,'junk'),
 ('demo','token',6,'junk'),('fake','token',6,'junk'),('spam','token',6,'junk'),('spammer','token',6,'junk'),('bot','token',6,'junk'),
 ('robot','token',6,'junk'),('hacker','token',6,'junk'),('hack','token',6,'junk'),('noob','token',6,'junk'),('nobody','token',6,'junk'),
 ('noname','token',6,'junk'),('someone','token',6,'junk'),('idk','token',6,'junk'),('lol','token',6,'junk'),('lmao','token',6,'junk'),
 ('hello','token',6,'junk'),('hi','token',6,'junk'),('hii','token',6,'junk'),('hey','token',6,'junk'),('bro','token',6,'junk'),
 ('dude','token',6,'junk'),('asdf','token',6,'junk'),('qwerty','token',6,'junk'),
-- keyboard mashing (anywhere)
 ('qwer','sub',6,'kbd'),('wert','sub',6,'kbd'),('rtyu','sub',6,'kbd'),('tyui','sub',6,'kbd'),('yuio','sub',6,'kbd'),('uiop','sub',6,'kbd'),
 ('asdf','sub',6,'kbd'),('sdfg','sub',6,'kbd'),('dfgh','sub',6,'kbd'),('fghj','sub',6,'kbd'),('ghjk','sub',6,'kbd'),('hjkl','sub',6,'kbd'),
 ('zxcv','sub',6,'kbd'),('xcvb','sub',6,'kbd'),('cvbn','sub',6,'kbd'),('vbnm','sub',6,'kbd'),('mnbv','sub',6,'kbd'),('lkjh','sub',6,'kbd'),
 ('poiu','sub',6,'kbd'),('rewq','sub',6,'kbd'),('fdsa','sub',6,'kbd')
on conflict (word) do nothing;

insert into public.spam_safe(word) values
 ('gandhi'),('gandhiji'),('gandharv'),('gandharva'),('gandhar'),('gandak'),('sugandh'),('sugandha'),('sugandhi'),
 ('kutty'),('kutti'),('kuttan'),('kuttappa'),('kuttappan'),('kamini'),('kaminee'),('randhir'),('randeep'),('randive'),
 ('dickson'),('hancock'),('lauder'),('lodewijk'),('chakkarwar'),('lodha'),('lodhi'),('hijras')
on conflict (word) do nothing;

insert into public.spam_domains(domain) values
 ('mailinator.com'),('yopmail.com'),('yopmail.fr'),('guerrillamail.com'),('guerrillamail.net'),('sharklasers.com'),('grr.la'),
 ('10minutemail.com'),('10minutemail.net'),('tempmail.com'),('temp-mail.org'),('tempmail.net'),('tempmailo.com'),('tempr.email'),
 ('throwawaymail.com'),('trashmail.com'),('trashmail.de'),('getnada.com'),('nada.email'),('maildrop.cc'),('dispostable.com'),
 ('fakeinbox.com'),('mintemail.com'),('mohmal.com'),('emailondeck.com'),('mailnesia.com'),('mytemp.email'),('moakt.com'),
 ('spamgourmet.com'),('burnermail.io'),('33mail.com'),('inboxkitten.com'),('mail.tm'),('emailfake.com'),('tmpmail.org'),
 ('mailpoof.com'),('getairmail.com'),('fakemail.net'),('minuteinbox.com'),('discard.email'),('spambox.us'),('mailcatch.com'),
 ('example.com'),('test.com'),('abc.com'),('xyz.com'),('gmail.co'),('gmai.com'),('gmial.com'),('gamil.com'),('gmail.con')
on conflict (domain) do nothing;

-- ---------- scoring ----------
-- lower case, leetspeak → letters, ड़ → ड, ँ → ं
create or replace function public.spam_norm(t text) returns text
language sql immutable as $$
  select translate(
           replace(replace(replace(lower(coalesce(t, '')), 'ड़', 'ड'), '़', ''), 'ँ', 'ं'),
           '0134578@$!|', 'oieastbasii');
$$;

create or replace function public.spam_check(p_name text, p_email text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  raw    text := coalesce(p_name, '');
  n      text := spam_norm(p_name);
  toks   text[];
  joined text;
  sc     int := 0;
  rs     text[] := '{}';
  abuse  boolean := false;              -- an abusive word (weight >= 10) was found
  w      record;
  lat    int;
  em     text := lower(trim(coalesce(p_email, '')));
  loc    text := split_part(em, '@', 1);
  dom    text := split_part(em, '@', 2);
  lvl    text;
begin
  toks   := array(select t from regexp_split_to_table(regexp_replace(n, '[^a-zऀ-ॿ]+', ' ', 'g'), ' ') t where t <> '');
  joined := array_to_string(array(select t from unnest(toks) t where t not in (select word from spam_safe)), '');

  for w in select word, mode, weight, rx from spam_words loop
    if (w.mode = 'sub'   and joined ~ w.rx)
    or (w.mode = 'token' and exists (select 1 from unnest(toks) t where t ~ ('^' || w.rx || '$'))) then
      sc := sc + w.weight; rs := rs || ('word: ' || w.word);
      if w.weight >= 10 then abuse := true; end if;
    end if;
  end loop;

  -- shape of the name
  lat := char_length(regexp_replace(n, '[^a-z]', '', 'g'));
  if char_length(regexp_replace(n, '[^a-zऀ-ॿ]', '', 'g')) < 3 then sc := sc + 3; rs := rs || 'too short'::text; end if;
  if raw ~ '\d.*\d' then sc := sc + 3; rs := rs || 'digits in name'::text; end if;
  if raw ~* '(https?:|www\.|\.com|\.in\b|@)' then sc := sc + 6; rs := rs || 'link / email in name'::text; end if;
  if char_length(regexp_replace(raw, '[[:alpha:][:space:][:digit:]ऀ-ॿ.''-]', '', 'g')) >= 2 then sc := sc + 2; rs := rs || 'symbols / emoji'::text; end if;
  if raw ~ '(.)\1\1\1' then sc := sc + 3; rs := rs || 'same letter 4+ times'::text; end if;
  if lat > 0 and exists (select 1 from unnest(toks) t where t ~ '^[a-z]{4,}$' and t !~ '[aeiouy]') then
    sc := sc + 3; rs := rs || 'word without vowels'::text; end if;
  if exists (select 1 from unnest(toks) t where t ~ '[bcdfghjklmnpqrstvwxz]{5,}') then
    sc := sc + 3; rs := rs || 'random letters'::text; end if;

  -- email
  if em <> '' then
    if dom in (select domain from spam_domains) then sc := sc + 6; rs := rs || ('temporary / fake email: ' || dom); end if;
    if loc ~ '\d{6,}' then sc := sc + 2; rs := rs || 'many digits in email'::text; end if;
    for w in select word, rx from spam_words where mode = 'sub' and weight >= 10 loop
      if regexp_replace(spam_norm(loc), '[^a-z]', '', 'g') ~ w.rx then
        sc := sc + 10; rs := rs || ('email word: ' || w.word); abuse := true; exit;
      end if;
    end loop;
  end if;

  -- block = abusive (refused at sign-up), bad = junk / fake (sign-up form asks again), suspect = host gets an alert
  lvl := case when abuse then 'block' when sc >= 6 then 'bad' when sc >= 3 then 'suspect' else 'ok' end;
  return jsonb_build_object('score', sc, 'level', lvl, 'reasons', to_jsonb(rs));
end $$;

-- for the sign-up form (also works before login)
create or replace function public.name_check(p_name text, p_email text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('level', r->>'level', 'ok', (r->>'level') in ('ok', 'suspect'))
    from (select public.spam_check(p_name, p_email) r) x;
$$;

-- ---------- real name of an account ----------
-- Google name first (students cannot edit it), then the name typed at sign-up, then the email.
create or replace function public.real_name(p_user uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select left(coalesce(
           (select nullif(trim(coalesce(i.identity_data ->> 'full_name', i.identity_data ->> 'name')), '')
              from auth.identities i where i.user_id = p_user and i.provider = 'google'
             order by i.created_at limit 1),
           (select nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')), '')
              from auth.users u where u.id = p_user),
           (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user),
           'Student'), 40);
$$;

-- ---------- sign-up / name change guard ----------
create or replace function public.spam_on_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text; r jsonb; sc int;
begin
  nm := trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''));
  if tg_op = 'UPDATE'
     and nm is not distinct from trim(coalesce(old.raw_user_meta_data ->> 'full_name', old.raw_user_meta_data ->> 'name', ''))
     and new.email is not distinct from old.email then
    return new;                                         -- nothing about the name changed (e.g. a normal login)
  end if;
  begin
    r := spam_check(nm, new.email); sc := (r ->> 'score')::int;
  exception when others then
    return new;                                         -- a broken list must never stop sign-ups
  end;
  if r ->> 'level' = 'block' then
    raise exception 'NAME_NOT_ALLOWED: Please use your real full name.';
  end if;
  if sc >= 3 then
    begin
      insert into spam_alerts(user_id, email, name, score, reasons, source)
      values (new.id, new.email, nm, sc, r -> 'reasons', case when tg_op = 'INSERT' then 'signup' else 'name_change' end);
    exception when others then null;
    end;
  end if;
  return new;
end $$;

drop trigger if exists spam_guard_user on auth.users;
create trigger spam_guard_user
  before insert or update of raw_user_meta_data, email on auth.users
  for each row execute function public.spam_on_user();

-- ---------- for the logged-in student ----------
create or replace function public.my_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('blocked', b.user_id is not null, 'reason', b.reason)
    from (select 1) one left join blocked_users b on b.user_id = auth.uid();
$$;

-- ---------- host tools (live-control.html) ----------
create or replace function public.spam_admin_() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from information_schema.routines where routine_schema = 'public' and routine_name = 'live_is_admin')
     or not public.live_is_admin() then
    raise exception 'Only the quiz host can do this';
  end if;
end $$;

-- alerts newer than p_after (0 = latest 100)
create or replace function public.spam_alerts_list(p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform spam_admin_();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'at', a.at, 'user_id', a.user_id, 'email', a.email, 'name', a.name, 'score', a.score,
           'reasons', a.reasons, 'source', a.source, 'session_id', a.session_id, 'seen', a.seen,
           'blocked', exists (select 1 from blocked_users b where b.user_id = a.user_id),
           'now_name', public.real_name(a.user_id)) order by a.id desc), '[]'::jsonb)
    into r
    from (select * from spam_alerts where id > coalesce(p_after, 0) order by id desc limit 100) a;
  return jsonb_build_object('alerts', r, 'unseen', (select count(*) from spam_alerts where not seen));
end $$;

create or replace function public.spam_alerts_seen(p_ids bigint[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform spam_admin_();
  update spam_alerts set seen = true where not seen and (p_ids is null or id = any(p_ids));
end $$;

-- check every account in the database
create or replace function public.spam_scan(p_min int default 3)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare r jsonb;
begin
  perform spam_admin_();
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'created_at' desc), '[]'::jsonb) into r
    from (select jsonb_build_object(
                   'user_id', u.id, 'email', u.email, 'name', public.real_name(u.id), 'created_at', u.created_at,
                   'last_sign_in_at', u.last_sign_in_at,
                   'google', exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'google'),
                   'blocked', exists (select 1 from blocked_users b where b.user_id = u.id),
                   'score', (c ->> 'score')::int, 'level', c ->> 'level', 'reasons', c -> 'reasons') x
            from auth.users u
            cross join lateral (select public.spam_check(public.real_name(u.id), u.email) c) cc
           where (c ->> 'score')::int >= coalesce(p_min, 3)
           limit 500) t;
  return r;
end $$;

create or replace function public.user_block(p_user uuid, p_on boolean, p_reason text default 'spam')
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  perform spam_admin_();
  if p_on then
    insert into blocked_users(user_id, email, name, reason)
    select u.id, u.email, public.real_name(u.id), left(coalesce(p_reason, 'spam'), 200) from auth.users u where u.id = p_user
    on conflict (user_id) do update set reason = excluded.reason, at = now();
  else
    delete from blocked_users where user_id = p_user;
  end if;
end $$;

create or replace function public.spam_words_list()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform spam_admin_();
  return jsonb_build_object(
    'words',   (select coalesce(jsonb_agg(jsonb_build_object('word', word, 'mode', mode, 'weight', weight, 'note', note) order by note, word), '[]'::jsonb) from spam_words),
    'safe',    (select coalesce(jsonb_agg(word order by word), '[]'::jsonb) from spam_safe),
    'domains', (select coalesce(jsonb_agg(domain order by domain), '[]'::jsonb) from spam_domains));
end $$;

-- p_kind: word | safe | domain ; p_on false = remove
create or replace function public.spam_word_set(p_kind text, p_word text, p_on boolean default true,
                                                p_mode text default 'sub', p_weight int default 10)
returns void language plpgsql security definer set search_path = public as $$
declare w text := spam_norm(trim(coalesce(p_word, '')));
begin
  perform spam_admin_();
  if p_kind = 'domain' then
    w := lower(trim(coalesce(p_word, '')));
    if w !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'Type a domain like tempmail.com'; end if;
    if p_on then insert into spam_domains(domain) values (w) on conflict do nothing;
    else delete from spam_domains where domain = w; end if;
    return;
  end if;
  w := regexp_replace(w, '[^a-zऀ-ॿ]', '', 'g');
  if char_length(w) < 2 then raise exception 'The word needs at least 2 letters'; end if;
  if p_kind = 'safe' then
    if p_on then insert into spam_safe(word) values (w) on conflict do nothing;
    else delete from spam_safe where word = w; end if;
  else
    if p_on then
      insert into spam_words(word, mode, weight, note)
      values (w, case when p_mode = 'token' then 'token' else 'sub' end, greatest(1, least(coalesce(p_weight, 10), 20)), 'added')
      on conflict (word) do update set mode = excluded.mode, weight = excluded.weight;
    else delete from spam_words where word = w; end if;
  end if;
end $$;

revoke execute on function public.spam_check(text, text), public.real_name(uuid), public.spam_admin_(),
                           public.spam_alerts_list(bigint), public.spam_alerts_seen(bigint[]), public.spam_scan(int),
                           public.user_block(uuid, boolean, text), public.spam_words_list(),
                           public.spam_word_set(text, text, boolean, text, int), public.my_status(),
                           public.spam_on_user()
  from public, anon;
grant execute on function public.spam_alerts_list(bigint), public.spam_alerts_seen(bigint[]), public.spam_scan(int),
                          public.user_block(uuid, boolean, text), public.spam_words_list(),
                          public.spam_word_set(text, text, boolean, text, int), public.my_status()
  to authenticated;
grant execute on function public.name_check(text, text) to anon, authenticated;

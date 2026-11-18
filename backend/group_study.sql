-- =====================================================================
--  GROUP STUDY for test.satyansh.blog
--  Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
--  Safe to run again later (it only replaces functions / adds what is missing).
--
--  Any logged-in student can host a group. Others join with the 6-digit code.
--  Everyone solves the same sheet; each phone reports its own progress
--  (answers, time per question, tab switches, microphone on/off).
--  While the session runs, members see only each other's counts
--  ("4 answered · 1 tab switch"); full answers are shared only after it ends.
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.gs_groups (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  host        uuid not null,
  host_name   text not null default '',
  title       text not null default 'Group Study',
  source      jsonb not null,                       -- {"kind":"paper","id":"…"} or {"kind":"pyq","exam":"main","qs":[["unit","id"],…]}
  settings    jsonb not null default '{}'::jsonb,   -- {"reveal":"end"|"now","per":120,"limitSec":2400,"lives":3}
  n           int  not null default 0,              -- number of questions
  status      text not null default 'lobby',        -- lobby | running | ended
  started_at  timestamptz,
  ends_at     timestamptz,
  ended_at    timestamptz,
  v           int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists gs_groups_code_idx on public.gs_groups(code);

create table if not exists public.gs_members (
  group_id   uuid not null references public.gs_groups(id) on delete cascade,
  user_id    uuid not null,
  name       text not null,
  answered   int  not null default 0,
  tabs       int  not null default 0,
  mic        text not null default 'off',           -- on | off | muted
  cur        int,
  total_ms   bigint not null default 0,
  done       boolean not null default false,
  done_why   text,                                   -- submit | lives | time | host
  done_at    timestamptz,
  data       jsonb not null default '{}'::jsonb,    -- {"ans":{"0":{"a":"2","ms":41000},…},"log":[…]}
  joined_at  timestamptz not null default now(),
  seen_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.gs_groups  enable row level security;   -- no policies: read and written only through the functions below
alter table public.gs_members enable row level security;

create or replace function public.gs_now() returns timestamptz language sql stable as $$ select now(); $$;

create or replace function public.gs_name_() returns text language sql stable as $$
  select left(coalesce(nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
                       nullif(trim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
                       split_part(coalesce(auth.jwt() ->> 'email', 'Student'), '@', 1)), 40);
$$;

-- ends the group when its time is over or everyone has finished
create or replace function public.gs_tick_(p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g gs_groups;
begin
  select * into g from gs_groups where id = p for update;
  if not found or g.status <> 'running' then return; end if;
  if (g.ends_at is not null and now() > g.ends_at + interval '20 seconds')
     or not exists (select 1 from gs_members where group_id = p and not done)
     or now() > g.started_at + interval '6 hours' then
    update gs_members set done = true, done_why = coalesce(done_why, 'time'), done_at = coalesce(done_at, now())
     where group_id = p and not done;
    update gs_groups set status = 'ended', ended_at = now(), v = v + 1, updated_at = now() where id = p;
  end if;
end $$;

-- ---------- host: create ----------
create or replace function public.gs_create(p_title text, p_source jsonb, p_settings jsonb, p_n int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text; g gs_groups; tries int := 0;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if coalesce(p_n, 0) < 1 or p_n > 200 then raise exception 'Choose between 1 and 200 questions'; end if;
  -- close this host's older groups that never started
  update gs_groups set status = 'ended', ended_at = now(), v = v + 1 where host = auth.uid() and status = 'lobby';
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from gs_groups where code = c and status <> 'ended');
    tries := tries + 1; if tries > 30 then raise exception 'Could not make a code, please try again'; end if;
  end loop;
  insert into gs_groups(code, host, host_name, title, source, settings, n)
  values (c, auth.uid(), gs_name_(), left(coalesce(nullif(trim(p_title), ''), 'Group Study'), 80), p_source, coalesce(p_settings, '{}'::jsonb), p_n)
  returning * into g;
  insert into gs_members(group_id, user_id, name) values (g.id, auth.uid(), gs_name_());
  return jsonb_build_object('id', g.id, 'code', g.code);
end $$;

-- ---------- member: join with the code ----------
create or replace function public.gs_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g gs_groups;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into g from gs_groups where code = trim(coalesce(p_code, '')) and status <> 'ended'
   order by created_at desc limit 1;
  if not found then raise exception 'No group is open with this code'; end if;
  if exists (select 1 from gs_members where group_id = g.id and user_id = auth.uid()) then
    update gs_members set seen_at = now() where group_id = g.id and user_id = auth.uid();
    return jsonb_build_object('id', g.id, 'code', g.code);
  end if;
  if g.status <> 'lobby' then raise exception 'This group has already started'; end if;
  if (select count(*) from gs_members where group_id = g.id) >= 12 then raise exception 'This group is full (12 people)'; end if;
  insert into gs_members(group_id, user_id, name) values (g.id, auth.uid(), gs_name_());
  update gs_groups set v = v + 1, updated_at = now() where id = g.id;
  return jsonb_build_object('id', g.id, 'code', g.code);
end $$;

-- ---------- everyone: current state (polled every 2 s) ----------
create or replace function public.gs_state(p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g gs_groups; ms jsonb;
begin
  if not exists (select 1 from gs_members where group_id = p_group and user_id = auth.uid()) then
    raise exception 'You are not in this group';
  end if;
  perform gs_tick_(p_group);
  select * into g from gs_groups where id = p_group;
  select coalesce(jsonb_agg(jsonb_build_object(
           'uid', m.user_id, 'name', m.name, 'answered', m.answered, 'tabs', m.tabs, 'mic', m.mic, 'cur', m.cur,
           'done', m.done, 'why', m.done_why, 'total_ms', m.total_ms,
           'away', m.seen_at < now() - interval '12 seconds', 'me', m.user_id = auth.uid(), 'host', m.user_id = g.host,
           'data', case when g.status = 'ended' or m.user_id = auth.uid() then m.data else null end)
         order by m.joined_at), '[]'::jsonb) into ms
    from gs_members m where m.group_id = p_group;
  return jsonb_build_object('id', g.id, 'code', g.code, 'title', g.title, 'host', g.host, 'host_name', g.host_name,
    'source', g.source, 'settings', g.settings, 'n', g.n, 'status', g.status,
    'started_at', g.started_at, 'ends_at', g.ends_at, 'ended_at', g.ended_at, 'now', now(), 'v', g.v,
    'is_host', g.host = auth.uid(), 'members', ms);
end $$;

-- ---------- member: report own progress ----------
-- p: {"answered":4,"tabs":1,"mic":"on","cur":5,"total_ms":120000,"data":{…},"done":true,"why":"submit"}
create or replace function public.gs_update(p_group uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g gs_groups; m gs_members;
begin
  select * into g from gs_groups where id = p_group;
  if not found then raise exception 'Group not found'; end if;
  select * into m from gs_members where group_id = p_group and user_id = auth.uid();
  if not found then raise exception 'You are not in this group'; end if;
  if g.status = 'running' and not m.done then
    update gs_members set
      answered = coalesce((p ->> 'answered')::int, answered),
      tabs     = greatest(tabs, coalesce((p ->> 'tabs')::int, 0)),
      mic      = coalesce(nullif(p ->> 'mic', ''), mic),
      cur      = (p ->> 'cur')::int,
      total_ms = coalesce((p ->> 'total_ms')::bigint, total_ms),
      data     = coalesce(p -> 'data', data),
      done     = coalesce((p ->> 'done')::boolean, false),
      done_why = case when coalesce((p ->> 'done')::boolean, false) then coalesce(p ->> 'why', 'submit') else null end,
      done_at  = case when coalesce((p ->> 'done')::boolean, false) then now() else null end,
      seen_at  = now()
    where group_id = p_group and user_id = auth.uid();
    if coalesce((p ->> 'done')::boolean, false) then update gs_groups set v = v + 1, updated_at = now() where id = p_group; end if;
    perform gs_tick_(p_group);
  else
    update gs_members set mic = coalesce(nullif(p ->> 'mic', ''), mic), seen_at = now()
     where group_id = p_group and user_id = auth.uid();
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- host: start / end ----------
create or replace function public.gs_start(p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g gs_groups; lim int;
begin
  select * into g from gs_groups where id = p_group;
  if not found then raise exception 'Group not found'; end if;
  if g.host <> auth.uid() then raise exception 'Only the host can start'; end if;
  if g.status <> 'lobby' then raise exception 'Already started'; end if;
  lim := coalesce((g.settings ->> 'limitSec')::int, 0);
  update gs_groups set status = 'running', started_at = now() + interval '3 seconds',
         ends_at = case when lim > 0 then now() + interval '3 seconds' + make_interval(secs => lim) else null end,
         v = v + 1, updated_at = now()
   where id = p_group;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gs_end(p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g gs_groups;
begin
  select * into g from gs_groups where id = p_group;
  if not found then raise exception 'Group not found'; end if;
  if g.host <> auth.uid() then raise exception 'Only the host can end the session'; end if;
  update gs_members set done = true, done_why = coalesce(done_why, 'host'), done_at = coalesce(done_at, now())
   where group_id = p_group and not done;
  update gs_groups set status = 'ended', ended_at = now(), v = v + 1, updated_at = now() where id = p_group;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- leave (lobby only; the host leaving closes the group) ----------
create or replace function public.gs_leave(p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g gs_groups;
begin
  select * into g from gs_groups where id = p_group;
  if not found then return jsonb_build_object('ok', true); end if;
  if g.status = 'lobby' then
    if g.host = auth.uid() then
      update gs_groups set status = 'ended', ended_at = now(), v = v + 1 where id = p_group;
    else
      delete from gs_members where group_id = p_group and user_id = auth.uid();
      update gs_groups set v = v + 1 where id = p_group;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- my past group sessions ----------
create or replace function public.gs_my_groups()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', g.id, 'code', g.code, 'title', g.title, 'status', g.status, 'n', g.n,
             'at', coalesce(g.started_at, g.created_at), 'host_name', g.host_name,
             'members', (select count(*) from gs_members x where x.group_id = g.id)) as x
      from gs_groups g join gs_members m on m.group_id = g.id and m.user_id = auth.uid()
     where g.created_at > now() - interval '60 days' and g.started_at is not null
     order by g.created_at desc limit 30) t;
$$;

revoke execute on function public.gs_tick_(uuid), public.gs_name_() from public, anon, authenticated;
revoke execute on function public.gs_create(text, jsonb, jsonb, int), public.gs_join(text), public.gs_state(uuid),
  public.gs_update(uuid, jsonb), public.gs_start(uuid), public.gs_end(uuid), public.gs_leave(uuid), public.gs_my_groups()
  from public, anon;
grant execute on function public.gs_now(), public.gs_create(text, jsonb, jsonb, int), public.gs_join(text), public.gs_state(uuid),
  public.gs_update(uuid, jsonb), public.gs_start(uuid), public.gs_end(uuid), public.gs_leave(uuid), public.gs_my_groups()
  to authenticated;

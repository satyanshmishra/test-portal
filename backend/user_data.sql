-- =====================================================================
--  EVERYTHING A STUDENT DOES IS SAVED IN THEIR ACCOUNT (works on every device)
--  Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
--  Safe to run again.
--
--  One row per student per item:
--    pyq            PYQ practice: stars, solved / wrong, tries, time per question
--    sheet:<id>     a Practice Sheet's answers, timer and settings
--    active         the test a student is in the middle of (resume on another device)
--    gs:<group>     own answers in a Group Study session;  gs_cur = the group they are in
--    pref:…         settings: dark mode, timer / answer settings, PYQ filters
--  The site saves changes a few seconds after they happen and loads them at login.
-- =====================================================================

create table if not exists public.user_data (
  user_id    uuid not null,
  k          text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, k)
);
alter table public.user_data enable row level security;   -- no policies: only the functions below read / write it

-- everything of the logged-in student: {"pyq": {...}, "sheet:abc": {...}, ...}
create or replace function public.ud_get_all()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(k, data), '{}'::jsonb) from user_data where user_id = auth.uid();
$$;

-- save several items at once: {"pyq": {...}, "active": null}   (null = delete that item)
create or replace function public.ud_put(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Bad data'; end if;
  for r in select key, value from jsonb_each(p) loop
    if length(r.key) > 120 then continue; end if;
    if r.value is null or jsonb_typeof(r.value) = 'null' then
      delete from user_data where user_id = auth.uid() and k = r.key;
    else
      if pg_column_size(r.value) > 3000000 then raise exception 'Item % is too large to save', r.key; end if;
      insert into user_data(user_id, k, data, updated_at) values (auth.uid(), r.key, r.value, now())
      on conflict (user_id, k) do update set data = excluded.data, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  if (select count(*) from user_data where user_id = auth.uid()) > 3000 then raise exception 'Too many saved items'; end if;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

revoke execute on function public.ud_get_all(), public.ud_put(jsonb) from public, anon;
grant execute on function public.ud_get_all(), public.ud_put(jsonb) to authenticated;

-- if the earlier pyq_progress.sql was run, carry its data over once
do $$ begin
  if to_regclass('public.pyq_progress') is not null then
    insert into public.user_data(user_id, k, data)
    select user_id, 'pyq', data from public.pyq_progress
    on conflict (user_id, k) do nothing;
  end if;
end $$;

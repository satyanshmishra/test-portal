-- =====================================================================
--  PYQ PRACTICE PROGRESS IN THE ACCOUNT (stars, solved/wrong, timer times)
--  Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
--  Safe to run again.
--
--  Each student has one row: everything the PYQ practice page remembers
--  (1–3 star ratings, solved / wrong answers, tries, time per question).
--  The page saves it a few seconds after every change and loads it on any
--  device the student logs in on.
-- =====================================================================

create table if not exists public.pyq_progress (
  user_id    uuid primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.pyq_progress enable row level security;   -- no policies: only the functions below read / write it

create or replace function public.pyq_prog_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select data from pyq_progress where user_id = auth.uid()), '{}'::jsonb);
$$;

create or replace function public.pyq_prog_put(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Bad data'; end if;
  if pg_column_size(p_data) > 3000000 then raise exception 'Progress is too large to save'; end if;
  insert into pyq_progress(user_id, data, updated_at) values (auth.uid(), p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.pyq_prog_get(), public.pyq_prog_put(jsonb) from public, anon;
grant execute on function public.pyq_prog_get(), public.pyq_prog_put(jsonb) to authenticated;

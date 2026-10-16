-- PCT Coffee Chats. Paste all of this into Supabase > SQL Editor and click Run.
-- Before you run it, change the two emails at the very bottom to the Marshalls' school emails.

create table people (
  id text primary key,
  name text not null,
  role text not null check (role in ('brother', 'pledge'))
);

create table chats (
  id text primary key,
  pledge text not null,
  other text not null,
  logged_by text not null,
  ts bigint not null
);

create table marshalls (
  email text primary key
);

alter table people enable row level security;
alter table chats enable row level security;
alter table marshalls enable row level security;

create function public.is_school() returns boolean
language sql stable as $$
  select auth.uid() is not null
    and lower(coalesce(auth.jwt() ->> 'email', '')) like '%@babson.edu'
$$;

create function public.is_marshall() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_school()
    and exists (select 1 from public.marshalls where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

create policy "school reads people" on people for select using (public.is_school());
create policy "marshalls edit people" on people for all using (public.is_marshall()) with check (public.is_marshall());

create policy "school reads chats" on chats for select using (public.is_school());
create policy "school adds chats" on chats for insert
  with check (public.is_school() and logged_by = (auth.jwt() ->> 'email') and id = pledge || '__' || other);
create policy "school removes chats" on chats for delete using (public.is_school());

create policy "see own marshall row" on marshalls for select
  using (lower(email) = lower(auth.jwt() ->> 'email'));

alter publication supabase_realtime add table people, chats;

insert into people (id, name, role) values
  ('b-sophia-draxler', 'Sophia Draxler', 'brother'),
  ('b-liam-aldrich', 'Liam Aldrich', 'brother'),
  ('b-jean-fabre', 'Jean Fabre', 'brother'),
  ('b-garrett-spears', 'Garrett Spears', 'brother'),
  ('b-maisie-creamer', 'Maisie Creamer', 'brother'),
  ('b-abir-gupta', 'Abir Gupta', 'brother'),
  ('b-samuel-spiegel', 'Samuel Spiegel', 'brother'),
  ('b-emily-weinberg', 'Emily Weinberg', 'brother'),
  ('b-mads-syversen', 'Mads Syversen', 'brother'),
  ('b-sam-ross', 'Sam Ross', 'brother'),
  ('b-alia-andaloussi', 'Alia Andaloussi', 'brother'),
  ('b-maia-vedani', 'Maia Vedani', 'brother'),
  ('b-danica-quinn', 'Danica Quinn', 'brother'),
  ('p-johnny-secco', 'Johnny Secco', 'pledge'),
  ('p-riley-burke', 'Riley Burke', 'pledge'),
  ('p-whitney-anttila', 'Whitney Anttila', 'pledge'),
  ('p-connor-yeh', 'Connor Yeh', 'pledge'),
  ('p-milad-vessali', 'Milad Vessali', 'pledge'),
  ('p-jesse-posada', 'Jesse Posada', 'pledge'),
  ('p-izzy-youssef', 'Izzy Youssef', 'pledge'),
  ('p-masha-sakharuk', 'Masha Sakharuk', 'pledge'),
  ('p-angelina-widmer', 'Angelina Widmer', 'pledge'),
  ('p-ali-meyers', 'Ali Meyers', 'pledge'),
  ('p-liv-taylor', 'Liv Taylor', 'pledge'),
  ('p-leanne-aubut', 'Leanne Aubut', 'pledge'),
  ('p-valeriia-skydan', 'Valeriia Skydan', 'pledge'),
  ('p-avery-prewo', 'Avery Prewo', 'pledge');

-- CHANGE THESE TWO EMAILS before running
insert into marshalls (email) values
  ('YOUR_EMAIL@babson.edu'),
  ('MAISIE_EMAIL@babson.edu');

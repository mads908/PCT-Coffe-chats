-- PCT Coffee Chats. Paste all of this into Supabase > SQL Editor and click Run.
-- Then in Authentication > Sign In / Providers: turn Email on, turn "Confirm email" off, minimum password length 8.

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

-- Who can sign in, and which person each login is. No policies: only the functions below read it.
create table members (
  email text primary key check (email = lower(email)),
  person_id text references people(id) on delete set null
);
alter table members enable row level security;

-- Marshalls are always allowed in, so they don't need a members row too.
create function public.is_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where email = lower(p_email))
      or exists (select 1 from marshalls where lower(email) = lower(p_email))
$$;
revoke execute on function public.is_allowed(text) from public, anon;
grant execute on function public.is_allowed(text) to authenticated;

create function public.is_member() returns boolean
language sql stable as $$
  select auth.uid() is not null and public.is_allowed(auth.jwt() ->> 'email')
$$;

create function public.is_marshall() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member()
    and exists (select 1 from public.marshalls where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

create function public.my_person() returns text
language sql stable security definer set search_path = public as $$
  select person_id from members where email = lower(auth.jwt() ->> 'email')
$$;
revoke execute on function public.my_person() from public, anon;
grant execute on function public.my_person() to authenticated;

create policy "members read people" on people for select using (public.is_member());
create policy "marshalls edit people" on people for all using (public.is_marshall()) with check (public.is_marshall());
create policy "members read chats" on chats for select using (public.is_member());
-- You can only log or undo chats you're part of. Marshalls can fix anyone's.
create policy "members add own chats" on chats for insert
  with check (public.is_member() and logged_by = (auth.jwt() ->> 'email') and id = pledge || '__' || other
    and (public.my_person() in (pledge, other) or public.is_marshall()));
create policy "members remove own chats" on chats for delete
  using (public.is_member() and (public.my_person() in (pledge, other) or public.is_marshall()));

create policy "see own marshall row" on marshalls for select
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Block account creation for anyone not on the list, whatever the browser sends.
create function public.only_listed_signups() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_allowed(new.email) then
    raise exception 'This email is not on the PCT list';
  end if;
  return new;
end $$;
create trigger only_listed_signups before insert on auth.users
  for each row execute function public.only_listed_signups();

-- Lets the login screen ask "is this email new, returning, or not on the list?" before showing a password box.
create function public.login_status(p_email text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not public.is_allowed(p_email) then 'not_allowed'
    when exists (select 1 from auth.users where lower(email) = lower(p_email)) then 'existing'
    else 'new'
  end
$$;
revoke execute on function public.login_status(text) from public;
grant execute on function public.login_status(text) to anon, authenticated;

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
  ('p-leanne-aubut', 'Leanne Aubut-Laurin', 'pledge'),
  ('p-valeriia-skydan', 'Valeriia Skydan', 'pledge'),
  ('p-avery-prewo', 'Avery Prewo', 'pledge');

insert into marshalls (email) values
  ('msyversen1@babson.edu'), ('mcreamer1@babson.edu'), ('mads.syversen@gmail.com');

insert into members (email, person_id) values
  ('wanttila1@babson.edu', 'p-whitney-anttila'), ('cyeh2@babson.edu', 'p-connor-yeh'), ('rburke4@babson.edu', 'p-riley-burke'),
  ('mvessali1@babson.edu', 'p-milad-vessali'), ('jsecco1@babson.edu', 'p-johnny-secco'), ('jposada1@babson.edu', 'p-jesse-posada'),
  ('iyoussef1@babson.edu', 'p-izzy-youssef'), ('msakharuk1@babson.edu', 'p-masha-sakharuk'), ('awidmer1@babson.edu', 'p-angelina-widmer'),
  ('otoothman1@babson.edu', 'p-liv-taylor'), ('laubutlaurin1@babson.edu', 'p-leanne-aubut'), ('vskydan1@babson.edu', 'p-valeriia-skydan'),
  ('aprewo1@babson.edu', 'p-avery-prewo'), ('ameyers1@babson.edu', 'p-ali-meyers'),
  ('mads.syversen@gmail.com', 'b-mads-syversen'),
  ('msyversen1@babson.edu', 'b-mads-syversen'), ('mcreamer1@babson.edu', 'b-maisie-creamer');

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null check (char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  event_type text not null check (event_type in ('Wedding', 'Birthday', 'College event', 'Community gathering', 'Other')),
  event_date date not null,
  city text not null check (char_length(city) between 1 and 120),
  budget numeric(12, 2) not null check (budget between 10000 and 1000000000),
  guests integer not null check (guests between 1 and 100000),
  theme text not null default '',
  food text not null default '',
  venue text not null default '',
  requirements text not null default '',
  concept text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.event_expenses (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  planned numeric(12, 2) not null check (planned between 0 and 1000000000),
  actual numeric(12, 2) not null check (actual between 0 and 1000000000),
  color text not null default '#7654a3' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, owner_id) references public.events (id, owner_id) on delete cascade
);

create table public.event_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text not null default '' check (char_length(description) <= 1000),
  due_date date not null,
  priority text not null check (priority in ('High', 'Medium', 'Low')),
  status text not null check (status in ('To do', 'In progress', 'Done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, owner_id) references public.events (id, owner_id) on delete cascade
);

create table public.event_vendors (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (char_length(category) between 1 and 120),
  estimated_cost numeric(12, 2) not null default 0 check (estimated_cost between 0 and 1000000000),
  status text not null check (status in ('To do', 'Contacted', 'Booked')),
  contact text not null default '' check (char_length(contact) <= 160),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, owner_id) references public.events (id, owner_id) on delete cascade
);

create table public.ai_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'gemini' check (provider in ('gemini')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, owner_id) references public.events (id, owner_id) on delete cascade
);

create index events_owner_date_idx on public.events (owner_id, event_date);
create index event_expenses_owner_event_idx on public.event_expenses (owner_id, event_id);
create index event_tasks_owner_event_due_idx on public.event_tasks (owner_id, event_id, due_date);
create index event_vendors_owner_event_idx on public.event_vendors (owner_id, event_id);
create index ai_plans_owner_event_idx on public.ai_plans (owner_id, event_id);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function public.set_updated_at();
create trigger event_expenses_set_updated_at before update on public.event_expenses
for each row execute function public.set_updated_at();
create trigger event_tasks_set_updated_at before update on public.event_tasks
for each row execute function public.set_updated_at();
create trigger event_vendors_set_updated_at before update on public.event_vendors
for each row execute function public.set_updated_at();
create trigger ai_plans_set_updated_at before update on public.ai_plans
for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'HappiXO customer'),
    coalesce(new.email, ''),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do update
  set email = excluded.email, updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function public.create_profile_for_new_user();

insert into public.profiles (id, full_name, email, phone)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), 'HappiXO customer'),
  coalesce(u.email, ''),
  nullif(trim(u.raw_user_meta_data ->> 'phone'), '')
from auth.users u
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_expenses enable row level security;
alter table public.event_tasks enable row level security;
alter table public.event_vendors enable row level security;
alter table public.ai_plans enable row level security;

create policy "Customers can read their own profile" on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy "Customers can create their own profile" on public.profiles
for insert to authenticated with check ((select auth.uid()) = id);
create policy "Customers can update their own profile" on public.profiles
for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Customers can delete their own profile" on public.profiles
for delete to authenticated using ((select auth.uid()) = id);

create policy "Customers can manage their own events" on public.events
for all to authenticated using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy "Customers can manage their own event expenses" on public.event_expenses
for all to authenticated using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid()))
);
create policy "Customers can manage their own event tasks" on public.event_tasks
for all to authenticated using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid()))
);
create policy "Customers can manage their own event vendors" on public.event_vendors
for all to authenticated using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid()))
);
create policy "Customers can manage their own AI plans" on public.ai_plans
for all to authenticated using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (select 1 from public.events e where e.id = event_id and e.owner_id = (select auth.uid()))
);

create or replace function public.save_event_plan(
  p_event jsonb,
  p_expenses jsonb,
  p_tasks jsonb,
  p_vendors jsonb,
  p_ai_plan jsonb default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_owner_id uuid := (p_event ->> 'owner_id')::uuid;
begin
  if auth.uid() is null or auth.uid() <> v_owner_id then
    raise exception 'Not authorized to save this event.' using errcode = '42501';
  end if;

  insert into public.events (
    id, owner_id, name, event_type, event_date, city, budget, guests, theme, food, venue, requirements, concept
  ) values (
    (p_event ->> 'id')::uuid, v_owner_id, p_event ->> 'name', p_event ->> 'event_type',
    (p_event ->> 'event_date')::date, p_event ->> 'city', (p_event ->> 'budget')::numeric,
    (p_event ->> 'guests')::integer, coalesce(p_event ->> 'theme', ''), coalesce(p_event ->> 'food', ''),
    coalesce(p_event ->> 'venue', ''), coalesce(p_event ->> 'requirements', ''), coalesce(p_event ->> 'concept', '')
  )
  on conflict (id) do update set
    name = excluded.name, event_type = excluded.event_type, event_date = excluded.event_date,
    city = excluded.city, budget = excluded.budget, guests = excluded.guests, theme = excluded.theme,
    food = excluded.food, venue = excluded.venue, requirements = excluded.requirements,
    concept = excluded.concept, updated_at = now()
  where public.events.owner_id = auth.uid()
  returning * into v_event;

  if v_event.id is null then
    raise exception 'Event is not owned by this customer.' using errcode = '42501';
  end if;

  delete from public.event_expenses where event_id = v_event.id and owner_id = v_owner_id;
  insert into public.event_expenses (id, event_id, owner_id, name, planned, actual, color)
  select x.id, v_event.id, v_owner_id, x.name, x.planned, x.actual, coalesce(x.color, '#7654a3')
  from jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) as x(
    id uuid, name text, planned numeric, actual numeric, color text
  );

  delete from public.event_tasks where event_id = v_event.id and owner_id = v_owner_id;
  insert into public.event_tasks (id, event_id, owner_id, name, description, due_date, priority, status)
  select x.id, v_event.id, v_owner_id, x.name, coalesce(x.description, ''), x.due_date, x.priority, x.status
  from jsonb_to_recordset(coalesce(p_tasks, '[]'::jsonb)) as x(
    id uuid, name text, description text, due_date date, priority text, status text
  );

  delete from public.event_vendors where event_id = v_event.id and owner_id = v_owner_id;
  insert into public.event_vendors (id, event_id, owner_id, category, estimated_cost, status, contact, notes)
  select x.id, v_event.id, v_owner_id, x.category, x.estimated_cost, x.status, coalesce(x.contact, ''), coalesce(x.notes, '')
  from jsonb_to_recordset(coalesce(p_vendors, '[]'::jsonb)) as x(
    id uuid, category text, estimated_cost numeric, status text, contact text, notes text
  );

  if p_ai_plan is not null then
    insert into public.ai_plans (event_id, owner_id, provider, plan)
    values (v_event.id, v_owner_id, coalesce(p_ai_plan ->> 'provider', 'gemini'), p_ai_plan -> 'plan')
    on conflict (event_id) do update set
      provider = excluded.provider, plan = excluded.plan, updated_at = now()
    where public.ai_plans.owner_id = auth.uid();
  end if;

  return v_event.id;
end;
$$;

revoke all on function public.save_event_plan(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_event_plan(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

revoke all on public.profiles, public.events, public.event_expenses, public.event_tasks, public.event_vendors, public.ai_plans from public, anon;
revoke all on public.profiles from authenticated;
grant select, update (full_name, phone) on public.profiles to authenticated;
grant select, insert, update, delete on public.events, public.event_expenses, public.event_tasks, public.event_vendors, public.ai_plans to authenticated;

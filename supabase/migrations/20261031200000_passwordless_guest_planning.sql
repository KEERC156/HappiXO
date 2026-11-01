create table if not exists public.customer_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 320),
  mobile_number text not null check (char_length(mobile_number) between 7 and 24),
  guest_session_hash text not null unique check (guest_session_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists customer_leads_set_updated_at on public.customer_leads;
create trigger customer_leads_set_updated_at before update on public.customer_leads
for each row execute function public.set_updated_at();

alter table public.events
  alter column owner_id drop not null,
  add column if not exists guest_lead_id uuid references public.customer_leads (id) on delete cascade;

alter table public.event_expenses
  alter column owner_id drop not null,
  add column if not exists guest_lead_id uuid references public.customer_leads (id) on delete cascade;

alter table public.event_tasks
  alter column owner_id drop not null,
  add column if not exists guest_lead_id uuid references public.customer_leads (id) on delete cascade;

alter table public.event_vendors
  alter column owner_id drop not null,
  add column if not exists guest_lead_id uuid references public.customer_leads (id) on delete cascade;

alter table public.ai_plans
  alter column owner_id drop not null,
  add column if not exists guest_lead_id uuid references public.customer_leads (id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_id_guest_lead_key') then
    alter table public.events add constraint events_id_guest_lead_key unique (id, guest_lead_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_exactly_one_owner_check') then
    alter table public.events add constraint events_exactly_one_owner_check
      check ((owner_id is null) <> (guest_lead_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_expenses_id_guest_lead_key') then
    alter table public.event_expenses add constraint event_expenses_id_guest_lead_key unique (id, guest_lead_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_expenses_exactly_one_owner_check') then
    alter table public.event_expenses add constraint event_expenses_exactly_one_owner_check
      check ((owner_id is null) <> (guest_lead_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_expenses_guest_event_fk') then
    alter table public.event_expenses add constraint event_expenses_guest_event_fk
      foreign key (event_id, guest_lead_id) references public.events (id, guest_lead_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_tasks_id_guest_lead_key') then
    alter table public.event_tasks add constraint event_tasks_id_guest_lead_key unique (id, guest_lead_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_tasks_exactly_one_owner_check') then
    alter table public.event_tasks add constraint event_tasks_exactly_one_owner_check
      check ((owner_id is null) <> (guest_lead_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_tasks_guest_event_fk') then
    alter table public.event_tasks add constraint event_tasks_guest_event_fk
      foreign key (event_id, guest_lead_id) references public.events (id, guest_lead_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_vendors_id_guest_lead_key') then
    alter table public.event_vendors add constraint event_vendors_id_guest_lead_key unique (id, guest_lead_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_vendors_exactly_one_owner_check') then
    alter table public.event_vendors add constraint event_vendors_exactly_one_owner_check
      check ((owner_id is null) <> (guest_lead_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_vendors_guest_event_fk') then
    alter table public.event_vendors add constraint event_vendors_guest_event_fk
      foreign key (event_id, guest_lead_id) references public.events (id, guest_lead_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_plans_exactly_one_owner_check') then
    alter table public.ai_plans add constraint ai_plans_exactly_one_owner_check
      check ((owner_id is null) <> (guest_lead_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_plans_guest_event_fk') then
    alter table public.ai_plans add constraint ai_plans_guest_event_fk
      foreign key (event_id, guest_lead_id) references public.events (id, guest_lead_id) on delete cascade;
  end if;
end;
$$;

create index if not exists customer_leads_created_at_idx on public.customer_leads (created_at desc);
create index if not exists events_guest_lead_date_idx on public.events (guest_lead_id, event_date) where guest_lead_id is not null;
create index if not exists event_expenses_guest_event_idx on public.event_expenses (guest_lead_id, event_id) where guest_lead_id is not null;
create index if not exists event_tasks_guest_event_due_idx on public.event_tasks (guest_lead_id, event_id, due_date) where guest_lead_id is not null;
create index if not exists event_vendors_guest_event_idx on public.event_vendors (guest_lead_id, event_id) where guest_lead_id is not null;
create index if not exists ai_plans_guest_event_idx on public.ai_plans (guest_lead_id, event_id) where guest_lead_id is not null;

alter table public.customer_leads enable row level security;
alter table public.events enable row level security;
alter table public.event_expenses enable row level security;
alter table public.event_tasks enable row level security;
alter table public.event_vendors enable row level security;
alter table public.ai_plans enable row level security;
revoke all on public.customer_leads from public, anon, authenticated;
grant all on public.customer_leads to service_role;
revoke all on public.events, public.event_expenses, public.event_tasks, public.event_vendors, public.ai_plans from public, anon;
grant all on public.events, public.event_expenses, public.event_tasks, public.event_vendors, public.ai_plans to service_role;

create or replace function public.save_guest_event_plan(
  p_guest_lead_id uuid,
  p_session_hash text,
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
begin
  if not exists (
    select 1 from public.customer_leads l
    where l.id = p_guest_lead_id and l.guest_session_hash = p_session_hash
  ) then
    raise exception 'Guest session is invalid.' using errcode = '42501';
  end if;

  insert into public.events (
    id, owner_id, guest_lead_id, name, event_type, event_date, city, budget, guests,
    theme, food, venue, requirements, concept
  ) values (
    (p_event ->> 'id')::uuid, null, p_guest_lead_id, p_event ->> 'name',
    p_event ->> 'event_type', (p_event ->> 'event_date')::date, p_event ->> 'city',
    (p_event ->> 'budget')::numeric, (p_event ->> 'guests')::integer,
    coalesce(p_event ->> 'theme', ''), coalesce(p_event ->> 'food', ''),
    coalesce(p_event ->> 'venue', ''), coalesce(p_event ->> 'requirements', ''),
    coalesce(p_event ->> 'concept', '')
  )
  on conflict (id) do update set
    name = excluded.name, event_type = excluded.event_type, event_date = excluded.event_date,
    city = excluded.city, budget = excluded.budget, guests = excluded.guests,
    theme = excluded.theme, food = excluded.food, venue = excluded.venue,
    requirements = excluded.requirements, concept = excluded.concept, updated_at = now()
  where public.events.owner_id is null
    and public.events.guest_lead_id = p_guest_lead_id
  returning * into v_event;

  if v_event.id is null then
    raise exception 'Event is not owned by this guest session.' using errcode = '42501';
  end if;

  delete from public.event_expenses where event_id = v_event.id and guest_lead_id = p_guest_lead_id;
  insert into public.event_expenses (id, event_id, owner_id, guest_lead_id, name, planned, actual, color)
  select x.id, v_event.id, null, p_guest_lead_id, x.name, x.planned, x.actual, coalesce(x.color, '#7654a3')
  from jsonb_to_recordset(coalesce(p_expenses, '[]'::jsonb)) as x(
    id uuid, name text, planned numeric, actual numeric, color text
  );

  delete from public.event_tasks where event_id = v_event.id and guest_lead_id = p_guest_lead_id;
  insert into public.event_tasks (id, event_id, owner_id, guest_lead_id, name, description, due_date, priority, status)
  select x.id, v_event.id, null, p_guest_lead_id, x.name, coalesce(x.description, ''), x.due_date, x.priority, x.status
  from jsonb_to_recordset(coalesce(p_tasks, '[]'::jsonb)) as x(
    id uuid, name text, description text, due_date date, priority text, status text
  );

  delete from public.event_vendors where event_id = v_event.id and guest_lead_id = p_guest_lead_id;
  insert into public.event_vendors (id, event_id, owner_id, guest_lead_id, category, estimated_cost, status, contact, notes)
  select x.id, v_event.id, null, p_guest_lead_id, x.category, x.estimated_cost, x.status, coalesce(x.contact, ''), coalesce(x.notes, '')
  from jsonb_to_recordset(coalesce(p_vendors, '[]'::jsonb)) as x(
    id uuid, category text, estimated_cost numeric, status text, contact text, notes text
  );

  if p_ai_plan is null then
    delete from public.ai_plans where event_id = v_event.id and guest_lead_id = p_guest_lead_id;
  else
    insert into public.ai_plans (event_id, owner_id, guest_lead_id, provider, plan)
    values (v_event.id, null, p_guest_lead_id, 'gemini', p_ai_plan)
    on conflict (event_id) do update set
      provider = 'gemini', plan = excluded.plan, updated_at = now()
    where public.ai_plans.guest_lead_id = p_guest_lead_id
      and public.ai_plans.owner_id is null;
  end if;

  return v_event.id;
end;
$$;

revoke all on function public.save_guest_event_plan(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_guest_event_plan(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- HappiXO Hack2Skills demo data. Every event, vendor, task, and AI plan here is
-- illustrative SAMPLE content, not a real booking or Gemini-generated response.
-- Guest events are linked to existing public.customer_leads rows; no auth users
-- or profiles are created, and Row Level Security is not disabled.
--
-- Run in the Supabase SQL Editor after both project migrations have been applied.
-- This transaction is insert-only for data. Fixed IDs and conflict handling make
-- reruns safe; it will stop rather than overwrite existing event records.

begin;

create temporary table happixo_demo_events (
  id uuid primary key,
  customer_email text not null,
  customer_name text not null,
  name text not null,
  event_type text not null,
  event_date date not null,
  city text not null,
  budget numeric(12, 2) not null,
  guests integer not null,
  theme text not null,
  food text not null,
  venue text not null,
  requirements text not null,
  concept text not null
) on commit drop;

insert into happixo_demo_events values
  ('da000001-0000-4000-8000-000000000001', 'rahul.demo@example.com', 'Rahul Sharma',
   '[DEMO] Grand Wedding Celebration', 'Wedding', '2027-05-15', 'Bengaluru', 800000, 350,
   'Modern South Indian garden wedding', 'Vegetarian and regional buffet', 'Outdoor garden and banquet',
   'DEMO SAMPLE ONLY. Verify all venues, suppliers, prices, and arrangements independently.',
   'DEMO/SAMPLE wedding plan for Rahul Sharma; all recommendations and estimates are illustrative.'),
  ('da000002-0000-4000-8000-000000000002', 'priya.demo@example.com', 'Priya Patel',
   '[DEMO] Birthday Celebration', 'Birthday', '2027-02-20', 'Mysuru', 50000, 60,
   'Colourful garden birthday', 'Snacks, dinner buffet, and birthday cake', 'Indoor party hall',
   'DEMO SAMPLE ONLY. Verify all venues, suppliers, prices, and arrangements independently.',
   'DEMO/SAMPLE birthday plan for Priya Patel; all recommendations and estimates are illustrative.'),
  ('da000003-0000-4000-8000-000000000003', 'arjun.demo@example.com', 'Arjun Kumar',
   '[DEMO] Community Cultural Festival', 'Community gathering', '2027-03-20', 'Davangere', 250000, 500,
   'Local arts and culture festival', 'Community lunch and refreshments', 'Open community grounds',
   'DEMO SAMPLE ONLY. Confirm permits, accessibility, safety, and supplier details independently.',
   'DEMO/SAMPLE cultural festival plan for Arjun Kumar; all recommendations and estimates are illustrative.'),
  ('da000004-0000-4000-8000-000000000004', 'sneha.demo@example.com', 'Sneha Rao',
   '[DEMO] Engagement Ceremony', 'Other', '2027-01-30', 'Shivamogga', 150000, 120,
   'Traditional floral engagement', 'Vegetarian celebratory meal', 'Indoor function hall',
   'DEMO SAMPLE ONLY. Verify all venues, suppliers, prices, and arrangements independently.',
   'DEMO/SAMPLE engagement plan for Sneha Rao; all recommendations and estimates are illustrative.');

do $$
declare
  provider_constraint_name text;
begin
  if exists (
    select 1
    from happixo_demo_events d
    left join public.customer_leads c
      on c.email = d.customer_email and c.full_name = d.customer_name
    group by d.customer_email
    having count(c.id) <> 1
  ) then
    raise exception 'Each demo event must match exactly one existing customer_leads record by email and name.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.ai_plans'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%provider%'
      and pg_get_constraintdef(c.oid) ilike '%gemini%'
      and pg_get_constraintdef(c.oid) ilike '%demo%'
  ) then
    if not exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.ai_plans'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%provider%'
        and pg_get_constraintdef(c.oid) ilike '%gemini%'
        and pg_get_constraintdef(c.oid) not ilike '%demo%'
    ) then
      raise exception 'Could not find the expected ai_plans provider constraint; inspect the schema before seeding.';
    end if;

    select c.conname into provider_constraint_name
    from pg_constraint c
    where c.conrelid = 'public.ai_plans'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%provider%'
      and pg_get_constraintdef(c.oid) ilike '%gemini%'
      and pg_get_constraintdef(c.oid) not ilike '%demo%';

    execute format('alter table public.ai_plans drop constraint %I', provider_constraint_name);
    alter table public.ai_plans
      add constraint ai_plans_provider_check check (provider in ('gemini', 'demo'));
  end if;
end;
$$;

insert into public.events (
  id, owner_id, guest_lead_id, name, event_type, event_date, city, budget, guests,
  theme, food, venue, requirements, concept
)
select d.id, null, c.id, d.name, d.event_type, d.event_date, d.city, d.budget, d.guests,
       d.theme, d.food, d.venue, d.requirements, d.concept
from happixo_demo_events d
join public.customer_leads c
  on c.email = d.customer_email and c.full_name = d.customer_name
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1
    from happixo_demo_events d
    left join public.customer_leads c
      on c.email = d.customer_email and c.full_name = d.customer_name
    left join public.events e on e.id = d.id
    where e.id is null
       or e.guest_lead_id is distinct from c.id
       or e.owner_id is not null
       or e.name is distinct from d.name
  ) then
    raise exception 'A fixed demo event ID is already used by a different record; no seed data was committed.';
  end if;
end;
$$;

create temporary table happixo_demo_expenses (
  id uuid primary key,
  event_id uuid not null,
  name text not null,
  planned numeric(12, 2) not null,
  actual numeric(12, 2) not null,
  color text not null
) on commit drop;

insert into happixo_demo_expenses values
  ('db000001-0000-4000-8001-000000000001', 'da000001-0000-4000-8000-000000000001', 'Venue and banquet', 160000, 20000, '#7654a3'),
  ('db000002-0000-4000-8001-000000000002', 'da000001-0000-4000-8000-000000000001', 'Catering', 220000, 35000, '#c88d83'),
  ('db000003-0000-4000-8001-000000000003', 'da000001-0000-4000-8000-000000000001', 'Decoration and flowers', 150000, 20000, '#b89a60'),
  ('db000004-0000-4000-8001-000000000004', 'da000001-0000-4000-8000-000000000001', 'Photography and video', 85000, 10000, '#748e7d'),
  ('db000005-0000-4000-8001-000000000005', 'da000001-0000-4000-8000-000000000001', 'Entertainment and music', 65000, 0, '#ab91be'),
  ('db000006-0000-4000-8001-000000000006', 'da000001-0000-4000-8000-000000000001', 'Guest transport', 45000, 5000, '#d5a984'),
  ('db000007-0000-4000-8001-000000000007', 'da000002-0000-4000-8000-000000000002', 'Birthday cake and desserts', 7000, 1500, '#7654a3'),
  ('db000008-0000-4000-8001-000000000008', 'da000002-0000-4000-8000-000000000002', 'Decoration and balloons', 9000, 2000, '#c88d83'),
  ('db000009-0000-4000-8001-000000000009', 'da000002-0000-4000-8000-000000000002', 'Catering and refreshments', 14000, 3000, '#b89a60'),
  ('db000010-0000-4000-8001-000000000010', 'da000002-0000-4000-8000-000000000002', 'Photography', 6000, 0, '#748e7d'),
  ('db000011-0000-4000-8001-000000000011', 'da000002-0000-4000-8000-000000000002', 'Games and party activities', 5000, 1000, '#ab91be'),
  ('db000012-0000-4000-8001-000000000012', 'da000003-0000-4000-8000-000000000003', 'Stage and event setup', 55000, 10000, '#7654a3'),
  ('db000013-0000-4000-8001-000000000013', 'da000003-0000-4000-8000-000000000003', 'Sound and lighting system', 34000, 5000, '#c88d83'),
  ('db000014-0000-4000-8001-000000000014', 'da000003-0000-4000-8000-000000000003', 'Community food service', 72000, 12000, '#b89a60'),
  ('db000015-0000-4000-8001-000000000015', 'da000003-0000-4000-8000-000000000003', 'Volunteer materials and support', 22000, 4000, '#748e7d'),
  ('db000016-0000-4000-8001-000000000016', 'da000003-0000-4000-8000-000000000003', 'Cultural activities and artists', 38000, 6000, '#ab91be'),
  ('db000017-0000-4000-8001-000000000017', 'da000003-0000-4000-8000-000000000003', 'Permits and safety provisions', 10000, 0, '#d5a984'),
  ('db000018-0000-4000-8001-000000000018', 'da000004-0000-4000-8000-000000000004', 'Venue and function hall', 45000, 10000, '#7654a3'),
  ('db000019-0000-4000-8001-000000000019', 'da000004-0000-4000-8000-000000000004', 'Floral decoration', 28000, 5000, '#c88d83'),
  ('db000020-0000-4000-8001-000000000020', 'da000004-0000-4000-8000-000000000004', 'Catering', 35000, 8000, '#b89a60'),
  ('db000021-0000-4000-8001-000000000021', 'da000004-0000-4000-8000-000000000004', 'Photography', 19000, 3000, '#748e7d'),
  ('db000022-0000-4000-8001-000000000022', 'da000004-0000-4000-8000-000000000004', 'Invitations and printing', 8000, 1000, '#ab91be'),
  ('db000023-0000-4000-8001-000000000023', 'da000004-0000-4000-8000-000000000004', 'Guest transport', 6000, 0, '#d5a984');

insert into public.event_expenses (id, event_id, owner_id, guest_lead_id, name, planned, actual, color)
select x.id, x.event_id, null, c.id, x.name, x.planned, x.actual, x.color
from happixo_demo_expenses x
join happixo_demo_events d on d.id = x.event_id
join public.customer_leads c on c.email = d.customer_email
on conflict (id) do nothing;

create temporary table happixo_demo_tasks (
  id uuid primary key,
  event_id uuid not null,
  name text not null,
  description text not null,
  due_date date not null,
  priority text not null,
  status text not null
) on commit drop;

insert into happixo_demo_tasks values
  ('dc000001-0000-4000-8002-000000000001', 'da000001-0000-4000-8000-000000000001', 'Confirm garden venue and guest capacity', 'DEMO TASK. Review access, rain cover, parking, and the sample contract.', '2027-01-15', 'High', 'Done'),
  ('dc000002-0000-4000-8002-000000000002', 'da000001-0000-4000-8000-000000000001', 'Shortlist caterers and regional menu', 'DEMO TASK. Request sample menus and dietary options.', '2027-02-10', 'High', 'Done'),
  ('dc000003-0000-4000-8002-000000000003', 'da000001-0000-4000-8000-000000000001', 'Approve floral and stage design', 'DEMO TASK. Compare a day-of setup plan with the garden layout.', '2027-03-01', 'Medium', 'In progress'),
  ('dc000004-0000-4000-8002-000000000004', 'da000001-0000-4000-8000-000000000001', 'Finalize photography and video brief', 'DEMO TASK. List key family portraits and ceremony moments.', '2027-03-20', 'Medium', 'To do'),
  ('dc000005-0000-4000-8002-000000000005', 'da000001-0000-4000-8000-000000000001', 'Confirm music and entertainment schedule', 'DEMO TASK. Check sound limits and stage changeover time.', '2027-04-01', 'Medium', 'To do'),
  ('dc000006-0000-4000-8002-000000000006', 'da000001-0000-4000-8000-000000000001', 'Share guest transport and arrival details', 'DEMO TASK. Prepare a sample travel and parking note.', '2027-05-01', 'Low', 'To do'),
  ('dc000007-0000-4000-8002-000000000007', 'da000002-0000-4000-8000-000000000002', 'Choose birthday cake flavours and design', 'DEMO TASK. Confirm serving size and dietary requirements.', '2026-12-20', 'High', 'Done'),
  ('dc000008-0000-4000-8002-000000000008', 'da000002-0000-4000-8000-000000000002', 'Confirm party hall layout and decoration', 'DEMO TASK. Plan a cake table, seating, and photo corner.', '2027-01-05', 'Medium', 'In progress'),
  ('dc000009-0000-4000-8002-000000000009', 'da000002-0000-4000-8000-000000000002', 'Select snacks and birthday dinner menu', 'DEMO TASK. Estimate portions for 60 guests.', '2027-01-15', 'Medium', 'To do'),
  ('dc000010-0000-4000-8002-000000000010', 'da000002-0000-4000-8000-000000000002', 'Prepare games and activity materials', 'DEMO TASK. Include activities suitable for mixed age groups.', '2027-02-01', 'Low', 'To do'),
  ('dc000011-0000-4000-8002-000000000011', 'da000002-0000-4000-8000-000000000002', 'Confirm photographer and event timings', 'DEMO TASK. Share a simple shot list and arrival time.', '2027-02-05', 'Medium', 'To do'),
  ('dc000012-0000-4000-8002-000000000012', 'da000002-0000-4000-8000-000000000002', 'Send invitations and collect RSVPs', 'DEMO TASK. Track responses and accessibility needs.', '2027-02-10', 'High', 'To do'),
  ('dc000013-0000-4000-8002-000000000013', 'da000003-0000-4000-8000-000000000003', 'Confirm grounds, permissions, and safety plan', 'DEMO TASK. Verify local permissions, first aid, and accessible routes.', '2026-12-20', 'High', 'Done'),
  ('dc000014-0000-4000-8002-000000000014', 'da000003-0000-4000-8000-000000000003', 'Prepare stage, sound, and power requirements', 'DEMO TASK. Check stage size, backup power, and sound checks.', '2027-01-20', 'High', 'In progress'),
  ('dc000015-0000-4000-8002-000000000015', 'da000003-0000-4000-8000-000000000003', 'Invite local cultural groups and performers', 'DEMO TASK. Draft a sample running order and participation plan.', '2027-02-01', 'Medium', 'To do'),
  ('dc000016-0000-4000-8002-000000000016', 'da000003-0000-4000-8000-000000000003', 'Plan volunteer shifts and briefing', 'DEMO TASK. Assign welcome, seating, and clean-up roles.', '2027-02-20', 'Medium', 'To do'),
  ('dc000017-0000-4000-8002-000000000017', 'da000003-0000-4000-8000-000000000003', 'Confirm community lunch and water stations', 'DEMO TASK. Plan serving windows and waste reduction.', '2027-03-01', 'High', 'To do'),
  ('dc000018-0000-4000-8002-000000000018', 'da000003-0000-4000-8000-000000000003', 'Publish festival schedule and visitor information', 'DEMO TASK. Share timings, access, and transport guidance.', '2027-03-10', 'Low', 'To do'),
  ('dc000019-0000-4000-8002-000000000019', 'da000004-0000-4000-8000-000000000004', 'Confirm function hall and ceremony layout', 'DEMO TASK. Review seating, stage, access, and timing.', '2026-12-10', 'High', 'Done'),
  ('dc000020-0000-4000-8002-000000000020', 'da000004-0000-4000-8000-000000000004', 'Choose floral decoration and ceremony backdrop', 'DEMO TASK. Coordinate sample colours and installation timing.', '2026-12-20', 'Medium', 'In progress'),
  ('dc000021-0000-4000-8002-000000000021', 'da000004-0000-4000-8000-000000000004', 'Finalize vegetarian menu and service plan', 'DEMO TASK. Confirm menu, portions, and dietary labels.', '2027-01-05', 'High', 'To do'),
  ('dc000022-0000-4000-8002-000000000022', 'da000004-0000-4000-8000-000000000004', 'Prepare engagement invitation list and proofs', 'DEMO TASK. Proofread names, date, and venue before printing.', '2027-01-05', 'Medium', 'To do'),
  ('dc000023-0000-4000-8002-000000000023', 'da000004-0000-4000-8000-000000000004', 'Share photography schedule with family', 'DEMO TASK. Identify key portraits and ceremony moments.', '2027-01-15', 'Low', 'To do'),
  ('dc000024-0000-4000-8002-000000000024', 'da000004-0000-4000-8000-000000000004', 'Confirm guest arrival and transport details', 'DEMO TASK. Prepare a sample parking and arrival note.', '2027-01-25', 'Low', 'To do');

insert into public.event_tasks (id, event_id, owner_id, guest_lead_id, name, description, due_date, priority, status)
select x.id, x.event_id, null, c.id, x.name, x.description, x.due_date, x.priority, x.status
from happixo_demo_tasks x
join happixo_demo_events d on d.id = x.event_id
join public.customer_leads c on c.email = d.customer_email
on conflict (id) do nothing;

create temporary table happixo_demo_vendors (
  id uuid primary key,
  event_id uuid not null,
  category text not null,
  estimated_cost numeric(12, 2) not null,
  status text not null,
  contact text not null,
  notes text not null
) on commit drop;

insert into happixo_demo_vendors values
  ('dd000001-0000-4000-8003-000000000001', 'da000001-0000-4000-8000-000000000001', 'Venue', 160000, 'To do', 'DEMO SAMPLE — Bengaluru Garden Venue', 'Illustrative supplier name only; no real venue is contacted or booked.'),
  ('dd000002-0000-4000-8003-000000000002', 'da000001-0000-4000-8000-000000000001', 'Catering', 220000, 'To do', 'DEMO SAMPLE — Karnataka Feast Caterers', 'Illustrative estimate; verify menu, taxes, and availability.'),
  ('dd000003-0000-4000-8003-000000000003', 'da000001-0000-4000-8000-000000000001', 'Decoration', 150000, 'To do', 'DEMO SAMPLE — Marigold Design Studio', 'Illustrative supplier name only; not a real business engagement.'),
  ('dd000004-0000-4000-8003-000000000004', 'da000001-0000-4000-8000-000000000001', 'Photography and video', 85000, 'To do', 'DEMO SAMPLE — Celebration Photo Team', 'Sample estimate; no photographer has been hired.'),
  ('dd000005-0000-4000-8003-000000000005', 'da000001-0000-4000-8000-000000000001', 'Entertainment', 65000, 'To do', 'DEMO SAMPLE — Bengaluru Live Music', 'Illustrative option; no performer is booked.'),
  ('dd000006-0000-4000-8003-000000000006', 'da000002-0000-4000-8000-000000000002', 'Cake and desserts', 7000, 'To do', 'DEMO SAMPLE — Mysuru Celebration Bakery', 'Illustrative supplier name only; no order has been placed.'),
  ('dd000007-0000-4000-8003-000000000007', 'da000002-0000-4000-8000-000000000002', 'Decoration', 9000, 'To do', 'DEMO SAMPLE — Colourful Day Decor', 'Sample estimate; no decorator has been hired.'),
  ('dd000008-0000-4000-8003-000000000008', 'da000002-0000-4000-8000-000000000002', 'Catering', 14000, 'To do', 'DEMO SAMPLE — Mysuru Party Catering', 'Illustrative estimate; verify portions and availability.'),
  ('dd000009-0000-4000-8003-000000000009', 'da000002-0000-4000-8000-000000000002', 'Photography', 6000, 'To do', 'DEMO SAMPLE — Birthday Moments Photo', 'Illustrative supplier name only; not a booking.'),
  ('dd000010-0000-4000-8003-000000000010', 'da000002-0000-4000-8000-000000000002', 'Games and activities', 5000, 'To do', 'DEMO SAMPLE — Party Games Kit', 'Sample activity estimate; not a real supplier.'),
  ('dd000011-0000-4000-8003-000000000011', 'da000003-0000-4000-8000-000000000003', 'Stage and setup', 55000, 'To do', 'DEMO SAMPLE — Davangere Stage Works', 'Illustrative supplier name only; no stage is reserved.'),
  ('dd000012-0000-4000-8003-000000000012', 'da000003-0000-4000-8000-000000000003', 'Sound and lighting', 34000, 'To do', 'DEMO SAMPLE — Community Sound Services', 'Sample estimate; verify power and sound requirements.'),
  ('dd000013-0000-4000-8003-000000000013', 'da000003-0000-4000-8000-000000000003', 'Food service', 72000, 'To do', 'DEMO SAMPLE — Davangere Community Kitchen', 'Illustrative estimate for a community menu; not a real booking.'),
  ('dd000014-0000-4000-8003-000000000014', 'da000003-0000-4000-8000-000000000003', 'Cultural activities', 38000, 'To do', 'DEMO SAMPLE — Karnataka Folk Arts Collective', 'Illustrative supplier name only; no artists are booked.'),
  ('dd000015-0000-4000-8003-000000000015', 'da000004-0000-4000-8000-000000000004', 'Venue', 45000, 'To do', 'DEMO SAMPLE — Shivamogga Function Hall', 'Illustrative supplier name only; no venue is reserved.'),
  ('dd000016-0000-4000-8003-000000000016', 'da000004-0000-4000-8000-000000000004', 'Decoration', 28000, 'To do', 'DEMO SAMPLE — Floral Moments Studio', 'Sample estimate; no decorator has been hired.'),
  ('dd000017-0000-4000-8003-000000000017', 'da000004-0000-4000-8000-000000000004', 'Catering', 35000, 'To do', 'DEMO SAMPLE — Shivamogga Vegetarian Catering', 'Illustrative estimate; verify dietary needs and availability.'),
  ('dd000018-0000-4000-8003-000000000018', 'da000004-0000-4000-8000-000000000004', 'Photography', 19000, 'To do', 'DEMO SAMPLE — Engagement Photo Team', 'Illustrative supplier name only; no photographer is hired.'),
  ('dd000019-0000-4000-8003-000000000019', 'da000004-0000-4000-8000-000000000004', 'Invitations and printing', 8000, 'To do', 'DEMO SAMPLE — Celebration Print Studio', 'Sample print estimate; no order has been placed.');

insert into public.event_vendors (id, event_id, owner_id, guest_lead_id, category, estimated_cost, status, contact, notes)
select x.id, x.event_id, null, c.id, x.category, x.estimated_cost, x.status, x.contact, x.notes
from happixo_demo_vendors x
join happixo_demo_events d on d.id = x.event_id
join public.customer_leads c on c.email = d.customer_email
on conflict (id) do nothing;

insert into public.ai_plans (event_id, owner_id, guest_lead_id, provider, plan)
select d.id, null, c.id, 'demo',
  jsonb_build_object(
    'provenance', 'DEMO/SAMPLE — Not generated by Gemini or any AI service.',
    'eventSummary', d.concept,
    'theme', jsonb_build_object(
      'name', d.theme,
      'description', 'DEMO/SAMPLE theme direction. Adapt it with the event host; this is not a confirmed design.',
      'colors', jsonb_build_array('#7654a3', '#c88d83', '#b89a60')
    ),
    'budget', case d.id
      when 'da000001-0000-4000-8000-000000000001'::uuid then
        '[{"category":"Venue","estimatedCost":160000,"reason":"DEMO estimate for a garden and banquet space."},{"category":"Catering","estimatedCost":220000,"reason":"DEMO estimate for a regional menu for 350 guests."},{"category":"Decoration","estimatedCost":150000,"reason":"DEMO estimate for flowers and ceremony setup."},{"category":"Photography","estimatedCost":85000,"reason":"DEMO estimate for photo and video coverage."},{"category":"Entertainment","estimatedCost":65000,"reason":"DEMO estimate for music and performance."}]'::jsonb
      when 'da000002-0000-4000-8000-000000000002'::uuid then
        '[{"category":"Cake","estimatedCost":7000,"reason":"DEMO estimate for a celebration cake and desserts."},{"category":"Decoration","estimatedCost":9000,"reason":"DEMO estimate for a simple party setup."},{"category":"Catering","estimatedCost":14000,"reason":"DEMO estimate for snacks and dinner."},{"category":"Photography","estimatedCost":6000,"reason":"DEMO estimate for short event coverage."},{"category":"Games","estimatedCost":5000,"reason":"DEMO estimate for activity materials."}]'::jsonb
      when 'da000003-0000-4000-8000-000000000003'::uuid then
        '[{"category":"Stage","estimatedCost":55000,"reason":"DEMO estimate for staging and event setup."},{"category":"Sound","estimatedCost":34000,"reason":"DEMO estimate for sound and lighting."},{"category":"Food","estimatedCost":72000,"reason":"DEMO estimate for community food service."},{"category":"Volunteers","estimatedCost":22000,"reason":"DEMO estimate for volunteer materials and support."},{"category":"Cultural activities","estimatedCost":38000,"reason":"DEMO estimate for local cultural programming."}]'::jsonb
      else
        '[{"category":"Venue","estimatedCost":45000,"reason":"DEMO estimate for an indoor function hall."},{"category":"Decoration","estimatedCost":28000,"reason":"DEMO estimate for floral ceremony decor."},{"category":"Catering","estimatedCost":35000,"reason":"DEMO estimate for a vegetarian meal."},{"category":"Photography","estimatedCost":19000,"reason":"DEMO estimate for ceremony coverage."},{"category":"Invitations","estimatedCost":8000,"reason":"DEMO estimate for invitation printing."}]'::jsonb
    end,
    'timeline', jsonb_build_array(
      jsonb_build_object('task', 'Confirm venue and event layout', 'daysBeforeEvent', 120, 'priority', 'high', 'description', 'DEMO milestone; check capacity, access, and contingency arrangements.'),
      jsonb_build_object('task', 'Review suppliers and budget estimates', 'daysBeforeEvent', 75, 'priority', 'high', 'description', 'DEMO milestone; obtain current quotes and confirm terms directly.'),
      jsonb_build_object('task', 'Finalize guest and service details', 'daysBeforeEvent', 30, 'priority', 'medium', 'description', 'DEMO milestone; confirm attendance, menu, and accessibility needs.'),
      jsonb_build_object('task', 'Complete final event-day walkthrough', 'daysBeforeEvent', 3, 'priority', 'medium', 'description', 'DEMO milestone; verify schedule and vendor arrangements.')
    ),
    'vendorChecklist', case d.id
      when 'da000001-0000-4000-8000-000000000001'::uuid then
        '[{"category":"Venue","estimatedCost":160000,"notes":"DEMO/SAMPLE only; no supplier is booked."},{"category":"Catering","estimatedCost":220000,"notes":"DEMO/SAMPLE estimate for 350 guests; verify current quotes."},{"category":"Decoration","estimatedCost":150000,"notes":"DEMO/SAMPLE only; not a confirmed design."},{"category":"Photography and video","estimatedCost":85000,"notes":"DEMO/SAMPLE estimate; no photographer is hired."}]'::jsonb
      when 'da000002-0000-4000-8000-000000000002'::uuid then
        '[{"category":"Cake","estimatedCost":7000,"notes":"DEMO/SAMPLE only; no order is placed."},{"category":"Decoration","estimatedCost":9000,"notes":"DEMO/SAMPLE estimate; no decorator is hired."},{"category":"Catering","estimatedCost":14000,"notes":"DEMO/SAMPLE estimate for 60 guests."},{"category":"Games","estimatedCost":5000,"notes":"DEMO/SAMPLE estimate for activity materials."}]'::jsonb
      when 'da000003-0000-4000-8000-000000000003'::uuid then
        '[{"category":"Stage","estimatedCost":55000,"notes":"DEMO/SAMPLE estimate; no stage is reserved."},{"category":"Sound system","estimatedCost":34000,"notes":"DEMO/SAMPLE estimate; check power and access."},{"category":"Food","estimatedCost":72000,"notes":"DEMO/SAMPLE estimate for community service."},{"category":"Cultural activities","estimatedCost":38000,"notes":"DEMO/SAMPLE only; no artists are booked."}]'::jsonb
      else
        '[{"category":"Venue","estimatedCost":45000,"notes":"DEMO/SAMPLE only; no venue is reserved."},{"category":"Decoration","estimatedCost":28000,"notes":"DEMO/SAMPLE estimate; not a confirmed design."},{"category":"Catering","estimatedCost":35000,"notes":"DEMO/SAMPLE estimate for 120 guests."},{"category":"Photography","estimatedCost":19000,"notes":"DEMO/SAMPLE estimate; no photographer is hired."}]'::jsonb
    end,
    'foodSuggestions', jsonb_build_array('DEMO/SAMPLE: offer clearly labelled vegetarian and dietary options.', 'DEMO/SAMPLE: confirm final portions with a real caterer.'),
    'activities', jsonb_build_array('DEMO/SAMPLE: add a host welcome and a relaxed group activity.'),
    'savingTips', jsonb_build_array('DEMO/SAMPLE: compare written quotes and keep a contingency reserve.'),
    'contingencyPlan', jsonb_build_array('DEMO/SAMPLE: identify an accessible backup space and weather plan.'),
    'costsAreEstimates', true
  )
from happixo_demo_events d
join public.customer_leads c
  on c.email = d.customer_email and c.full_name = d.customer_name
on conflict (event_id) do nothing;

do $$
begin
  if exists (
    select 1
    from happixo_demo_events d
    join public.customer_leads c on c.email = d.customer_email
    left join public.ai_plans p on p.event_id = d.id
    where p.event_id is null
       or p.guest_lead_id is distinct from c.id
       or p.owner_id is not null
       or p.provider <> 'demo'
       or coalesce(p.plan ->> 'provenance', '') not like 'DEMO/SAMPLE%'
  ) then
    raise exception 'A demo AI plan is missing, linked to the wrong lead, or not clearly marked as demo content.';
  end if;

  if exists (
    select 1
    from happixo_demo_events d
    left join happixo_demo_expenses x on x.event_id = d.id
    left join happixo_demo_tasks t on t.event_id = d.id
    left join happixo_demo_vendors v on v.event_id = d.id
    left join public.event_expenses ex on ex.id = x.id and ex.event_id = d.id
    left join public.event_tasks et on et.id = t.id and et.event_id = d.id
    left join public.event_vendors ev on ev.id = v.id and ev.event_id = d.id
    group by d.id
    having count(distinct x.id) <> count(distinct ex.id)
        or count(distinct t.id) <> count(distinct et.id)
        or count(distinct v.id) <> count(distinct ev.id)
  ) then
    raise exception 'A fixed demo child ID is already in use or a related demo record is missing.';
  end if;

  if exists (
    select 1
    from happixo_demo_events d
    join public.event_expenses x on x.event_id = d.id
    group by d.id, d.budget
    having sum(x.planned) > d.budget
  ) then
    raise exception 'A demo event expense allocation exceeds its event budget.';
  end if;
end;
$$;

commit;

select 'customer_leads' as table_name, count(*) as row_count from public.customer_leads
union all select 'events', count(*) from public.events
union all select 'event_tasks', count(*) from public.event_tasks
union all select 'event_expenses', count(*) from public.event_expenses
union all select 'event_vendors', count(*) from public.event_vendors
union all select 'ai_plans', count(*) from public.ai_plans
union all select 'profiles', count(*) from public.profiles
order by table_name;

select
  e.id as event_id,
  e.name as event_name,
  c.full_name as demo_customer,
  e.owner_id,
  e.guest_lead_id,
  (select count(*) from public.event_tasks t where t.event_id = e.id and t.guest_lead_id = e.guest_lead_id) as task_count,
  (select count(*) from public.event_expenses x where x.event_id = e.id and x.guest_lead_id = e.guest_lead_id) as expense_count,
  (select count(*) from public.event_vendors v where v.event_id = e.id and v.guest_lead_id = e.guest_lead_id) as vendor_count,
  (select count(*) from public.ai_plans p where p.event_id = e.id and p.guest_lead_id = e.guest_lead_id and p.provider = 'demo') as demo_ai_plan_count
from public.events e
join public.customer_leads c on c.id = e.guest_lead_id
where e.id in (
  'da000001-0000-4000-8000-000000000001',
  'da000002-0000-4000-8000-000000000002',
  'da000003-0000-4000-8000-000000000003',
  'da000004-0000-4000-8000-000000000004'
)
order by e.event_date;

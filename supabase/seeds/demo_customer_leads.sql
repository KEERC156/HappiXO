-- Demo-only customer records for HappiXO testing. These are not real customers.
-- The deterministic hashes make this seed safe to rerun without updating existing rows.
-- UUID and timestamp columns use their database defaults.
begin;

insert into public.customer_leads (
  full_name,
  email,
  mobile_number,
  guest_session_hash
)
select seed.full_name, seed.email, seed.mobile_number, seed.guest_session_hash
from (
  values
  ('Rahul Sharma', 'rahul.demo@example.com', '9876500001', 'c321b55c2d1409c8ad192286e4c27e6077e60df2d98e08fa489a5664ecac57fe'),
  ('Priya Patel', 'priya.demo@example.com', '9876500002', '96f91ba912db13ae615c78c9ebe94ccb5fea38adfc3a20c14d4f6181f9de7a28'),
  ('Arjun Kumar', 'arjun.demo@example.com', '9876500003', 'efe2e95f0ca881db9eb0e941f887d0c9d71f68049d42f0c84f7e11fab78589ac'),
  ('Sneha Rao', 'sneha.demo@example.com', '9876500004', '2ddbde7f09157bed47cf51c1e48d182ead095e6d682548b60d33dd43a338bfd7')
 ) as seed(full_name, email, mobile_number, guest_session_hash)
where not exists (
  select 1
  from public.customer_leads existing
  where existing.email = seed.email
     or existing.guest_session_hash = seed.guest_session_hash
)
on conflict (guest_session_hash) do nothing;

commit;

select full_name, email, mobile_number, created_at
from public.customer_leads
where guest_session_hash in (
  'c321b55c2d1409c8ad192286e4c27e6077e60df2d98e08fa489a5664ecac57fe',
  '96f91ba912db13ae615c78c9ebe94ccb5fea38adfc3a20c14d4f6181f9de7a28',
  'efe2e95f0ca881db9eb0e941f887d0c9d71f68049d42f0c84f7e11fab78589ac',
  '2ddbde7f09157bed47cf51c1e48d182ead095e6d682548b60d33dd43a338bfd7'
)
order by email;

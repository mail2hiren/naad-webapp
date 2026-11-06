-- 0001 — Add ward_billing_ledger to the Realtime publication.
--
-- Gap: src/context/ClinicContext.tsx subscribes to postgres_changes on
-- public.ward_billing_ledger (channel 'rt-ward_billing_ledger'), but the table
-- is the only one the app subscribes to that is missing from
-- supabase_realtime. Ward charges added on one device never appear on another
-- until a page reload.
-- Risk: low. RLS still filters what each subscriber receives.

alter publication supabase_realtime add table public.ward_billing_ledger;

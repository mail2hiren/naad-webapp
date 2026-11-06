-- 0002 — Make ward billing append-only (drop the leftover FOR ALL policy).
--
-- Gap: ward_billing_ledger has four policies. The old "ward_billing_ledger_all"
-- (FOR ALL) is redundant with the explicit read/insert/update policies, and it
-- is the only thing that lets surgeon/physio/admin DELETE billing rows. The app
-- never deletes ledger rows (InpatientWardView only inserts), and a hospital
-- ledger should not be silently deletable from the browser.
-- Effect: read / insert / update unchanged; DELETE no longer allowed to anyone
-- but the service role.

drop policy if exists ward_billing_ledger_all on public.ward_billing_ledger;

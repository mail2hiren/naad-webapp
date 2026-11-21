create policy ai_usage_read_admin on public.ai_usage_log as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() = 'admin'::text)));
create policy appointments_read on public.appointments as permissive for select to public
  using ((((current_staff_role() IS NOT NULL) AND (org_id = current_org_id())) OR ((current_patient_id() IS NOT NULL) AND (patient_id = current_patient_id()))));
create policy appointments_update on public.appointments as permissive for update to public
  using (((org_id = current_org_id()) AND ((current_staff_role() = ANY (ARRAY['receptionist'::text, 'admin'::text])) OR ((current_patient_id() IS NOT NULL) AND (patient_id = current_patient_id())))))
  with check ((org_id = current_org_id()));
create policy appointments_write on public.appointments as permissive for insert to public
  with check (((org_id = current_org_id()) AND ((current_staff_role() = ANY (ARRAY['receptionist'::text, 'admin'::text])) OR ((current_patient_id() IS NOT NULL) AND (patient_id = current_patient_id())))));
create policy audit_insert on public.audit_events as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy audit_read on public.audit_events as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy documents_insert_staff on public.documents as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy documents_read_patient on public.documents as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy documents_read_staff on public.documents as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy encounters_read_patient on public.encounters as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy encounters_read_staff on public.encounters as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy encounters_update on public.encounters as permissive for update to public
  using (((org_id = current_org_id()) AND (current_staff_role() = 'surgeon'::text)))
  with check ((org_id = current_org_id()));
create policy encounters_write on public.encounters as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = 'surgeon'::text)));
create policy exlib_read on public.exercise_library as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy exlib_write on public.exercise_library as permissive for all to public
  using (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['physio'::text, 'admin'::text]))))
  with check (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['physio'::text, 'admin'::text]))));
create policy inventory_read on public.inventory as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy inventory_write on public.inventory as permissive for all to public
  using (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['pharmacist'::text, 'admin'::text]))))
  with check (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['pharmacist'::text, 'admin'::text]))));
create policy lab_orders_insert on public.lab_orders as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = 'surgeon'::text)));
create policy lab_orders_read_patient on public.lab_orders as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy lab_orders_read_staff on public.lab_orders as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy lab_orders_update on public.lab_orders as permissive for update to public
  using (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['surgeon'::text, 'receptionist'::text, 'admin'::text]))))
  with check ((org_id = current_org_id()));
create policy notifications_insert on public.notifications as permissive for insert to public
  with check (((org_id = current_org_id()) AND ((current_staff_role() IS NOT NULL) OR ((current_patient_id() IS NOT NULL) AND (practitioner_id IS NOT NULL)))));
create policy notifications_read_own_practitioner on public.notifications as permissive for select to public
  using ((practitioner_id = current_practitioner_id()));
create policy notifications_read_patient on public.notifications as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy notifications_read_staff on public.notifications as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy notifications_update_patient on public.notifications as permissive for update to public
  using ((patient_id = current_patient_id()))
  with check ((patient_id = current_patient_id()));
create policy notifications_update_practitioner on public.notifications as permissive for update to public
  using ((practitioner_id = current_practitioner_id()))
  with check ((practitioner_id = current_practitioner_id()));
create policy org_read on public.organizations as permissive for select to public
  using ((id = current_org_id()));
create policy patients_read on public.patients as permissive for select to public
  using ((org_id = current_org_id()));
create policy patients_update_staff on public.patients as permissive for update to public
  using (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['receptionist'::text, 'surgeon'::text, 'admin'::text]))))
  with check ((org_id = current_org_id()));
create policy patients_write_staff on public.patients as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['receptionist'::text, 'admin'::text]))));
create policy pharmacy_orders_insert on public.pharmacy_orders as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = 'surgeon'::text)));
create policy pharmacy_orders_read_patient on public.pharmacy_orders as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy pharmacy_orders_read_staff on public.pharmacy_orders as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy pharmacy_orders_update on public.pharmacy_orders as permissive for update to public
  using (((org_id = current_org_id()) AND (current_staff_role() = 'pharmacist'::text)))
  with check ((org_id = current_org_id()));
create policy plans_read_patient on public.physiotherapy_plans as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy plans_read_staff on public.physiotherapy_plans as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy plans_update on public.physiotherapy_plans as permissive for update to public
  using (((org_id = current_org_id()) AND (current_staff_role() = 'physio'::text)))
  with check ((org_id = current_org_id()));
create policy plans_write on public.physiotherapy_plans as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = 'physio'::text)));
create policy practitioners_insert_admin on public.practitioners as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = 'admin'::text)));
create policy practitioners_read on public.practitioners as permissive for select to public
  using ((org_id = current_org_id()));
create policy practitioners_update_admin on public.practitioners as permissive for update to public
  using (((org_id = current_org_id()) AND (current_staff_role() = 'admin'::text)))
  with check ((org_id = current_org_id()));
create policy prescriptions_read_patient on public.prescriptions as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy prescriptions_read_staff on public.prescriptions as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy prescriptions_write on public.prescriptions as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = 'surgeon'::text)));
create policy referrals_insert on public.referrals as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = 'surgeon'::text)));
create policy referrals_read_patient on public.referrals as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy referrals_read_staff on public.referrals as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy referrals_update on public.referrals as permissive for update to public
  using (((org_id = current_org_id()) AND (current_staff_role() = 'physio'::text)))
  with check ((org_id = current_org_id()));
create policy sessions_read_patient on public.therapy_sessions as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy sessions_read_staff on public.therapy_sessions as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy sessions_write on public.therapy_sessions as permissive for insert to public
  with check (((org_id = current_org_id()) AND (current_staff_role() = 'physio'::text)));
create policy transcripts_read_patient on public.transcripts as permissive for select to public
  using ((patient_id = current_patient_id()));
create policy transcripts_read_staff on public.transcripts as permissive for select to public
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy ward_billing_insert_clinical on public.ward_billing_ledger as permissive for insert to authenticated
  with check (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['surgeon'::text, 'physio'::text, 'admin'::text]))));
create policy ward_billing_ledger_all on public.ward_billing_ledger as permissive for all to authenticated
  using (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['surgeon'::text, 'physio'::text, 'admin'::text]))))
  with check (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['surgeon'::text, 'physio'::text, 'admin'::text]))));
create policy ward_billing_read_staff on public.ward_billing_ledger as permissive for select to authenticated
  using (((org_id = current_org_id()) AND (current_staff_role() IS NOT NULL)));
create policy ward_billing_update_clinical on public.ward_billing_ledger as permissive for update to authenticated
  using (((org_id = current_org_id()) AND (current_staff_role() = ANY (ARRAY['surgeon'::text, 'physio'::text, 'admin'::text]))))
  with check ((org_id = current_org_id()));

alter publication supabase_realtime add table public.ai_usage_log, public.appointments, public.audit_events, public.documents, public.encounters, public.exercise_library, public.inventory, public.lab_orders, public.notifications, public.patients, public.pharmacy_orders, public.physiotherapy_plans, public.practitioners, public.prescriptions, public.referrals, public.therapy_sessions, public.transcripts;

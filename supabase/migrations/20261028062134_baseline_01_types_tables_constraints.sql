create type public.staff_role as enum ('receptionist', 'surgeon', 'pharmacist', 'physio', 'admin');

create table public.ai_usage_log (
  id bigint generated always as identity not null,
  org_id text not null,
  ts timestamp with time zone default now() not null,
  vendor text not null,
  units numeric not null,
  estimated_cost_usd numeric not null,
  note text
);

create table public.appointments (
  id text not null,
  org_id text not null,
  patient_id text not null,
  specialty text,
  date timestamp with time zone,
  reason text,
  practitioner_id text,
  status text default 'scheduled'::text not null,
  start_time timestamp with time zone,
  duration_minutes integer default 20 not null,
  requested_by_patient boolean default false not null
);

create table public.audit_events (
  id text not null,
  org_id text not null,
  ts timestamp with time zone default now() not null,
  actor text,
  role text,
  action text,
  detail text,
  prev_hash text,
  hash text
);

create table public.documents (
  id text not null,
  org_id text not null,
  patient_id text not null,
  label text not null,
  file_name text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by text,
  uploaded_at timestamp with time zone default now() not null
);

create table public.encounters (
  id text not null,
  org_id text not null,
  patient_id text not null,
  practitioner_id text not null,
  specialty text,
  status text default 'in_progress'::text not null,
  started_at timestamp with time zone default now() not null,
  pre_consult_summary jsonb,
  clinical_note jsonb,
  setting text default 'clinic'::text not null,
  ward text,
  bed text,
  recording_consent text default 'not_asked'::text not null,
  capture_mode text default 'conversation'::text not null,
  consultation_fee numeric,
  billing_notes text,
  payment_status text default 'unpaid'::text not null
);

create table public.exercise_library (
  id bigint generated always as identity not null,
  org_id text not null,
  name text not null,
  region text,
  sets integer,
  reps text
);

create table public.inventory (
  id bigint generated always as identity not null,
  org_id text not null,
  drug text not null,
  stock integer default 0 not null,
  unit text,
  low integer default 0 not null,
  alternates text[] default '{}'::text[] not null
);

create table public.lab_orders (
  id text not null,
  org_id text not null,
  patient_id text not null,
  encounter_id text,
  ordered_by text not null,
  test_name text not null,
  test_type text default 'other'::text not null,
  urgency text default 'routine'::text not null,
  status text default 'ordered'::text not null,
  notes text,
  result_document_id text,
  result_summary text,
  flagged boolean default false not null,
  ordered_at timestamp with time zone default now() not null,
  reviewed_by text,
  reviewed_at timestamp with time zone
);

create table public.notifications (
  id text not null,
  org_id text not null,
  patient_id text,
  type text,
  message text,
  created_at timestamp with time zone default now() not null,
  read boolean default false not null,
  practitioner_id text,
  channel text default 'inapp'::text not null
);

create table public.organizations (
  id text not null,
  name text not null,
  city text,
  ai_monthly_budget_usd numeric default 45 not null,
  plan text default 'trial'::text not null,
  subscription_status text default 'trialing'::text not null,
  seat_limit integer default 10 not null,
  billing_email text,
  trial_ends_at timestamp with time zone default (now() + '30 days'::interval),
  current_period_end timestamp with time zone
);

create table public.patients (
  id text not null,
  org_id text not null,
  auth_user_id uuid,
  mrn text,
  name text not null,
  age integer,
  gender text,
  phone text,
  conditions text[] default '{}'::text[] not null,
  allergies text[] default '{}'::text[] not null,
  medications text[] default '{}'::text[] not null,
  queue_status text default 'new'::text not null,
  draft_summary jsonb,
  assigned_practitioner_id text,
  preferred_language text default 'en'::text not null,
  phone_verified boolean default false not null,
  journey_stage text,
  journey_stage_history jsonb default '[]'::jsonb not null,
  discharged_at timestamp with time zone,
  discharge_summary text,
  urgency_level text default 'routine'::text not null,
  intake_state jsonb default '{}'::jsonb not null,
  triage jsonb default '{}'::jsonb not null,
  is_demo boolean default false not null
);

create table public.pharmacy_orders (
  id text not null,
  org_id text not null,
  prescription_id text not null,
  patient_id text not null,
  status text default 'received'::text not null,
  items jsonb default '[]'::jsonb not null,
  exception_note text default ''::text,
  updated_at timestamp with time zone default now() not null,
  prep_started_at timestamp with time zone,
  ready_at timestamp with time zone
);

create table public.physiotherapy_plans (
  id text not null,
  org_id text not null,
  referral_id text,
  patient_id text not null,
  goals text,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.practitioners (
  id text not null,
  org_id text not null,
  auth_user_id uuid,
  name text not null,
  role public.staff_role not null,
  title text,
  preferred_language text default 'en'::text not null,
  active boolean default true not null,
  specialty text,
  consult_fee numeric
);

create table public.prescriptions (
  id text not null,
  org_id text not null,
  encounter_id text not null,
  patient_id text not null,
  status text default 'draft'::text not null,
  items jsonb default '[]'::jsonb not null,
  approved_by text,
  approved_at timestamp with time zone
);

create table public.referrals (
  id text not null,
  org_id text not null,
  encounter_id text not null,
  patient_id text not null,
  from_practitioner_id text not null,
  to_specialty text,
  reason text,
  restrictions text,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.therapy_sessions (
  id text not null,
  org_id text not null,
  plan_id text not null,
  patient_id text not null,
  date timestamp with time zone default now() not null,
  pain_score integer,
  rom text,
  strength text,
  mobility text,
  exercises_done jsonb default '[]'::jsonb not null,
  tolerance text,
  progress_note text,
  provenance text default 'clinician_approved'::text,
  created_by text
);

create table public.transcripts (
  id text not null,
  org_id text not null,
  patient_id text not null,
  encounter_id text,
  plan_id text,
  stage text not null,
  diarized_text text not null,
  duration_seconds numeric,
  created_at timestamp with time zone default now() not null,
  source text default 'audio'::text not null
);

create table public.ward_billing_ledger (
  id text not null,
  org_id text not null,
  patient_id text not null,
  encounter_id text,
  description text not null,
  amount numeric not null,
  created_by text,
  created_at timestamp with time zone default now() not null
);

alter table public.ai_usage_log add constraint ai_usage_log_pkey PRIMARY KEY (id);
alter table public.ai_usage_log add constraint ai_usage_log_vendor_check CHECK ((vendor = ANY (ARRAY['deepgram'::text, 'anthropic'::text])));
alter table public.appointments add constraint appointments_pkey PRIMARY KEY (id);
alter table public.appointments add constraint appointments_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'scheduled'::text, 'checked_in'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])));
alter table public.audit_events add constraint audit_events_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_label_check CHECK ((label = ANY (ARRAY['xray'::text, 'prescription'::text, 'report'::text, 'other'::text])));
alter table public.encounters add constraint encounters_pkey PRIMARY KEY (id);
alter table public.encounters add constraint encounters_capture_mode_check CHECK ((capture_mode = ANY (ARRAY['conversation'::text, 'dictation'::text])));
alter table public.encounters add constraint encounters_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'ledger_locked'::text])));
alter table public.encounters add constraint encounters_recording_consent_check CHECK ((recording_consent = ANY (ARRAY['given'::text, 'declined'::text, 'not_asked'::text])));
alter table public.encounters add constraint encounters_setting_check CHECK ((setting = ANY (ARRAY['clinic'::text, 'ward'::text])));
alter table public.encounters add constraint encounters_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text])));
alter table public.exercise_library add constraint exercise_library_org_id_name_key UNIQUE (org_id, name);
alter table public.exercise_library add constraint exercise_library_pkey PRIMARY KEY (id);
alter table public.inventory add constraint inventory_org_id_drug_key UNIQUE (org_id, drug);
alter table public.inventory add constraint inventory_pkey PRIMARY KEY (id);
alter table public.lab_orders add constraint lab_orders_pkey PRIMARY KEY (id);
alter table public.lab_orders add constraint lab_orders_status_check CHECK ((status = ANY (ARRAY['ordered'::text, 'in_progress'::text, 'completed'::text, 'reviewed'::text])));
alter table public.lab_orders add constraint lab_orders_test_type_check CHECK ((test_type = ANY (ARRAY['xray'::text, 'mri'::text, 'ct'::text, 'blood'::text, 'urine'::text, 'other'::text])));
alter table public.lab_orders add constraint lab_orders_urgency_check CHECK ((urgency = ANY (ARRAY['routine'::text, 'urgent'::text])));
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.notifications add constraint notifications_channel_check CHECK ((channel = ANY (ARRAY['inapp'::text, 'push'::text])));
alter table public.notifications add constraint notifications_one_recipient CHECK (((patient_id IS NOT NULL) OR (practitioner_id IS NOT NULL)));
alter table public.organizations add constraint organizations_pkey PRIMARY KEY (id);
alter table public.organizations add constraint organizations_seat_limit_check CHECK ((seat_limit >= 0));
alter table public.organizations add constraint organizations_subscription_status_check CHECK ((subscription_status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text])));
alter table public.patients add constraint patients_auth_user_id_key UNIQUE (auth_user_id);
alter table public.patients add constraint patients_pkey PRIMARY KEY (id);
alter table public.patients add constraint patients_journey_stage_check CHECK (((journey_stage IS NULL) OR (journey_stage = ANY (ARRAY['admitted'::text, 'operation'::text, 'physiotherapy'::text, 'progress_review'::text, 'discharged'::text]))));
alter table public.patients add constraint patients_preferred_language_check CHECK ((preferred_language = ANY (ARRAY['en'::text, 'hi'::text])));
alter table public.patients add constraint patients_queue_status_check CHECK ((queue_status = ANY (ARRAY['new'::text, 'checking_in'::text, 'awaiting_verification'::text, 'waiting_doctor'::text, 'with_doctor'::text, 'under_review'::text, 'at_pharmacy'::text, 'admitted'::text, 'pending_discharge_clearance'::text, 'active_follow_up'::text, 'done'::text])));
alter table public.patients add constraint patients_urgency_level_check CHECK ((urgency_level = ANY (ARRAY['routine'::text, 'urgent'::text, 'critical_bypass'::text])));
alter table public.pharmacy_orders add constraint pharmacy_orders_pkey PRIMARY KEY (id);
alter table public.pharmacy_orders add constraint pharmacy_orders_status_check CHECK ((status = ANY (ARRAY['received'::text, 'preparing'::text, 'packed'::text, 'exception'::text, 'ready'::text, 'collected'::text])));
alter table public.physiotherapy_plans add constraint physiotherapy_plans_pkey PRIMARY KEY (id);
alter table public.physiotherapy_plans add constraint physiotherapy_plans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text])));
alter table public.practitioners add constraint practitioners_auth_user_id_key UNIQUE (auth_user_id);
alter table public.practitioners add constraint practitioners_pkey PRIMARY KEY (id);
alter table public.practitioners add constraint practitioners_preferred_language_check CHECK ((preferred_language = ANY (ARRAY['en'::text, 'hi'::text])));
alter table public.practitioners add constraint practitioners_specialty_check CHECK (((specialty IS NULL) OR (specialty = ANY (ARRAY['Orthopedics'::text, 'Physiotherapy'::text, 'Critical Care'::text]))));
alter table public.prescriptions add constraint prescriptions_pkey PRIMARY KEY (id);
alter table public.prescriptions add constraint prescriptions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent_to_pharmacy'::text])));
alter table public.referrals add constraint referrals_pkey PRIMARY KEY (id);
alter table public.referrals add constraint referrals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text])));
alter table public.therapy_sessions add constraint therapy_sessions_pkey PRIMARY KEY (id);
alter table public.transcripts add constraint transcripts_pkey PRIMARY KEY (id);
alter table public.transcripts add constraint transcripts_source_check CHECK ((source = ANY (ARRAY['audio'::text, 'typed'::text])));
alter table public.transcripts add constraint transcripts_stage_check CHECK ((stage = ANY (ARRAY['reception'::text, 'consult'::text, 'physio'::text])));
alter table public.ward_billing_ledger add constraint ward_billing_ledger_pkey PRIMARY KEY (id);

alter table public.ai_usage_log add constraint ai_usage_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.appointments add constraint appointments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.appointments add constraint appointments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.appointments add constraint appointments_practitioner_id_fkey FOREIGN KEY (practitioner_id) REFERENCES public.practitioners(id);
alter table public.audit_events add constraint audit_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.documents add constraint documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.documents add constraint documents_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.encounters add constraint encounters_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.encounters add constraint encounters_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.encounters add constraint encounters_practitioner_id_fkey FOREIGN KEY (practitioner_id) REFERENCES public.practitioners(id);
alter table public.exercise_library add constraint exercise_library_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.inventory add constraint inventory_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.lab_orders add constraint lab_orders_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id);
alter table public.lab_orders add constraint lab_orders_ordered_by_fkey FOREIGN KEY (ordered_by) REFERENCES public.practitioners(id);
alter table public.lab_orders add constraint lab_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.lab_orders add constraint lab_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.lab_orders add constraint lab_orders_result_document_id_fkey FOREIGN KEY (result_document_id) REFERENCES public.documents(id);
alter table public.lab_orders add constraint lab_orders_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.practitioners(id);
alter table public.notifications add constraint notifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.notifications add constraint notifications_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.notifications add constraint notifications_practitioner_id_fkey FOREIGN KEY (practitioner_id) REFERENCES public.practitioners(id);
alter table public.patients add constraint patients_assigned_practitioner_id_fkey FOREIGN KEY (assigned_practitioner_id) REFERENCES public.practitioners(id);
alter table public.patients add constraint patients_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
alter table public.patients add constraint patients_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.pharmacy_orders add constraint pharmacy_orders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.pharmacy_orders add constraint pharmacy_orders_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.pharmacy_orders add constraint pharmacy_orders_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES public.prescriptions(id);
alter table public.physiotherapy_plans add constraint physiotherapy_plans_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.physiotherapy_plans add constraint physiotherapy_plans_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.physiotherapy_plans add constraint physiotherapy_plans_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES public.referrals(id);
alter table public.practitioners add constraint practitioners_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
alter table public.practitioners add constraint practitioners_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.prescriptions add constraint prescriptions_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id);
alter table public.prescriptions add constraint prescriptions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.prescriptions add constraint prescriptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.referrals add constraint referrals_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id);
alter table public.referrals add constraint referrals_from_practitioner_id_fkey FOREIGN KEY (from_practitioner_id) REFERENCES public.practitioners(id);
alter table public.referrals add constraint referrals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.referrals add constraint referrals_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.therapy_sessions add constraint therapy_sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.therapy_sessions add constraint therapy_sessions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.therapy_sessions add constraint therapy_sessions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.physiotherapy_plans(id);
alter table public.transcripts add constraint transcripts_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id);
alter table public.transcripts add constraint transcripts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.transcripts add constraint transcripts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);
alter table public.transcripts add constraint transcripts_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.physiotherapy_plans(id);
alter table public.ward_billing_ledger add constraint ward_billing_ledger_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id);
alter table public.ward_billing_ledger add constraint ward_billing_ledger_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
alter table public.ward_billing_ledger add constraint ward_billing_ledger_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);

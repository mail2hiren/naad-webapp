-- 0010 — Demo physiotherapy data for org1 "Naad Demo Hospital" (fictional).
--
-- Why: the live database has 0 therapy plans, 0 sessions and 0 exercises, so
-- the physio screens (v0.4.0) are empty on the live site. This loads the same
-- demo set the demo build uses: 30 library exercises, 5 therapy plans
-- (4 active, 1 completed) for existing demo patients, and 15 session records
-- whose pain falls session by session.
--
-- Data only, no schema change. Only org1 is touched; all patients and the
-- physio (pr-physio, Dr. Jayani Bhatt) already exist. Dates are written
-- relative to 2026-08-29 and shifted to the day this runs, so the demo looks
-- current. Safe to re-run: existing exercises (by name) and plans/sessions
-- (by id) are skipped.
--
-- Generated from src/mock/physioSeed.ts.
--
-- Rollback:
--   delete from public.therapy_sessions where org_id = 'org1' and id in ('ts-r1', 'ts-r2', 'ts-r3', 'ts-k1', 'ts-k2', 'ts-k3', 'ts-k4', 'ts-k5', 'ts-ra1', 'ts-ra2', 'ts-p1', 'ts-d1', 'ts-d2', 'ts-d3', 'ts-d4');
--   delete from public.physiotherapy_plans where org_id = 'org1' and id in ('plan-rohan', 'plan-kavita', 'plan-ramesh', 'plan-priya', 'plan-deepak');
--   delete from public.exercise_library where org_id = 'org1' and name in ('Quadriceps sets', 'Straight leg raise', 'Heel slides', 'Mini squats', 'Step-ups', 'Terminal knee extension with band', 'Stationary cycling', 'Hamstring curls (standing)', 'Glute bridge', 'Clamshells', 'Hip abduction (side-lying)', 'Sit to stand', 'Heel raises', 'Ankle pumps', 'Single-leg balance', 'Ankle alphabet', 'Pelvic tilts', 'Cat-camel', 'Bird dog', 'Prone press-up', 'Dead bug', 'Knee-to-chest stretch', 'Pendulum swings', 'Wall slides', 'External rotation with band', 'Scapular squeezes', 'Chin tucks', 'Neck side-bend stretch', 'Walking programme', 'Diaphragmatic breathing');

insert into public.exercise_library (org_id, name, region, sets, reps, instructions)
select v.* from (values
  ('org1', 'Quadriceps sets', 'Knee', 3::int, '10 x 5 s hold', 'Lie flat, tighten the thigh to press the back of the knee down. Hold 5 seconds.'),
  ('org1', 'Straight leg raise', 'Knee', 3::int, '10', 'Tighten the thigh, keep the knee straight and lift the leg to the height of the other knee.'),
  ('org1', 'Heel slides', 'Knee', 3::int, '15', 'Lying on your back, slide the heel towards you to bend the knee, then straighten.'),
  ('org1', 'Mini squats', 'Knee', 3::int, '12', 'Feet hip-width apart, hold a support, bend knees to 30-45 degrees and stand up.'),
  ('org1', 'Step-ups', 'Knee', 3::int, '10 each leg', 'Step up onto a low step leading with the affected leg, step down slowly.'),
  ('org1', 'Terminal knee extension with band', 'Knee', 3::int, '15', 'Band behind the knee, straighten the knee fully against the band.'),
  ('org1', 'Stationary cycling', 'Knee', 1::int, '10 min', 'Low resistance, smooth full circles.'),
  ('org1', 'Hamstring curls (standing)', 'Knee', 3::int, '12', 'Hold a support, bend the knee to bring the heel towards the buttock.'),
  ('org1', 'Glute bridge', 'Hip', 3::int, '12', 'Lie on your back, knees bent, lift the hips until the body is in a straight line.'),
  ('org1', 'Clamshells', 'Hip', 3::int, '15 each side', 'Side-lying with knees bent, lift the top knee keeping feet together.'),
  ('org1', 'Hip abduction (side-lying)', 'Hip', 3::int, '12 each side', 'Lift the top leg straight up to 30 degrees and lower slowly.'),
  ('org1', 'Sit to stand', 'Hip', 3::int, '10', 'Stand up from a chair without using your hands, sit down slowly.'),
  ('org1', 'Heel raises', 'Ankle', 3::int, '15', 'Rise onto the toes, hold 2 seconds, lower slowly.'),
  ('org1', 'Ankle pumps', 'Ankle', 2::int, '20', 'Point the foot up and down briskly. Good after surgery to keep circulation going.'),
  ('org1', 'Single-leg balance', 'Ankle', 3::int, '30 s each leg', 'Stand on one leg near a support. Progress to eyes closed.'),
  ('org1', 'Ankle alphabet', 'Ankle', 2::int, 'A to Z', 'Trace the alphabet in the air with your big toe.'),
  ('org1', 'Pelvic tilts', 'Back', 3::int, '10', 'Lie on your back, knees bent, flatten the low back against the floor.'),
  ('org1', 'Cat-camel', 'Back', 2::int, '10', 'On hands and knees, slowly arch and round the back.'),
  ('org1', 'Bird dog', 'Back', 3::int, '8 each side', 'On hands and knees, extend the opposite arm and leg, keep the back level.'),
  ('org1', 'Prone press-up', 'Back', 3::int, '10', 'Lying face down, press up with the arms keeping the hips on the floor.'),
  ('org1', 'Dead bug', 'Back', 3::int, '8 each side', 'On your back, arms up, lower the opposite arm and leg while keeping the back flat.'),
  ('org1', 'Knee-to-chest stretch', 'Back', 2::int, '3 x 30 s', 'Pull one knee to the chest and hold.'),
  ('org1', 'Pendulum swings', 'Shoulder', 2::int, '1 min each way', 'Lean on a table, let the arm hang and swing gently in small circles.'),
  ('org1', 'Wall slides', 'Shoulder', 3::int, '10', 'Forearms on the wall, slide up as far as comfortable and down.'),
  ('org1', 'External rotation with band', 'Shoulder', 3::int, '12', 'Elbow at the side bent to 90 degrees, rotate the forearm outwards against the band.'),
  ('org1', 'Scapular squeezes', 'Shoulder', 3::int, '10 x 5 s hold', 'Squeeze the shoulder blades together and down.'),
  ('org1', 'Chin tucks', 'Neck', 3::int, '10 x 5 s hold', 'Draw the chin straight back, making a double chin.'),
  ('org1', 'Neck side-bend stretch', 'Neck', 2::int, '3 x 20 s each side', 'Tilt the ear towards the shoulder until a gentle stretch.'),
  ('org1', 'Walking programme', 'General', 1::int, '20 min', 'Walk at a comfortable pace on level ground; increase by 5 minutes a week.'),
  ('org1', 'Diaphragmatic breathing', 'General', 2::int, '10 breaths', 'Hand on the belly, breathe in through the nose so the belly rises.')
) as v (org_id, name, region, sets, reps, instructions)
where not exists (select 1 from public.exercise_library x where x.org_id = v.org_id and x.name = v.name);

insert into public.physiotherapy_plans (id, org_id, referral_id, patient_id, practitioner_id, condition, goals, status, start_date, planned_sessions, sessions_per_week, review_date, home_programme, created_at) values
  ('plan-rohan', 'org1', null, 'p-rohan', 'pr-physio', 'Post-ACL reconstruction, right knee (week 6)', 'Full knee extension; flexion to 120 degrees; climb stairs without pain; return to jogging by week 16.', 'active', date '2026-08-10' + (current_date - date '2026-08-29'), 12, 2, date '2026-09-10' + (current_date - date '2026-08-29'),
   jsonb_build_array(
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Quadriceps sets' order by id limit 1), 'name', 'Quadriceps sets', 'sets', 3, 'reps', '10 x 5 s hold', 'timesPerWeek', 7, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Straight leg raise' order by id limit 1), 'name', 'Straight leg raise', 'sets', 3, 'reps', '10', 'timesPerWeek', 7, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Heel slides' order by id limit 1), 'name', 'Heel slides', 'sets', 3, 'reps', '15', 'timesPerWeek', 7, 'notes', 'Stop at a comfortable stretch'),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Mini squats' order by id limit 1), 'name', 'Mini squats', 'sets', 3, 'reps', '12', 'timesPerWeek', 5, 'notes', '')),
   timestamptz '2026-08-10T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('plan-kavita', 'org1', null, 'p-kavita', 'pr-physio', 'Mechanical low back pain', 'Sit through a full work day without pain; lift a 10 kg bag safely; pain under 2/10.', 'active', date '2026-08-04' + (current_date - date '2026-08-29'), 8, 2, date '2026-09-02' + (current_date - date '2026-08-29'),
   jsonb_build_array(
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Pelvic tilts' order by id limit 1), 'name', 'Pelvic tilts', 'sets', 3, 'reps', '10', 'timesPerWeek', 7, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Bird dog' order by id limit 1), 'name', 'Bird dog', 'sets', 3, 'reps', '8 each side', 'timesPerWeek', 5, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Prone press-up' order by id limit 1), 'name', 'Prone press-up', 'sets', 3, 'reps', '10', 'timesPerWeek', 7, 'notes', 'Every 2 hours at work'),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Walking programme' order by id limit 1), 'name', 'Walking programme', 'sets', 1, 'reps', '20 min', 'timesPerWeek', 5, 'notes', '')),
   timestamptz '2026-08-04T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('plan-ramesh', 'org1', null, 'p-ramesh', 'pr-physio', 'After right total hip replacement (inpatient rehab)', 'Walk 50 m with a walker; climb 5 steps with a rail; independent transfers before discharge.', 'active', date '2026-08-25' + (current_date - date '2026-08-29'), 10, 5, date '2026-09-01' + (current_date - date '2026-08-29'),
   jsonb_build_array(
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Ankle pumps' order by id limit 1), 'name', 'Ankle pumps', 'sets', 2, 'reps', '20', 'timesPerWeek', 7, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Glute bridge' order by id limit 1), 'name', 'Glute bridge', 'sets', 3, 'reps', '10', 'timesPerWeek', 7, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Sit to stand' order by id limit 1), 'name', 'Sit to stand', 'sets', 3, 'reps', '8', 'timesPerWeek', 7, 'notes', 'Use a firm chair with arms')),
   timestamptz '2026-08-25T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('plan-priya', 'org1', null, 'p-priya', 'pr-physio', 'Patellofemoral pain, left knee', 'Squat and kneel without pain; return to badminton.', 'active', date '2026-08-26' + (current_date - date '2026-08-29'), 6, 1, date '2026-09-23' + (current_date - date '2026-08-29'),
   jsonb_build_array(
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Terminal knee extension with band' order by id limit 1), 'name', 'Terminal knee extension with band', 'sets', 3, 'reps', '15', 'timesPerWeek', 5, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Clamshells' order by id limit 1), 'name', 'Clamshells', 'sets', 3, 'reps', '15 each side', 'timesPerWeek', 5, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Glute bridge' order by id limit 1), 'name', 'Glute bridge', 'sets', 3, 'reps', '12', 'timesPerWeek', 5, 'notes', '')),
   timestamptz '2026-08-26T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day'),
  ('plan-deepak', 'org1', null, 'p-deepak', 'pr-physio', 'After right total knee replacement', 'Flexion 110 degrees; walk without aid; stairs reciprocally.', 'completed', date '2026-06-22' + (current_date - date '2026-08-29'), 10, 2, null,
   jsonb_build_array(
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Step-ups' order by id limit 1), 'name', 'Step-ups', 'sets', 3, 'reps', '10 each leg', 'timesPerWeek', 3, 'notes', ''),
     jsonb_build_object('exerciseId', (select id::text from public.exercise_library where org_id = 'org1' and name = 'Walking programme' order by id limit 1), 'name', 'Walking programme', 'sets', 1, 'reps', '30 min', 'timesPerWeek', 5, 'notes', '')),
   timestamptz '2026-06-22T04:30:00Z' + (current_date - date '2026-08-29') * interval '1 day')
on conflict (id) do nothing;

insert into public.therapy_sessions (id, org_id, plan_id, patient_id, date, pain_score, rom, strength, mobility, exercises_done, tolerance, progress_note, provenance, created_by) values
  ('ts-r1', 'org1', 'plan-rohan', 'p-rohan', timestamptz '2026-08-13T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 6, 'Knee flexion 0-90 deg', 'Quadriceps 3+/5', 'Walking with a slight limp, no aid', '["Quadriceps sets","Straight leg raise","Heel slides"]'::jsonb, 'Good; mild ache after heel slides', 'First session after discharge from the surgeon. Swelling moderate. Started basic quadriceps activation.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-r2', 'org1', 'plan-rohan', 'p-rohan', timestamptz '2026-08-20T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 5, 'Knee flexion 0-100 deg', 'Quadriceps 4-/5', 'Limp reducing; stairs one at a time', '["Quadriceps sets","Straight leg raise","Heel slides","Mini squats"]'::jsonb, 'Good', 'Swelling down. Added mini squats. Home exercises done most days.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-r3', 'org1', 'plan-rohan', 'p-rohan', timestamptz '2026-08-27T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 4, 'Knee flexion 0-110 deg', 'Quadriceps 4/5', 'Normal walking on level ground', '["Straight leg raise","Heel slides","Mini squats","Step-ups","Stationary cycling"]'::jsonb, 'Mild ache after step-ups, settled in 10 minutes', 'Steady progress. Ready to add balance work next session.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-k1', 'org1', 'plan-kavita', 'p-kavita', timestamptz '2026-08-06T11:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 7, 'Lumbar flexion limited to knees', 'Core endurance poor (plank 10 s)', 'Guarded movement, difficulty sitting > 20 min', '["Pelvic tilts","Knee-to-chest stretch"]'::jsonb, 'Pain eased after session', 'Mechanical pattern, no red flags. Education on posture and pacing.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-k2', 'org1', 'plan-kavita', 'p-kavita', timestamptz '2026-08-11T11:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 6, 'Flexion to mid-shin', 'Plank 15 s', 'Sitting 30 min', '["Pelvic tilts","Cat-camel","Knee-to-chest stretch"]'::jsonb, 'Good', 'Less morning stiffness. Started cat-camel.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-k3', 'org1', 'plan-kavita', 'p-kavita', timestamptz '2026-08-18T11:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 5, 'Flexion to ankles', 'Plank 25 s', 'Sitting 45 min', '["Pelvic tilts","Cat-camel","Bird dog"]'::jsonb, 'Good', 'Added bird dog. Walking 15 minutes daily.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-k4', 'org1', 'plan-kavita', 'p-kavita', timestamptz '2026-08-22T11:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 4, 'Full flexion, end-range tightness', 'Plank 35 s', 'Sitting 1 hour with breaks', '["Cat-camel","Bird dog","Prone press-up","Dead bug"]'::jsonb, 'Good', 'Progressing well. Introduced prone press-ups for end-range.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-k5', 'org1', 'plan-kavita', 'p-kavita', timestamptz '2026-08-27T11:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 3, 'Full flexion', 'Plank 45 s', 'Full work day with breaks', '["Bird dog","Prone press-up","Dead bug","Walking programme"]'::jsonb, 'Good', 'Pain now only after long sitting. Plan lifting practice next session.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-ra1', 'org1', 'plan-ramesh', 'p-ramesh', timestamptz '2026-08-26T06:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 5, 'Hip flexion 0-70 deg (within precautions)', 'Hip abductors 3/5', 'Walker, 10 m with assistance', '["Ankle pumps","Glute bridge"]'::jsonb, 'Fatigued after 10 m', 'Day 2 after surgery. Hip precautions explained. Bed exercises started.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-ra2', 'org1', 'plan-ramesh', 'p-ramesh', timestamptz '2026-08-28T06:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 4, 'Hip flexion 0-80 deg', 'Hip abductors 3+/5', 'Walker, 30 m with supervision', '["Ankle pumps","Glute bridge","Sit to stand"]'::jsonb, 'Good', 'Transfers now independent. Started sit to stand.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-p1', 'org1', 'plan-priya', 'p-priya', timestamptz '2026-08-26T09:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 5, 'Full range, pain at end of flexion', 'Quadriceps 4/5, hip abductors 4-/5', 'Pain on stairs going down', '["Terminal knee extension with band","Clamshells","Glute bridge"]'::jsonb, 'Good', 'Weak hip abductors contributing. Started strengthening.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-d1', 'org1', 'plan-deepak', 'p-deepak', timestamptz '2026-06-24T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 7, 'Knee flexion 0-70 deg', 'Quadriceps 3/5', 'Walker', '["Ankle pumps","Quadriceps sets","Heel slides"]'::jsonb, 'Fair', 'Early post-op. Swelling significant.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-d2', 'org1', 'plan-deepak', 'p-deepak', timestamptz '2026-07-08T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 5, 'Knee flexion 0-90 deg', 'Quadriceps 3+/5', 'Stick', '["Quadriceps sets","Straight leg raise","Heel slides","Mini squats"]'::jsonb, 'Good', 'Weaned to a stick.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-d3', 'org1', 'plan-deepak', 'p-deepak', timestamptz '2026-07-22T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 3, 'Knee flexion 0-105 deg', 'Quadriceps 4/5', 'No aid indoors', '["Straight leg raise","Mini squats","Step-ups","Stationary cycling"]'::jsonb, 'Good', 'Stairs with a rail.', 'clinician_approved', 'Dr. Jayani Bhatt'),
  ('ts-d4', 'org1', 'plan-deepak', 'p-deepak', timestamptz '2026-08-12T05:00:00Z' + (current_date - date '2026-08-29') * interval '1 day', 1, 'Knee flexion 0-115 deg', 'Quadriceps 4+/5', 'No aid', '["Mini squats","Step-ups","Walking programme"]'::jsonb, 'Good', 'Goals met. Discharged to home programme.', 'clinician_approved', 'Dr. Jayani Bhatt')
on conflict (id) do nothing;

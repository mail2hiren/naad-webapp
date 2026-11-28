import type { ExerciseRow, HomeProgrammeItem, PhysioPlanRow, TherapySessionRow } from '../types/db';
import { ORG_ID } from './seed';

/**
 * Demo physiotherapy data (Phase 3), written as if today were 2026-08-29 like
 * the rest of the seed; mockSupabase shifts every date so the demo is always
 * current. Pain falls and range of motion improves session by session, so the
 * progress charts tell a believable story.
 */

const ex = (id: number, name: string, region: string, sets: number | null, reps: string, instructions: string): ExerciseRow =>
  ({ id, org_id: ORG_ID, name, region, sets, reps, instructions });

export const exercises: ExerciseRow[] = [
  ex(1, 'Quadriceps sets', 'Knee', 3, '10 x 5 s hold', 'Lie flat, tighten the thigh to press the back of the knee down. Hold 5 seconds.'),
  ex(2, 'Straight leg raise', 'Knee', 3, '10', 'Tighten the thigh, keep the knee straight and lift the leg to the height of the other knee.'),
  ex(3, 'Heel slides', 'Knee', 3, '15', 'Lying on your back, slide the heel towards you to bend the knee, then straighten.'),
  ex(4, 'Mini squats', 'Knee', 3, '12', 'Feet hip-width apart, hold a support, bend knees to 30-45 degrees and stand up.'),
  ex(5, 'Step-ups', 'Knee', 3, '10 each leg', 'Step up onto a low step leading with the affected leg, step down slowly.'),
  ex(6, 'Terminal knee extension with band', 'Knee', 3, '15', 'Band behind the knee, straighten the knee fully against the band.'),
  ex(7, 'Stationary cycling', 'Knee', 1, '10 min', 'Low resistance, smooth full circles.'),
  ex(8, 'Hamstring curls (standing)', 'Knee', 3, '12', 'Hold a support, bend the knee to bring the heel towards the buttock.'),
  ex(9, 'Glute bridge', 'Hip', 3, '12', 'Lie on your back, knees bent, lift the hips until the body is in a straight line.'),
  ex(10, 'Clamshells', 'Hip', 3, '15 each side', 'Side-lying with knees bent, lift the top knee keeping feet together.'),
  ex(11, 'Hip abduction (side-lying)', 'Hip', 3, '12 each side', 'Lift the top leg straight up to 30 degrees and lower slowly.'),
  ex(12, 'Sit to stand', 'Hip', 3, '10', 'Stand up from a chair without using your hands, sit down slowly.'),
  ex(13, 'Heel raises', 'Ankle', 3, '15', 'Rise onto the toes, hold 2 seconds, lower slowly.'),
  ex(14, 'Ankle pumps', 'Ankle', 2, '20', 'Point the foot up and down briskly. Good after surgery to keep circulation going.'),
  ex(15, 'Single-leg balance', 'Ankle', 3, '30 s each leg', 'Stand on one leg near a support. Progress to eyes closed.'),
  ex(16, 'Ankle alphabet', 'Ankle', 2, 'A to Z', 'Trace the alphabet in the air with your big toe.'),
  ex(17, 'Pelvic tilts', 'Back', 3, '10', 'Lie on your back, knees bent, flatten the low back against the floor.'),
  ex(18, 'Cat-camel', 'Back', 2, '10', 'On hands and knees, slowly arch and round the back.'),
  ex(19, 'Bird dog', 'Back', 3, '8 each side', 'On hands and knees, extend the opposite arm and leg, keep the back level.'),
  ex(20, 'Prone press-up', 'Back', 3, '10', 'Lying face down, press up with the arms keeping the hips on the floor.'),
  ex(21, 'Dead bug', 'Back', 3, '8 each side', 'On your back, arms up, lower the opposite arm and leg while keeping the back flat.'),
  ex(22, 'Knee-to-chest stretch', 'Back', 2, '3 x 30 s', 'Pull one knee to the chest and hold.'),
  ex(23, 'Pendulum swings', 'Shoulder', 2, '1 min each way', 'Lean on a table, let the arm hang and swing gently in small circles.'),
  ex(24, 'Wall slides', 'Shoulder', 3, '10', 'Forearms on the wall, slide up as far as comfortable and down.'),
  ex(25, 'External rotation with band', 'Shoulder', 3, '12', 'Elbow at the side bent to 90 degrees, rotate the forearm outwards against the band.'),
  ex(26, 'Scapular squeezes', 'Shoulder', 3, '10 x 5 s hold', 'Squeeze the shoulder blades together and down.'),
  ex(27, 'Chin tucks', 'Neck', 3, '10 x 5 s hold', 'Draw the chin straight back, making a double chin.'),
  ex(28, 'Neck side-bend stretch', 'Neck', 2, '3 x 20 s each side', 'Tilt the ear towards the shoulder until a gentle stretch.'),
  ex(29, 'Walking programme', 'General', 1, '20 min', 'Walk at a comfortable pace on level ground; increase by 5 minutes a week.'),
  ex(30, 'Diaphragmatic breathing', 'General', 2, '10 breaths', 'Hand on the belly, breathe in through the nose so the belly rises.'),
];

const hp = (exerciseId: number, sets: number | null, reps: string, timesPerWeek: number, notes = ''): HomeProgrammeItem => {
  const e = exercises.find((x) => x.id === exerciseId)!;
  return { exerciseId: String(exerciseId), name: e.name, sets, reps, timesPerWeek, notes };
};

const plan = (p: Omit<PhysioPlanRow, 'org_id' | 'referral_id' | 'practitioner_id' | 'created_at'> & { referral_id?: string | null }): PhysioPlanRow => ({
  org_id: ORG_ID, practitioner_id: 'pr-physio', referral_id: p.referral_id ?? null, created_at: `${p.start_date}T04:30:00Z`, ...p,
});

export const plans: PhysioPlanRow[] = [
  plan({
    id: 'plan-rohan', patient_id: 'p-rohan', condition: 'Post-ACL reconstruction, right knee (week 6)',
    goals: 'Full knee extension; flexion to 120 degrees; climb stairs without pain; return to jogging by week 16.',
    status: 'active', start_date: '2026-08-10', planned_sessions: 12, sessions_per_week: 2, review_date: '2026-09-10',
    home_programme: [hp(1, 3, '10 x 5 s hold', 7), hp(2, 3, '10', 7), hp(3, 3, '15', 7, 'Stop at a comfortable stretch'), hp(4, 3, '12', 5)],
  }),
  plan({
    id: 'plan-kavita', patient_id: 'p-kavita', condition: 'Mechanical low back pain',
    goals: 'Sit through a full work day without pain; lift a 10 kg bag safely; pain under 2/10.',
    status: 'active', start_date: '2026-08-04', planned_sessions: 8, sessions_per_week: 2, review_date: '2026-09-02',
    home_programme: [hp(17, 3, '10', 7), hp(19, 3, '8 each side', 5), hp(20, 3, '10', 7, 'Every 2 hours at work'), hp(29, 1, '20 min', 5)],
  }),
  plan({
    id: 'plan-ramesh', patient_id: 'p-ramesh', condition: 'After right total hip replacement (inpatient rehab)',
    goals: 'Walk 50 m with a walker; climb 5 steps with a rail; independent transfers before discharge.',
    status: 'active', start_date: '2026-08-25', planned_sessions: 10, sessions_per_week: 5, review_date: '2026-09-01',
    home_programme: [hp(14, 2, '20', 7), hp(9, 3, '10', 7), hp(12, 3, '8', 7, 'Use a firm chair with arms')],
  }),
  plan({
    id: 'plan-priya', patient_id: 'p-priya', condition: 'Patellofemoral pain, left knee',
    goals: 'Squat and kneel without pain; return to badminton.',
    status: 'active', start_date: '2026-08-26', planned_sessions: 6, sessions_per_week: 1, review_date: '2026-09-23',
    home_programme: [hp(6, 3, '15', 5), hp(10, 3, '15 each side', 5), hp(9, 3, '12', 5)],
  }),
  plan({
    id: 'plan-deepak', patient_id: 'p-deepak', condition: 'After right total knee replacement',
    goals: 'Flexion 110 degrees; walk without aid; stairs reciprocally.',
    status: 'completed', start_date: '2026-06-22', planned_sessions: 10, sessions_per_week: 2, review_date: null,
    home_programme: [hp(5, 3, '10 each leg', 3), hp(29, 1, '30 min', 5)],
  }),
];

const s = (
  id: string, planId: string, patientId: string, date: string, pain: number, rom: string, strength: string,
  mobility: string, done: number[], tolerance: string, note: string,
): TherapySessionRow => ({
  id, org_id: ORG_ID, plan_id: planId, patient_id: patientId, date, pain_score: pain, rom, strength, mobility,
  exercises_done: done.map((n) => exercises.find((e) => e.id === n)!.name), tolerance, progress_note: note,
  provenance: 'clinician_approved', created_by: 'Dr. Jayani Bhatt',
});

export const sessions: TherapySessionRow[] = [
  s('ts-r1', 'plan-rohan', 'p-rohan', '2026-08-13T05:00:00Z', 6, 'Knee flexion 0-90 deg', 'Quadriceps 3+/5', 'Walking with a slight limp, no aid', [1, 2, 3], 'Good; mild ache after heel slides', 'First session after discharge from the surgeon. Swelling moderate. Started basic quadriceps activation.'),
  s('ts-r2', 'plan-rohan', 'p-rohan', '2026-08-20T05:00:00Z', 5, 'Knee flexion 0-100 deg', 'Quadriceps 4-/5', 'Limp reducing; stairs one at a time', [1, 2, 3, 4], 'Good', 'Swelling down. Added mini squats. Home exercises done most days.'),
  s('ts-r3', 'plan-rohan', 'p-rohan', '2026-08-27T05:00:00Z', 4, 'Knee flexion 0-110 deg', 'Quadriceps 4/5', 'Normal walking on level ground', [2, 3, 4, 5, 7], 'Mild ache after step-ups, settled in 10 minutes', 'Steady progress. Ready to add balance work next session.'),
  s('ts-k1', 'plan-kavita', 'p-kavita', '2026-08-06T11:00:00Z', 7, 'Lumbar flexion limited to knees', 'Core endurance poor (plank 10 s)', 'Guarded movement, difficulty sitting > 20 min', [17, 22], 'Pain eased after session', 'Mechanical pattern, no red flags. Education on posture and pacing.'),
  s('ts-k2', 'plan-kavita', 'p-kavita', '2026-08-11T11:00:00Z', 6, 'Flexion to mid-shin', 'Plank 15 s', 'Sitting 30 min', [17, 18, 22], 'Good', 'Less morning stiffness. Started cat-camel.'),
  s('ts-k3', 'plan-kavita', 'p-kavita', '2026-08-18T11:00:00Z', 5, 'Flexion to ankles', 'Plank 25 s', 'Sitting 45 min', [17, 18, 19], 'Good', 'Added bird dog. Walking 15 minutes daily.'),
  s('ts-k4', 'plan-kavita', 'p-kavita', '2026-08-22T11:00:00Z', 4, 'Full flexion, end-range tightness', 'Plank 35 s', 'Sitting 1 hour with breaks', [18, 19, 20, 21], 'Good', 'Progressing well. Introduced prone press-ups for end-range.'),
  s('ts-k5', 'plan-kavita', 'p-kavita', '2026-08-27T11:00:00Z', 3, 'Full flexion', 'Plank 45 s', 'Full work day with breaks', [19, 20, 21, 29], 'Good', 'Pain now only after long sitting. Plan lifting practice next session.'),
  s('ts-ra1', 'plan-ramesh', 'p-ramesh', '2026-08-26T06:00:00Z', 5, 'Hip flexion 0-70 deg (within precautions)', 'Hip abductors 3/5', 'Walker, 10 m with assistance', [14, 9], 'Fatigued after 10 m', 'Day 2 after surgery. Hip precautions explained. Bed exercises started.'),
  s('ts-ra2', 'plan-ramesh', 'p-ramesh', '2026-08-28T06:00:00Z', 4, 'Hip flexion 0-80 deg', 'Hip abductors 3+/5', 'Walker, 30 m with supervision', [14, 9, 12], 'Good', 'Transfers now independent. Started sit to stand.'),
  s('ts-p1', 'plan-priya', 'p-priya', '2026-08-26T09:00:00Z', 5, 'Full range, pain at end of flexion', 'Quadriceps 4/5, hip abductors 4-/5', 'Pain on stairs going down', [6, 10, 9], 'Good', 'Weak hip abductors contributing. Started strengthening.'),
  s('ts-d1', 'plan-deepak', 'p-deepak', '2026-06-24T05:00:00Z', 7, 'Knee flexion 0-70 deg', 'Quadriceps 3/5', 'Walker', [14, 1, 3], 'Fair', 'Early post-op. Swelling significant.'),
  s('ts-d2', 'plan-deepak', 'p-deepak', '2026-07-08T05:00:00Z', 5, 'Knee flexion 0-90 deg', 'Quadriceps 3+/5', 'Stick', [1, 2, 3, 4], 'Good', 'Weaned to a stick.'),
  s('ts-d3', 'plan-deepak', 'p-deepak', '2026-07-22T05:00:00Z', 3, 'Knee flexion 0-105 deg', 'Quadriceps 4/5', 'No aid indoors', [2, 4, 5, 7], 'Good', 'Stairs with a rail.'),
  s('ts-d4', 'plan-deepak', 'p-deepak', '2026-08-12T05:00:00Z', 1, 'Knee flexion 0-115 deg', 'Quadriceps 4+/5', 'No aid', [4, 5, 29], 'Good', 'Goals met. Discharged to home programme.'),
];

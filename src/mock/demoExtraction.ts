import type { ExtractResult } from '../hooks/useRealAmbientCapture';

/**
 * Demo mode only: a realistic AI draft for the doctor's or physio's note when
 * a demo "recording" stops, so a demo shows what Naad actually does instead
 * of an empty note. Same shape the real transcribe-and-extract function
 * returns. Never used against the real backend. Like the real AI, it never
 * writes the examination for doctors, and impressions stay tentative.
 */
function result(extracted: Record<string, unknown>, minutes: number): ExtractResult {
  return {
    extracted: { ...extracted, provenance: 'ai_generated' },
    diarizedText: '',
    transcriptId: `demo-${Date.now()}`,
    usage: { deepgramMinutes: minutes, claudeTokens: 0, estimatedCostUsd: 0, spentThisMonth: 0, budget: 0 },
  } as ExtractResult;
}

export function demoExtractionFor(specialty: string | null | undefined, complaint: string, programme: string[] = []): ExtractResult {
  const c = complaint.toLowerCase();

  if (specialty === 'Physiotherapy') {
    const done = programme.length > 0 ? programme.slice(0, 4) : null;
    if (c.includes('back') || c.includes('spine') || c.includes('lumbar')) {
      return result({
        painScore: '2/10 (was 3/10 last session)',
        rom: 'Full lumbar flexion and extension, slight end-range tightness',
        strength: 'Core endurance improving, plank 55 s',
        mobility: 'Sits through the work day with short breaks; lifted a 5 kg bag without pain',
        tolerance: 'Tolerated all exercises well',
        exercisesDone: done ?? ['Bird dog', 'Prone press-up', 'Dead bug'],
        progressNote: 'Pain now only after long sitting. Started lifting practice with a light bag; progress to 10 kg next session if pain stays low.',
      }, 6.1);
    }
    if (c.includes('hip')) {
      return result({
        painScore: '3/10 (was 4/10 last session)',
        rom: 'Hip flexion 0-85 deg, within precautions',
        strength: 'Hip abductors 4-/5',
        mobility: 'Walker, 50 m independently; 5 steps with a rail',
        tolerance: 'Good; tired after the stairs',
        exercisesDone: done ?? ['Glute bridge', 'Sit to stand', 'Ankle pumps'],
        progressNote: 'Walking and stairs goals met with the walker. Practise stairs daily; plan to try a stick next session.',
      }, 5.4);
    }
    return result({
      painScore: '3/10 (was 4/10 last session)',
      rom: 'Knee flexion 0-115 deg, up from 0-110 deg',
      strength: 'Quadriceps 4/5',
      mobility: 'Walking without a limp on level ground; slight hesitation on stairs',
      tolerance: 'Tolerated all exercises; mild ache after step-ups, settled in 10 minutes',
      exercisesDone: done ?? ['Quadriceps sets', 'Straight leg raise', 'Mini squats', 'Step-ups', 'Stationary cycling'],
      progressNote:
        'Steady progress since last session: less pain and better knee bend. Ready to add balance work and progress step-up height next week.',
    }, 6.5);
  }

  if (specialty === 'Critical Care' || c.includes('palpitation') || c.includes('chest') || c.includes('breath')) {
    return result({
      chiefComplaint: 'Palpitations',
      hpi: 'Intermittent fast heartbeat for two weeks, mostly on climbing stairs, each episode lasting a few minutes. Mild breathlessness with episodes. No chest pain, no fainting.',
      painLocation: 'None',
      painSeverity: 'Not applicable',
      painDuration: '2 weeks (episodes of a few minutes)',
      trauma: 'No trauma reported',
      aggravating: 'Exertion, stairs',
      relieving: 'Rest',
      functionalLimitation: 'Avoids climbing more than one floor',
      priorTreatment: 'None',
      assessment: 'Findings are consistent with possible paroxysmal arrhythmia. Not a confirmed diagnosis, clinical correlation required.',
      plan: 'Suggested: ECG today, 24-hour Holter, thyroid profile and electrolytes; review with results.',
    }, 7.2);
  }

  const joint = c.includes('hip') ? 'hip' : c.includes('shoulder') ? 'shoulder' : c.includes('back') ? 'lower back' : 'knee';
  return result({
    chiefComplaint: `${joint[0].toUpperCase()}${joint.slice(1)} pain`,
    hpi: `Pain in the right ${joint} for about three weeks, worse over the last week. Started after a minor fall at home. Partial relief with painkillers.`,
    painLocation: `Right ${joint}`,
    painSeverity: '6/10',
    painDuration: '3 weeks',
    trauma: 'Yes, following a minor fall at home',
    aggravating: joint === 'knee' ? 'Climbing stairs, squatting' : 'Movement, lifting',
    relieving: 'Rest, painkillers',
    functionalLimitation: joint === 'knee' ? 'Difficulty with stairs and sitting cross-legged' : 'Difficulty with daily activities',
    priorTreatment: 'Paracetamol as needed, partial relief',
    assessment: `Findings are consistent with a possible soft-tissue injury of the ${joint}. Not a confirmed diagnosis, clinical correlation required.`,
    plan: `Suggested: X-ray of the ${joint}, physiotherapy referral, review in 2 weeks.`,
  }, 5.8);
}

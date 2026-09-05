import { useCallback, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { IntakeCompleteness } from '../types/db';

export interface IntakeField { key: keyof IntakeCompleteness; label: string; keywords: RegExp }

export const INTAKE_FIELDS: IntakeField[] = [
  { key: 'identity', label: 'Identity', keywords: /\b(name is|my name|i am|i'm)\b/i },
  { key: 'complaint', label: 'Chief Complaint', keywords: /\b(pain|injury|hurt|ache|fever|cough|breath|swelling|dizzy)\b/i },
  { key: 'timeline', label: 'Timeline', keywords: /\b(yesterday|days? ago|weeks? ago|since|hours? ago|last night|today)\b/i },
  { key: 'reports', label: 'Existing Reports', keywords: /\b(x-?ray|mri|blood report|scan|lab result)\b/i },
];

export interface Recommendation { id: string; text: string; sourceKeyword: string }

const KEYWORD_RECOMMENDATIONS: { test: RegExp; chips: string[] }[] = [
  { test: /knee|joint|fall/i, chips: ['Ask about joint locking', 'Ask about popping sounds', 'Ask if swelling appeared within 2 hours'] },
  { test: /chest|cough|breath/i, chips: ['Check history of Asthma', 'Flag as high-urgency triage', 'Ask about oxygen levels at home'] },
  { test: /shoulder|mobility|stiff/i, chips: ['Ask about range of motion loss', 'Ask if pain worsens with activity'] },
];

/**
 * useAmbientIntake -- drives the Reception "AI Guided Intake" component:
 * appends streamed transcript text, lights up the non-medical completeness
 * tracker (Identity / Chief Complaint / Timeline / Existing Reports) as
 * those parameters are detected, and surfaces 2-3 hyper-specific live
 * recommendation chips as new keywords appear in the stream. Every write
 * this hook makes lands on `patients.intake_state` (jsonb) via a debounced
 * Supabase update, so the transcript and completeness lights are the same
 * object every other screen reads.
 */
export function useAmbientIntake(patientId: string | null) {
  const [transcript, setTranscript] = useState('');
  const [completeness, setCompleteness] = useState<IntakeCompleteness>({ identity: false, complaint: false, timeline: false, reports: false });
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const seenKeywordSources = useRef(new Set<string>());
  const answeredChipTexts = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((next: { transcript: string; completeness: IntakeCompleteness }) => {
    if (!patientId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      supabase.from('patients').update({
        intake_state: { rawTranscriptStream: next.transcript, completenessCheck: next.completeness },
      }).eq('id', patientId);
    }, 400);
  }, [patientId]);

  const appendTranscript = useCallback((line: string) => {
    setTranscript((prev) => {
      const next = prev ? `${prev} ${line}` : line;

      const nextCompleteness = { ...completeness };
      INTAKE_FIELDS.forEach((f) => {
        if (!nextCompleteness[f.key] && f.keywords.test(next)) nextCompleteness[f.key] = true;
      });
      setCompleteness(nextCompleteness);

      KEYWORD_RECOMMENDATIONS.forEach((rule) => {
        if (rule.test.test(line) && !seenKeywordSources.current.has(rule.test.source)) {
          seenKeywordSources.current.add(rule.test.source);
          const fresh = rule.chips
            .filter((c) => !answeredChipTexts.current.has(c))
            .map((text) => ({ id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, sourceKeyword: rule.test.source }));
          setRecommendations((prevRecs) => [...prevRecs, ...fresh]);
        }
      });

      persist({ transcript: next, completeness: nextCompleteness });
      return next;
    });
  }, [completeness, persist]);

  const answerRecommendation = useCallback((id: string) => {
    setRecommendations((prev) => {
      const chip = prev.find((r) => r.id === id);
      if (chip) answeredChipTexts.current.add(chip.text);
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const dismissRecommendation = useCallback((id: string) => {
    setRecommendations((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const reset = useCallback(() => {
    setTranscript(''); setCompleteness({ identity: false, complaint: false, timeline: false, reports: false });
    setRecommendations([]); seenKeywordSources.current.clear(); answeredChipTexts.current.clear();
  }, []);

  return {
    transcript, completeness, recommendations, isRecording,
    setIsRecording, appendTranscript, answerRecommendation, dismissRecommendation, reset,
  };
}

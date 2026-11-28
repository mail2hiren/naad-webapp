import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { ExerciseRow, PhysioPlanRow, TherapySessionRow } from '../types/db';

/** Therapy plans, session records and the exercise library for one hospital,
 * kept live with one realtime channel per table. Used by the physio module. */
export function usePhysio(orgId: string) {
  const [plans, setPlans] = useState<PhysioPlanRow[]>([]);
  const [sessions, setSessions] = useState<TherapySessionRow[]>([]);
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!orgId) return;
    const [p, s, e] = await Promise.all([
      supabase.from('physiotherapy_plans').select('*').eq('org_id', orgId),
      supabase.from('therapy_sessions').select('*').eq('org_id', orgId),
      supabase.from('exercise_library').select('*').eq('org_id', orgId).order('name'),
    ]);
    setPlans(((p.data as PhysioPlanRow[]) ?? []).map((r) => ({ ...r, home_programme: r.home_programme ?? [] })));
    setSessions((s.data as TherapySessionRow[]) ?? []);
    setExercises((e.data as ExerciseRow[]) ?? []);
    setLoaded(true);
  }, [orgId]);

  useEffect(() => { queueMicrotask(() => { void reload(); }); }, [reload]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upsert = <T extends { id: string | number }>(set: React.Dispatch<React.SetStateAction<T[]>>) => (payload: any) => {
      set((prev) => {
        if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== payload.old.id);
        return prev.some((r) => r.id === payload.new.id) ? prev.map((r) => (r.id === payload.new.id ? payload.new : r)) : [...prev, payload.new];
      });
    };
    const channels = [
      supabase.channel('rt-physiotherapy_plans').on('postgres_changes', { event: '*', schema: 'public', table: 'physiotherapy_plans' }, upsert(setPlans)).subscribe(),
      supabase.channel('rt-therapy_sessions').on('postgres_changes', { event: '*', schema: 'public', table: 'therapy_sessions' }, upsert(setSessions)).subscribe(),
      supabase.channel('rt-exercise_library').on('postgres_changes', { event: '*', schema: 'public', table: 'exercise_library' }, upsert(setExercises)).subscribe(),
    ];
    return () => { channels.forEach((ch) => supabase.removeChannel(ch)); };
  }, []);

  return { plans, sessions, exercises, loaded, reload };
}

/** Sessions of one plan, oldest first. */
export function sessionsOf(sessions: TherapySessionRow[], planId: string) {
  return sessions.filter((s) => s.plan_id === planId).sort((a, b) => a.date.localeCompare(b.date));
}

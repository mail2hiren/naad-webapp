import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { DocumentRow, LabOrderRow, PhysioPlanRow, TherapySessionRow, VitalsRow } from '../types/db';

export interface PatientExtras {
  documents: DocumentRow[];
  labOrders: LabOrderRow[];
  plans: PhysioPlanRow[];
  sessions: TherapySessionRow[];
  vitals: VitalsRow[];
}

const empty: PatientExtras = { documents: [], labOrders: [], plans: [], sessions: [], vitals: [] };

/** The parts of one patient's record the clinic-wide context does not hold (staff read access). */
export function usePatientRecord(patientId: string | null): { extras: PatientExtras; loading: boolean } {
  const [extras, setExtras] = useState<PatientExtras>(empty);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!patientId) return;
    let live = true;
    queueMicrotask(() => { if (live) setLoading(true); });
    const q = (t: string) => supabase.from(t).select('*').eq('patient_id', patientId);
    void Promise.all([q('documents'), q('lab_orders'), q('physiotherapy_plans'), q('therapy_sessions'), q('vitals')]).then(([d, l, p, s, v]) => {
      if (!live) return;
      setExtras({
        documents: (d.data as DocumentRow[] | null) ?? [],
        labOrders: (l.data as LabOrderRow[] | null) ?? [],
        plans: (p.data as PhysioPlanRow[] | null) ?? [],
        sessions: (s.data as TherapySessionRow[] | null) ?? [],
        vitals: (v.data as VitalsRow[] | null) ?? [],
      });
      setLoading(false);
    });
    return () => { live = false; };
  }, [patientId]);
  return { extras, loading };
}

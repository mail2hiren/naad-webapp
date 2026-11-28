import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type {
  AppointmentRow, BillRow, DocumentRow, EncounterRow, LabOrderRow, PatientRow, PharmacyOrderRow, PhysioPlanRow,
  PractitionerRow, PrescriptionRow, TherapySessionRow, VitalsRow,
} from '../types/db';

export interface PatientData {
  appointments: AppointmentRow[];
  encounters: EncounterRow[];
  prescriptions: PrescriptionRow[];
  pharmacyOrders: PharmacyOrderRow[];
  bills: BillRow[];
  documents: DocumentRow[];
  labOrders: LabOrderRow[];
  plans: PhysioPlanRow[];
  sessions: TherapySessionRow[];
  vitals: VitalsRow[];
  doctors: PractitionerRow[];
  hospital: { name: string; address: string | null; city: string | null; contact_phone: string | null } | null;
}

const empty: PatientData = {
  appointments: [], encounters: [], prescriptions: [], pharmacyOrders: [], bills: [], documents: [], labOrders: [],
  plans: [], sessions: [], vitals: [], doctors: [], hospital: null,
};

const LIVE: (keyof PatientData)[] = ['appointments', 'pharmacyOrders', 'bills', 'prescriptions'];
const TABLE: Record<string, string> = { appointments: 'appointments', pharmacyOrders: 'pharmacy_orders', bills: 'bills', prescriptions: 'prescriptions' };

/** Everything the patient app shows, for the signed-in patient only (the
 * database's row-level security also limits every read to their own rows).
 * Appointments, medicines and bills stay live. */
export function usePatientData(patient: PatientRow | null) {
  const [data, setData] = useState<PatientData>(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!patient) { setData(empty); return; }
    setLoading(true);
    const by = (t: string) => supabase.from(t).select('*').eq('patient_id', patient.id);
    const [ap, en, rx, po, bi, dc, lo, pl, ss, vt, pr, org] = await Promise.all([
      by('appointments'), supabase.from('encounters').select('*').eq('patient_id', patient.id).order('started_at', { ascending: false }),
      by('prescriptions'), by('pharmacy_orders'), by('bills'), by('documents'), by('lab_orders'), by('physiotherapy_plans'),
      supabase.from('therapy_sessions').select('*').eq('patient_id', patient.id).order('date'), by('vitals'),
      supabase.from('practitioners').select('*').eq('org_id', patient.org_id),
      supabase.from('organizations').select('*').eq('id', patient.org_id).maybeSingle(),
    ]);
    if (en.error) setError(en.error.message);
    setData({
      appointments: (ap.data as AppointmentRow[]) ?? [], encounters: (en.data as EncounterRow[]) ?? [],
      prescriptions: (rx.data as PrescriptionRow[]) ?? [], pharmacyOrders: (po.data as PharmacyOrderRow[]) ?? [],
      bills: ((bi.data as BillRow[]) ?? []).map((b) => ({ ...b, total: Number(b.total), paid: Number(b.paid), subtotal: Number(b.subtotal), discount: Number(b.discount) })),
      documents: (dc.data as DocumentRow[]) ?? [], labOrders: (lo.data as LabOrderRow[]) ?? [], plans: (pl.data as PhysioPlanRow[]) ?? [],
      sessions: (ss.data as TherapySessionRow[]) ?? [], vitals: (vt.data as VitalsRow[]) ?? [],
      doctors: ((pr.data as PractitionerRow[]) ?? []).filter((d) => d.active && (d.role === 'surgeon' || d.role === 'physio')),
      hospital: (org.data as PatientData['hospital']) ?? null,
    });
    setLoading(false);
  }, [patient]);

  useEffect(() => { queueMicrotask(() => { void reload(); }); }, [reload]);

  useEffect(() => {
    if (!patient) return;
    const channels = LIVE.map((key) => supabase.channel(`pt-${TABLE[key]}`).on('postgres_changes', { event: '*', schema: 'public', table: TABLE[key] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        const row = payload.new as { id: string; patient_id?: string };
        if (payload.eventType !== 'DELETE' && row?.patient_id !== patient.id) return;
        setData((d) => {
          const list = d[key] as unknown as { id: string }[];
          const next = payload.eventType === 'DELETE' ? list.filter((r) => r.id !== payload.old.id)
            : list.some((r) => r.id === row.id) ? list.map((r) => (r.id === row.id ? row : r)) : [...list, row];
          return { ...d, [key]: next };
        });
      }).subscribe());
    return () => { channels.forEach((c) => supabase.removeChannel(c)); };
  }, [patient]);

  return { data, loading, error, reload };
}

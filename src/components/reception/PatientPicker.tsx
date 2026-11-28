import { useMemo, useState } from 'react';
import { Btn, Field, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { registerPatient, searchPatients, type NewPatient } from '../../lib/frontDesk';
import type { PatientRow } from '../../types/db';

export function PatientLine({ p }: { p: PatientRow }) {
  return (
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-ink truncate">{p.name}</span>
      <span className="block text-[13px] text-ink-soft truncate">
        {[p.mrn, p.phone, p.age != null ? `${p.age} y` : null, p.gender].filter(Boolean).join(' · ')}
      </span>
    </span>
  );
}

const blank: NewPatient = { name: '', phone: '', age: '', gender: '' };

/** Find an existing patient, or register a new one, and hand it back. */
export function PatientPicker({ value, onChange }: { value: PatientRow | null; onChange: (p: PatientRow | null) => void }) {
  const { orgId, patients, pushToast, logAudit } = useClinic();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<NewPatient>(blank);
  const [saving, setSaving] = useState(false);
  const results = useMemo(() => searchPatients(patients, q), [patients, q]);
  const samePhone = useMemo(() => {
    const d = f.phone.replace(/\D/g, '');
    return d.length >= 8 ? patients.find((p) => (p.phone ?? '').replace(/\D/g, '') === d) ?? null : null;
  }, [patients, f.phone]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2" data-testid="picked-patient">
        <PatientLine p={value} />
        <Btn variant="ghost" onClick={() => onChange(null)}>Change</Btn>
      </div>
    );
  }

  async function add() {
    if (!f.name.trim() || !f.phone.trim()) return;
    setSaving(true);
    const { patient, error } = await registerPatient(orgId, patients, f);
    setSaving(false);
    if (error || !patient) { pushToast({ tone: 'critical', title: 'Could not register the patient', detail: error ?? '' }); return; }
    await logAudit('reception-register-patient', `${patient.name} (${patient.mrn})`);
    pushToast({ tone: 'ok', title: 'Patient registered', detail: `${patient.name} · ${patient.mrn}` });
    setF(blank); setAdding(false); onChange(patient);
  }

  if (adding) {
    return (
      <div className="rounded-lg border border-line p-3" data-testid="new-patient-form">
        <div className="grid sm:grid-cols-2 gap-x-3">
          <Field label="Full name"><input data-testid="np-name" className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" /></Field>
          <Field label="Mobile number"><input data-testid="np-phone" className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" autoComplete="off" /></Field>
          <Field label="Age"><input data-testid="np-age" className={inputCls} value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" /></Field>
          <Field label="Gender">
            <select data-testid="np-gender" className={inputCls} value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
              <option value="">Not stated</option><option>Female</option><option>Male</option><option>Other</option>
            </select>
          </Field>
        </div>
        {samePhone && (
          <div className="mt-1 rounded-lg bg-gate-soft px-3 py-2 text-[13px] text-ink">
            {samePhone.name} ({samePhone.mrn ?? 'no hospital number'}) already has this number.{' '}
            <button type="button" className="font-semibold text-accent-ink underline min-h-11" onClick={() => { setAdding(false); setF(blank); onChange(samePhone); }}>Use {samePhone.name}</button>
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Btn variant="primary" data-testid="np-save" disabled={saving || !f.name.trim() || !f.phone.trim()} onClick={add}>{saving ? 'Registering…' : 'Register patient'}</Btn>
          <Btn variant="ghost" onClick={() => { setAdding(false); setF(blank); }}>Cancel</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Field label="Find patient (name, mobile or hospital number)">
        <input data-testid="patient-search" className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Priya, 98765, DGY-1001" autoComplete="off" />
      </Field>
      {q.trim() && (
        <div className="-mt-1 mb-2 rounded-lg border border-line divide-y divide-line overflow-hidden">
          {results.length === 0 && <div className="px-3 py-2 text-sm text-ink-soft">No patient found.</div>}
          {results.map((p) => (
            <button key={p.id} type="button" data-testid="patient-result" onClick={() => { setQ(''); onChange(p); }}
              className="w-full text-left px-3 py-2 min-h-11 hover:bg-hover flex items-center">
              <PatientLine p={p} />
            </button>
          ))}
        </div>
      )}
      <Btn variant="default" data-testid="new-patient" onClick={() => { setAdding(true); setF({ ...blank, name: /\d/.test(q) ? '' : q.trim(), phone: /\d/.test(q) ? q.trim() : '' }); }}>+ New patient</Btn>
    </div>
  );
}

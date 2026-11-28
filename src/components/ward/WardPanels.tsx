import { useMemo, useState } from 'react';
import { Btn, Card, Field, Modal, Pill, inputCls } from '../ui';
import { LineChart } from '../LineChart';
import { PatientPicker } from '../reception/PatientPicker';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { vitalFlags } from '../../lib/ward';
import { admit, moveBed, recordVitals, type VitalsDraft } from '../../lib/wardActions';
import { clinicNow, money } from '../../lib/schedule';
import { BED_KIND } from '../../lib/labels';
import type { BedRow, PatientRow, VitalsRow } from '../../types/db';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Free beds as <option>s grouped by ward. */
function BedOptions({ beds }: { beds: BedRow[] }) {
  const wards = [...new Set(beds.map((b) => b.ward))];
  return (
    <>
      {wards.map((w) => (
        <optgroup key={w} label={w}>
          {beds.filter((b) => b.ward === w).map((b) => <option key={b.id} value={b.id}>{b.label} · {BED_KIND[b.kind]} · {money(b.daily_rate)}/day</option>)}
        </optgroup>
      ))}
    </>
  );
}

/** Admit a patient to a free bed under a doctor. */
export function AdmitModal({ beds, preselectBedId, onClose }: { beds: BedRow[]; preselectBedId?: string; onClose: () => void }) {
  const { orgId, wardLedger, pushToast, logAudit } = useClinic();
  const { practitioner } = useAuth();
  const doctors = useClinicians();
  const free = beds.filter((b) => b.active && !b.patient_id);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [bedId, setBedId] = useState(preselectBedId ?? free[0]?.id ?? '');
  const [doctorId, setDoctorId] = useState(practitioner?.role === 'surgeon' || practitioner?.role === 'physio' ? practitioner.id : doctors[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const alreadyIn = patient && (patient.queue_status === 'admitted' || beds.some((b) => b.patient_id === patient.id));

  async function save() {
    const bed = free.find((b) => b.id === bedId);
    if (!patient || !bed || !doctorId || alreadyIn) return;
    setBusy(true);
    const error = await admit(orgId, wardLedger, patient, bed, doctorId, reason.trim(), practitioner?.name ?? null, clinicNow());
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not admit', detail: error }); return; }
    await logAudit('ward-admit', `${patient.name} to ${bed.ward} ${bed.label}`);
    pushToast({ tone: 'ok', title: 'Admitted', detail: `${patient.name} · ${bed.ward} ${bed.label}` });
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="admit-title" data-testid="admit-modal">
        <h2 id="admit-title" className="text-lg mb-3">Admit a patient</h2>
        <PatientPicker value={patient} onChange={setPatient} />
        {alreadyIn && <p className="mt-2 text-[13px] text-danger" role="alert">{patient?.name} is already admitted.</p>}
        <div className="mt-3 grid sm:grid-cols-2 gap-x-3">
          <Field label={`Bed (${free.length} free)`}>
            <select className={inputCls} data-testid="admit-bed" value={bedId} onChange={(e) => setBedId(e.target.value)}>
              {free.length === 0 && <option value="">No free bed</option>}
              <BedOptions beds={free} />
            </select>
          </Field>
          <Field label="Under the care of">
            <select className={inputCls} data-testid="admit-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Reason for admission"><input className={inputCls} data-testid="admit-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Elective knee replacement" /></Field>
        <p className="text-[13px] text-ink-soft">Today's bed charge is added to the ward bill on admission.</p>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="admit-save" disabled={busy || !patient || !bedId || !doctorId || !!alreadyIn} onClick={save}>{busy ? 'Admitting…' : 'Admit'}</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Which bed the patient is in, and moving them to another. */
export function BedPanel({ patient, beds, locked }: { patient: PatientRow; beds: BedRow[]; locked: boolean }) {
  const { pushToast, logAudit, orgId, wardLedger } = useClinic();
  const { practitioner } = useAuth();
  const bed = beds.find((b) => b.patient_id === patient.id);
  const free = beds.filter((b) => b.active && !b.patient_id);
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState(free[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  async function move() {
    const target = free.find((b) => b.id === to);
    if (!target) return;
    setBusy(true);
    const error = bed ? await moveBed(bed, target, clinicNow()) : await admit(orgId, wardLedger, patient, target, patient.assigned_practitioner_id ?? practitioner?.id ?? '', 'Bed assigned', practitioner?.name ?? null, clinicNow());
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not change the bed', detail: error }); return; }
    await logAudit('ward-move-bed', `${patient.name}: ${bed ? `${bed.label} to ` : ''}${target.label}`);
    pushToast({ tone: 'ok', title: bed ? 'Moved' : 'Bed assigned', detail: `${patient.name} · ${target.ward} ${target.label}` });
    setMoving(false);
  }

  return (
    <Card data-testid="bed-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-bold text-ink">Bed</div>
          <div className="text-sm text-ink-soft" data-testid="bed-current">
            {bed ? `${bed.ward} · ${bed.label} · ${BED_KIND[bed.kind]} · ${money(bed.daily_rate)}/day · since ${when(bed.occupied_since ?? '')}` : 'No bed assigned.'}
          </div>
        </div>
        {!locked && !moving && <Btn variant="primary" data-testid="move-bed" disabled={free.length === 0} onClick={() => setMoving(true)}>{bed ? 'Move to another bed' : 'Assign a bed'}</Btn>}
      </div>
      {moving && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block flex-1 min-w-[14rem]"><span className="block text-[13px] font-semibold text-ink-soft mb-1">Free bed</span>
            <select className={inputCls} data-testid="move-bed-to" value={to} onChange={(e) => setTo(e.target.value)}><BedOptions beds={free} /></select></label>
          <Btn variant="glow" data-testid="move-bed-save" disabled={busy || !to} onClick={move}>{bed ? 'Move' : 'Assign'}</Btn>
          <Btn variant="ghost" onClick={() => setMoving(false)}>Cancel</Btn>
        </div>
      )}
    </Card>
  );
}

const blank = { sys: '', dia: '', pulse: '', temp: '', spo2: '', rr: '', pain: '', note: '' };
const num = (s: string) => (s.trim() === '' ? null : Number(s));

/** Record vital signs and see their trend; readings that need attention are flagged. */
export function VitalsPanel({ patient, vitals, locked }: { patient: PatientRow; vitals: VitalsRow[]; locked: boolean }) {
  const { orgId, pushToast, logAudit } = useClinic();
  const { practitioner } = useAuth();
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const mine = useMemo(() => vitals.filter((v) => v.patient_id === patient.id).sort((a, b) => a.taken_at.localeCompare(b.taken_at)), [vitals, patient.id]);
  const latest = mine[mine.length - 1];
  const draft: VitalsDraft = {
    bp_systolic: num(f.sys), bp_diastolic: num(f.dia), pulse: num(f.pulse), temp_c: num(f.temp), spo2: num(f.spo2),
    resp_rate: num(f.rr), pain: num(f.pain), note: f.note.trim() || null,
  };
  const ranges: [keyof typeof f, number, number, string][] = [['sys', 50, 300, 'BP top number'], ['dia', 20, 200, 'BP bottom number'], ['pulse', 20, 250, 'Pulse'],
    ['temp', 30, 45, 'Temperature'], ['spo2', 50, 100, 'SpO2'], ['rr', 4, 60, 'Breathing rate'], ['pain', 0, 10, 'Pain']];
  const problem = ranges.map(([k, lo, hi, l]) => (f[k].trim() !== '' && !(Number(f[k]) >= lo && Number(f[k]) <= hi) ? `${l} must be ${lo} to ${hi}.` : null)).find(Boolean) ?? null;
  const empty = ['sys', 'dia', 'pulse', 'temp', 'spo2', 'rr', 'pain'].every((k) => f[k as keyof typeof f].trim() === '');
  const flagsNow = vitalFlags(draft);

  async function save() {
    setBusy(true);
    const error = await recordVitals(orgId, patient.id, draft, practitioner?.name ?? null, clinicNow());
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not save vitals', detail: error }); return; }
    await logAudit('ward-vitals', `${patient.name}${flagsNow.length ? `: ${flagsNow.map((x) => x.label).join(', ')}` : ''}`);
    pushToast({ tone: flagsNow.length ? 'warning' : 'ok', title: 'Vitals saved', detail: flagsNow.length ? flagsNow.map((x) => x.label).join(', ') : patient.name });
    setF(blank);
  }

  const series = (pick: (v: VitalsRow) => number | null) => mine.filter((v) => pick(v) != null).map((v) => ({ label: new Date(v.taken_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), value: pick(v) as number }));
  const input = (k: keyof typeof f, label: string, mode: 'numeric' | 'decimal' = 'numeric') => (
    <Field label={label}><input className={inputCls} inputMode={mode} data-testid={`vt-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(mode === 'decimal' ? /[^\d.]/g : /\D/g, '') })} /></Field>
  );

  return (
    <Card data-testid="vitals-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-base font-bold text-ink">Vital signs</div>
        {latest && (
          <div className="flex flex-wrap gap-2" data-testid="vitals-latest-flags">
            {vitalFlags(latest).length === 0 ? <Pill tone="ok">Latest within range</Pill> : vitalFlags(latest).map((x) => <Pill key={x.label} tone="danger">{x.label}</Pill>)}
          </div>
        )}
      </div>
      {latest && (
        <p className="text-sm text-ink-soft mb-3" data-testid="vitals-latest">
          Latest {when(latest.taken_at)}: BP {latest.bp_systolic ?? '–'}/{latest.bp_diastolic ?? '–'} · pulse {latest.pulse ?? '–'} · temp {latest.temp_c ?? '–'}°C · SpO2 {latest.spo2 ?? '–'}% · breathing {latest.resp_rate ?? '–'} · pain {latest.pain ?? '–'}/10
        </p>
      )}
      {mine.length > 1 && (
        <div className="grid md:grid-cols-2 gap-3 mb-3">
          <div><div className="text-[13px] font-semibold text-ink-soft">Pulse</div><LineChart points={series((v) => v.pulse)} yMax={160} title="Pulse over time" /></div>
          <div><div className="text-[13px] font-semibold text-ink-soft">Temperature (°C)</div><LineChart points={series((v) => v.temp_c)} yMax={42} title="Temperature over time" /></div>
          <div><div className="text-[13px] font-semibold text-ink-soft">BP, top number</div><LineChart points={series((v) => v.bp_systolic)} yMax={220} title="Systolic blood pressure over time" /></div>
          <div><div className="text-[13px] font-semibold text-ink-soft">SpO2 (%)</div><LineChart points={series((v) => v.spo2)} yMax={100} unit="%" title="Oxygen saturation over time" /></div>
        </div>
      )}
      {!locked && (
        <div className="border-t border-line pt-3" data-testid="vitals-form">
          <div className="text-sm font-semibold text-ink mb-2">Record vitals now</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3">
            {input('sys', 'BP top (mmHg)')}{input('dia', 'BP bottom (mmHg)')}{input('pulse', 'Pulse (/min)')}{input('temp', 'Temp (°C)', 'decimal')}
            {input('spo2', 'SpO2 (%)')}{input('rr', 'Breathing (/min)')}{input('pain', 'Pain (0-10)')}
          </div>
          <Field label="Note (optional)"><input className={inputCls} data-testid="vt-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          {problem && <p className="text-[13px] text-danger mb-2" role="alert">{problem}</p>}
          {!problem && flagsNow.length > 0 && <p className="text-[13px] text-danger mb-2" data-testid="vt-warning">Needs attention: {flagsNow.map((x) => x.label).join(', ')}.</p>}
          <Btn variant="glow" data-testid="vt-save" disabled={busy || empty || !!problem} onClick={save}>{busy ? 'Saving…' : 'Save vitals'}</Btn>
        </div>
      )}
      {mine.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer min-h-11 flex items-center text-sm font-semibold text-accent-ink">All readings ({mine.length})</summary>
          <ul className="divide-y divide-line">
            {[...mine].reverse().map((v) => (
              <li key={v.id} className="py-2 text-sm">
                <span className="text-ink">{when(v.taken_at)}</span>
                <span className="text-ink-soft"> · BP {v.bp_systolic ?? '–'}/{v.bp_diastolic ?? '–'} · P {v.pulse ?? '–'} · T {v.temp_c ?? '–'} · SpO2 {v.spo2 ?? '–'} · RR {v.resp_rate ?? '–'} · pain {v.pain ?? '–'}</span>
                {v.note && <span className="block text-ink-soft">{v.note}{v.recorded_by ? ` (${v.recorded_by})` : ''}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

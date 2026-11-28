import { useState } from 'react';
import { Btn, Card, Field, Modal, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { useBeds } from '../../hooks/useHospitalSetup';
import { useAdmissions } from '../../hooks/useDesk';
import { PatientPicker } from '../reception/PatientPicker';
import { balance, clinicNow, money } from '../../lib/schedule';
import { daysAdmitted } from '../../lib/desk';
import { admitPatient } from '../../lib/deskActions';
import type { BedRow, BillRow, PatientRow, PaymentMethod } from '../../types/db';
import type { Payer } from '../../types/desk';
import { Empty, PageTabs, Row, Stat } from './common';

const KIND: Record<string, string> = { general: 'General', semi_private: 'Semi-private', private: 'Private', icu: 'ICU', day_care: 'Day care' };
const PAYER: Record<Payer, string> = { self: 'Self pay', insurance: 'Insurance', corporate: 'Company', government: 'Government scheme' };

/**
 * Admissions desk: every bed (free or whose), admitting with a deposit
 * receipt, each stay's running bill against its deposit, and patients the
 * doctor has discharged who are waiting for final billing.
 */
export function AdmissionsSection({ bills, onReceipt, onOpenPatient }: { bills: BillRow[]; onReceipt: (b: BillRow) => void; onOpenPatient: (id: string) => void }) {
  const { orgId, patients, wardLedger } = useClinic();
  const clinicians = useClinicians();
  const { beds } = useBeds(orgId);
  const admissions = useAdmissions(orgId);
  const [tab, setTab] = useState<'beds' | 'in' | 'discharge'>('beds');
  const [admitTo, setAdmitTo] = useState<BedRow | null | 'any'>(null);
  const now = clinicNow();
  const active = beds.filter((b) => b.active);
  const free = active.filter((b) => !b.patient_id);
  const inPatients = patients.filter((p) => p.queue_status === 'admitted' || p.queue_status === 'pending_discharge_clearance');
  const ready = patients.filter((p) => p.queue_status === 'pending_discharge_clearance');
  const wards = [...new Set(active.map((b) => b.ward))];
  const pt = (id: string | null) => patients.find((p) => p.id === id);
  const stayOf = (pid: string) => admissions.filter((a) => a.patient_id === pid && a.status === 'admitted').sort((a, b) => b.admitted_at.localeCompare(a.admitted_at))[0];
  const charges = (pid: string) => wardLedger.filter((l) => l.patient_id === pid).reduce((s, l) => s + Number(l.amount), 0);
  // Deposits: ward receipts, plus any deposit recorded on a stay without a receipt.
  const deposits = (pid: string) => bills.filter((b) => b.patient_id === pid && b.status !== 'void' && (b as BillRow & { source?: string }).source === 'ward').reduce((s, b) => s + b.paid, 0)
    + admissions.filter((a) => a.patient_id === pid && a.status === 'admitted' && !a.deposit_bill_id).reduce((s, a) => s + a.deposit, 0);
  const owed = (pid: string) => bills.filter((b) => b.patient_id === pid).reduce((s, b) => s + balance(b), 0);

  return (
    <div data-testid="admissions">
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Beds free" value={`${free.length} of ${active.length}`} tone={free.length === 0 ? 'danger' : undefined} />
        <Stat label="Patients admitted" value={inPatients.length} />
        <Stat label="Ready for discharge billing" value={ready.length} tone={ready.length ? 'gate' : undefined} />
        <Stat label="Deposits held" value={money(inPatients.reduce((s, p) => s + deposits(p.id), 0))} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageTabs tabs={[{ id: 'beds', label: 'Beds' }, { id: 'in', label: `Admitted (${inPatients.length})` }, { id: 'discharge', label: `Discharge (${ready.length})` }]} value={tab} onChange={setTab} />
        <Btn variant="glow" data-testid="admit-new" disabled={free.length === 0} onClick={() => setAdmitTo('any')}>+ Admit a patient</Btn>
      </div>

      {tab === 'beds' && wards.map((w) => (
        <Card key={w} className="mb-3">
          <h2 className="text-base font-semibold text-ink">{w}</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="bed-board">
            {active.filter((b) => b.ward === w).map((b) => {
              const p = pt(b.patient_id);
              return (
                <div key={b.id} data-testid="bed" data-free={!p} className={`rounded-xl border p-3 ${p ? 'border-line bg-surface-2' : 'border-dashed border-accent'}`}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-ink">{b.label}</span>
                    <span className="text-[12px] text-ink-soft">{KIND[b.kind] ?? b.kind} · {money(b.daily_rate)}/day</span>
                  </div>
                  {p ? (
                    <button type="button" className="mt-1 block text-left text-sm text-ink hover:underline min-h-11" onClick={() => onOpenPatient(p.id)}>
                      {p.name}
                      <span className="block text-[12px] text-ink-soft">{b.occupied_since ? `day ${daysAdmitted({ admitted_at: b.occupied_since, discharged_at: null }, now)}` : ''}{p.queue_status === 'pending_discharge_clearance' ? ' · discharging' : ''}</span>
                    </button>
                  ) : <Btn variant="default" className="mt-1" data-testid="bed-admit" onClick={() => setAdmitTo(b)}>Admit here</Btn>}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
      {tab === 'beds' && wards.length === 0 && <Card><p className="text-sm text-ink-soft">No beds set up. The admin adds wards and beds.</p></Card>}

      {tab === 'in' && (
        <Card>
          <ul className="divide-y divide-line" data-testid="admitted-list">
            {inPatients.length === 0 && <Empty>Nobody is admitted.</Empty>}
            {inPatients.map((p) => {
              const bed = beds.find((b) => b.patient_id === p.id);
              const stay = stayOf(p.id);
              const days = stay ? daysAdmitted(stay, now) : bed?.occupied_since ? daysAdmitted({ admitted_at: bed.occupied_since, discharged_at: null }, now) : null;
              const ch = charges(p.id);
              const dep = deposits(p.id);
              return (
                <Row key={p.id} testid="admitted-row" tone={ch > dep ? 'gate' : undefined} title={`${p.name} · ${bed ? `${bed.ward} ${bed.label}` : 'no bed'}`}
                  meta={<>
                    {days != null ? `Day ${days}` : ''}{stay?.expected_days ? ` of about ${stay.expected_days}` : ''} · {clinicians.find((c) => c.id === (stay?.practitioner_id ?? p.assigned_practitioner_id))?.name ?? ''}
                    {stay ? ` · ${PAYER[stay.payer]}` : ''}{stay?.reason ? ` · ${stay.reason}` : ''}
                    <span className="block">Ward charges {money(ch)} · deposit {money(dep)} · {ch > dep ? <span className="font-semibold text-gate">ask for {money(ch - dep)} more</span> : 'covered'}{owed(p.id) > 0 ? ` · bills due ${money(owed(p.id))}` : ''}</span>
                  </>}>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Btn variant="default" onClick={() => onOpenPatient(p.id)}>Open record</Btn>
                    {stay?.deposit_bill_id && <Btn variant="ghost" onClick={() => { const b = bills.find((x) => x.id === stay.deposit_bill_id); if (b) onReceipt(b); }}>Deposit receipt</Btn>}
                  </div>
                </Row>
              );
            })}
          </ul>
        </Card>
      )}

      {tab === 'discharge' && (
        <Card>
          <p className="mb-2 text-[13px] text-ink-soft">The doctor has signed the discharge. The admin settles the final bill (Admin › Discharge billing), which frees the bed.</p>
          <ul className="divide-y divide-line">
            {ready.length === 0 && <Empty>Nobody is waiting for discharge billing.</Empty>}
            {ready.map((p) => (
              <Row key={p.id} tone="gate" title={p.name} meta={`Ward charges ${money(charges(p.id))} · deposit ${money(deposits(p.id))} · balance ${money(Math.max(0, charges(p.id) - deposits(p.id)) + owed(p.id))}`}>
                <div className="mt-1.5"><Btn variant="default" onClick={() => onOpenPatient(p.id)}>Open record</Btn></div>
              </Row>
            ))}
          </ul>
        </Card>
      )}

      {admitTo && <AdmitModal bed={admitTo === 'any' ? null : admitTo} free={free} bills={bills} onClose={() => setAdmitTo(null)} onReceipt={onReceipt} />}
    </div>
  );
}

function AdmitModal({ bed, free, bills, onClose, onReceipt }: { bed: BedRow | null; free: BedRow[]; bills: BillRow[]; onClose: () => void; onReceipt: (b: BillRow) => void }) {
  const { orgId, wardLedger, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [bedId, setBedId] = useState(bed?.id ?? free[0]?.id ?? '');
  const [doctorId, setDoctorId] = useState(clinicians.find((c) => c.role === 'surgeon')?.id ?? clinicians[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [payer, setPayer] = useState<Payer>('self');
  const [deposit, setDeposit] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [saving, setSaving] = useState(false);
  const chosen = free.find((b) => b.id === bedId);
  const suggested = chosen ? chosen.daily_rate * Math.max(1, Number(days) || 3) : 0;

  async function save() {
    if (!patient || !chosen) return;
    setSaving(true);
    const r = await admitPatient(orgId, wardLedger, bills, {
      patient, bed: chosen, doctorId, reason, expectedDays: Number(days) > 0 ? Number(days) : null, payer, deposit: Number(deposit) || 0, method, by: me?.name ?? null,
    }, clinicNow());
    setSaving(false);
    if (r.error) { pushToast({ tone: 'critical', title: 'Could not admit', detail: r.error }); return; }
    await logAudit('reception-admit', `${patient.name} to ${chosen.ward} ${chosen.label}${Number(deposit) ? `, deposit ${money(Number(deposit))}` : ''}`);
    pushToast({ tone: 'ok', title: 'Admitted', detail: `${patient.name} · ${chosen.ward} ${chosen.label}` });
    onClose();
    if (r.depositBill) onReceipt(r.depositBill);
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="admit-title" data-testid="admit-form">
        <h2 id="admit-title" className="text-lg mb-3">Admit a patient</h2>
        <PatientPicker value={patient} onChange={setPatient} />
        {patient && (patient.queue_status === 'admitted' || patient.queue_status === 'pending_discharge_clearance') && <p className="mt-2 text-[13px] font-semibold text-danger">{patient.name} is already admitted.</p>}
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Bed">
            <select className={inputCls} value={bedId} onChange={(e) => setBedId(e.target.value)} data-testid="admit-bed">
              {free.map((b) => <option key={b.id} value={b.id}>{b.ward} · {b.label} ({money(b.daily_rate)}/day)</option>)}
            </select>
          </Field>
          <Field label="Admitting doctor">
            <select className={inputCls} value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Expected days"><input className={inputCls} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Paid by">
            <select className={inputCls} value={payer} onChange={(e) => setPayer(e.target.value as Payer)} data-testid="admit-payer">
              {(Object.keys(PAYER) as Payer[]).map((k) => <option key={k} value={k}>{PAYER[k]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Reason for admission"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Knee replacement surgery" data-testid="admit-reason" /></Field>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label={`Deposit (suggested ${money(suggested)})`}><input className={inputCls} inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} data-testid="admit-deposit" /></Field>
          <Field label="Deposit paid by">
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
            </select>
          </Field>
        </div>
        {payer === 'insurance' && <p className="mt-2 text-[13px] text-ink-soft">Start the insurer's pre-authorisation from Insurance once the patient is admitted.</p>}
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="admit-save" disabled={saving || !patient || !chosen || patient.queue_status === 'admitted'} onClick={save}>Admit{Number(deposit) ? ` and take ${money(Number(deposit))}` : ''}</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

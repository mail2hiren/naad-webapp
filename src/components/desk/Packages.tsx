import { useState } from 'react';
import { Btn, Card, Field, Modal, Pill, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { usePackageTypes, usePatientPackages } from '../../hooks/useDesk';
import { PatientPicker } from '../reception/PatientPicker';
import { clinicNow, clinicToday, money } from '../../lib/schedule';
import { packageState } from '../../lib/desk';
import { savePackageType, sellPackage, setPackageStatus, putVisitOnPackage } from '../../lib/deskActions';
import type { AppointmentRow, BillRow, PatientRow, PaymentMethod } from '../../types/db';
import type { PatientPackageRow, TreatmentPackageRow } from '../../types/desk';
import { Empty, PageTabs, Row, Stat } from './common';
import { fmtDay } from './labels';

/**
 * Treatment packages (e.g. 8 physio sessions): what each patient bought,
 * sessions used and left, expiry, booking the next session on the package,
 * selling a new one, and (for the admin) the list of packages on offer.
 */
export function PackagesSection({ bills, onBook, onReceipt }: {
  bills: BillRow[]; onBook: (p: PatientRow, doctorId: string | null, after: (a: AppointmentRow | null) => void) => void; onReceipt: (b: BillRow) => void;
}) {
  const { orgId, patients, appointments, pushToast } = useClinic();
  const { practitioner: me } = useAuth();
  const types = usePackageTypes(orgId);
  const sold = usePatientPackages(orgId);
  const [tab, setTab] = useState<'active' | 'ended' | 'list'>('active');
  const [selling, setSelling] = useState(false);
  const [editing, setEditing] = useState<TreatmentPackageRow | 'new' | null>(null);
  const today = clinicToday();
  const isAdmin = me?.role === 'admin';
  const withState = sold.map((p) => ({ p, s: packageState(p, appointments, today) }));
  const active = withState.filter(({ p, s }) => p.status === 'active' && s.usable);
  const ended = withState.filter(({ p, s }) => !(p.status === 'active' && s.usable));
  const pt = (id: string) => patients.find((x) => x.id === id);
  const lastDoctor = (p: PatientPackageRow) => appointments.filter((a) => (a as AppointmentRow & { patient_package_id?: string | null }).patient_package_id === p.id)
    .sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''))[0]?.practitioner_id ?? null;

  const row = ({ p, s }: { p: PatientPackageRow; s: ReturnType<typeof packageState> }) => {
    const bill = bills.find((b) => b.id === p.bill_id);
    const due = bill ? Math.max(0, bill.total - bill.paid) : 0;
    return (
      <Row key={p.id} testid="pkg-row" tone={s.left <= 1 && s.usable ? 'gate' : undefined} title={<>{pt(p.patient_id)?.name ?? 'Patient'} · {p.name} {!s.usable && <Pill tone="default">{s.why}</Pill>}</>}
        meta={<>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-28 h-1.5 rounded-full bg-surface-2 overflow-hidden" role="img" aria-label={`${s.used} of ${p.sessions_total} sessions used`}>
              <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (s.used / p.sessions_total) * 100)}%` }} />
            </span>
            <span data-testid="pkg-used">{s.used} of {p.sessions_total} used · {s.left} left{s.booked ? ` · ${s.booked} booked` : ''}</span>
          </span>
          <span className="block">Bought {fmtDay(p.starts_on)}{p.expires_on ? ` · valid till ${fmtDay(p.expires_on)}` : ''} · {money(p.price)}{due > 0 ? <span className="font-semibold text-gate"> · {money(due)} still to pay</span> : ''}</span>
        </>}>
        {s.usable && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Btn variant="glow" data-testid="pkg-book" disabled={s.left - s.booked <= 0} onClick={() => {
              const patient = pt(p.patient_id);
              if (patient) onBook(patient, lastDoctor(p), async (a) => { if (a) { await putVisitOnPackage(a.id, p.id); pushToast({ tone: 'ok', title: 'Session booked on the package', detail: `${s.used + s.booked + 1} of ${p.sessions_total}` }); } });
            }}>Book next session</Btn>
            {bill && <Btn variant="ghost" onClick={() => onReceipt(bill)}>Receipt</Btn>}
            <Btn variant="ghost" onClick={async () => { await setPackageStatus(p, 'cancelled'); pushToast({ tone: 'ok', title: 'Package cancelled', detail: p.name }); }}>Cancel package</Btn>
          </div>
        )}
      </Row>
    );
  };

  return (
    <div data-testid="packages">
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Active packages" value={active.length} />
        <Stat label="Sessions left in all" value={active.reduce((n, x) => n + x.s.left, 0)} />
        <Stat label="Ending soon (1 left)" value={active.filter((x) => x.s.left <= 1).length} tone={active.some((x) => x.s.left <= 1) ? 'gate' : undefined} />
        <Stat label="Packages on offer" value={types.filter((t) => t.active).length} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageTabs tabs={[{ id: 'active', label: `Active (${active.length})` }, { id: 'ended', label: `Finished (${ended.length})` }, { id: 'list', label: 'Packages on offer' }]} value={tab} onChange={setTab} />
        <Btn variant="glow" data-testid="pkg-sell" disabled={!types.some((t) => t.active)} onClick={() => setSelling(true)}>+ Sell a package</Btn>
      </div>
      {tab !== 'list' && (
        <Card>
          <ul className="divide-y divide-line" data-testid="pkg-list">
            {(tab === 'active' ? active : ended).length === 0 && <Empty>{tab === 'active' ? 'No active packages.' : 'None yet.'}</Empty>}
            {(tab === 'active' ? active : ended).map(row)}
          </ul>
        </Card>
      )}
      {tab === 'list' && (
        <Card>
          <ul className="divide-y divide-line" data-testid="pkg-types">
            {types.length === 0 && <Empty>No packages set up.{isAdmin ? '' : ' The admin adds them.'}</Empty>}
            {types.map((t) => (
              <Row key={t.id} title={<>{t.name} {!t.active && <Pill tone="default">Retired</Pill>}</>} meta={`${t.sessions} sessions · ${money(t.price)} (${money(Math.round(t.price / t.sessions))} a session)${t.valid_days ? ` · use within ${t.valid_days} days` : ''}`}>
                {isAdmin && <div className="mt-1.5"><Btn variant="default" onClick={() => setEditing(t)}>Edit</Btn></div>}
              </Row>
            ))}
          </ul>
          {isAdmin && <Btn variant="default" className="mt-3" onClick={() => setEditing('new')}>+ Add package</Btn>}
        </Card>
      )}
      {selling && <SellPackage types={types.filter((t) => t.active)} bills={bills} onClose={() => setSelling(false)} onReceipt={onReceipt} />}
      {editing && <EditType t={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SellPackage({ types, bills, onClose, onReceipt }: { types: TreatmentPackageRow[]; bills: BillRow[]; onClose: () => void; onReceipt: (b: BillRow) => void }) {
  const { orgId, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const t = types.find((x) => x.id === typeId);
  const [paid, setPaid] = useState(t ? String(t.price) : '');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!patient || !t) return;
    setSaving(true);
    const r = await sellPackage(orgId, bills, patient, t, Math.min(Number(paid) || 0, t.price), method, me?.name ?? null, clinicNow());
    setSaving(false);
    if (r.error) { pushToast({ tone: 'critical', title: 'Could not sell the package', detail: r.error }); return; }
    await logAudit('reception-sell-package', `${patient.name}: ${t.name}`);
    pushToast({ tone: 'ok', title: 'Package sold', detail: `${patient.name} · ${t.name}` });
    onClose();
    if (r.bill) onReceipt(r.bill);
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sell-title" data-testid="pkg-sell-form">
        <h2 id="sell-title" className="text-lg mb-3">Sell a package</h2>
        <PatientPicker value={patient} onChange={setPatient} />
        <Field label="Package">
          <select className={inputCls} value={typeId} onChange={(e) => { setTypeId(e.target.value); const x = types.find((y) => y.id === e.target.value); if (x) setPaid(String(x.price)); }} data-testid="pkg-type">
            {types.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.sessions} sessions · {money(x.price)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Paid now (₹)"><input className={inputCls} inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} data-testid="pkg-paid" /></Field>
          <Field label="Paid by">
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              <option value="upi">UPI</option><option value="cash">Cash</option><option value="card">Card</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="pkg-sell-save" disabled={saving || !patient || !t} onClick={save}>Sell and bill</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

function EditType({ t, onClose }: { t: TreatmentPackageRow | null; onClose: () => void }) {
  const { orgId, pushToast } = useClinic();
  const [f, setF] = useState({ name: t?.name ?? '', sessions: String(t?.sessions ?? 8), price: String(t?.price ?? ''), valid: t?.valid_days ? String(t.valid_days) : '60', active: t?.active ?? true });
  async function save() {
    const e = await savePackageType(orgId, { id: t?.id, name: f.name, sessions: Number(f.sessions), price: Number(f.price), validDays: Number(f.valid) || null, active: f.active });
    if (e) { pushToast({ tone: 'critical', title: 'Could not save', detail: e }); return; }
    pushToast({ tone: 'ok', title: 'Package saved', detail: f.name });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="pt-title">
        <h2 id="pt-title" className="text-lg mb-3">{t ? 'Edit package' : 'Add package'}</h2>
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-x-3">
          <Field label="Sessions"><input className={inputCls} inputMode="numeric" value={f.sessions} onChange={(e) => setF({ ...f, sessions: e.target.value })} /></Field>
          <Field label="Price (₹)"><input className={inputCls} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Valid (days)"><input className={inputCls} inputMode="numeric" value={f.valid} onChange={(e) => setF({ ...f, valid: e.target.value })} /></Field>
        </div>
        <label className="mt-2 inline-flex items-center gap-2 text-sm text-ink min-h-11"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="w-4 h-4 accent-[var(--accent)]" /> On offer</label>
        <div className="mt-4 flex gap-2"><Btn variant="glow" onClick={save}>Save</Btn><Btn variant="ghost" onClick={onClose}>Cancel</Btn></div>
      </div>
    </Modal>
  );
}

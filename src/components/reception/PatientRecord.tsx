import { useMemo, useState, type ReactNode } from 'react';
import { Btn, Card, Field, Modal, Pill, Tabs, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { usePatientRecord } from '../../hooks/usePatientRecord';
import {
  STATUS_LABEL, STATUS_TONE, VISIT_LABEL, apptStart, balance, clinicNow, clinicToday, money, onDay, timeLabel,
} from '../../lib/schedule';
import { lastVisit, noShowRisk, waitMinutes } from '../../lib/calendar';
import { checkIn } from '../../lib/frontDesk';
import { supabase } from '../../lib/supabaseClient';
import type { AppointmentRow, BillRow, PatientRow } from '../../types/db';

type RecordTab = 'overview' | 'visits' | 'bills' | 'medicines' | 'tests' | 'therapy';

const when = (iso: string | Date) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const date = (iso: string | Date) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const ORDER_LABEL: Record<string, string> = { received: 'Received', preparing: 'Being prepared', packed: 'Packed', exception: 'Needs attention', ready: 'Ready to collect', collected: 'Collected' };
const LAB_LABEL: Record<string, string> = { ordered: 'Ordered', in_progress: 'In progress', completed: 'Result in', reviewed: 'Doctor reviewed' };
const DOC_LABEL: Record<string, string> = { xray: 'X-ray', prescription: 'Prescription', report: 'Report', other: 'Document' };

/**
 * The patient's whole record as the front desk sees it: who they are, what
 * needs attention, today's visit with one-tap check-in, every visit, bill,
 * medicine, test, document and therapy course. Clinical notes stay with the
 * doctors; the desk sees what was done, not what was written.
 */
export function PatientRecord({
  patient, bills, onBack, backLabel, onBook, onBill, onBillAppt, onReceipt,
}: {
  patient: PatientRow; bills: BillRow[]; onBack: () => void; backLabel: string;
  onBook: (p: PatientRow) => void; onBill: (p: PatientRow) => void; onBillAppt: (a: AppointmentRow) => void; onReceipt: (b: BillRow) => void;
}) {
  const { appointments, encounters, prescriptions, pharmacyOrders, practitioners, pushToast, logAudit } = useClinic();
  const { extras, loading } = usePatientRecord(patient.id);
  const [tab, setTab] = useState<RecordTab>('overview');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = clinicNow();
  const today = clinicToday();
  const doc = (id: string | null | undefined) => practitioners.find((d) => d.id === id)?.name ?? '';

  const visits = useMemo(() => appointments.filter((a) => a.patient_id === patient.id)
    .sort((a, b) => (apptStart(b)?.getTime() ?? 0) - (apptStart(a)?.getTime() ?? 0)), [appointments, patient.id]);
  const todays = visits.filter((a) => onDay(a, today) && a.status !== 'cancelled');
  const upcoming = visits.filter((a) => (a.status === 'scheduled' || a.status === 'requested') && (apptStart(a)?.getTime() ?? 0) > now.getTime() && !onDay(a, today)).reverse();
  const theirBills = bills.filter((b) => b.patient_id === patient.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const owed = theirBills.reduce((s, b) => s + balance(b), 0);
  const paidTotal = theirBills.filter((b) => b.status !== 'void').reduce((s, b) => s + b.paid, 0);
  const toBill = visits.filter((a) => (a.status === 'completed' || a.status === 'in_consultation' || a.status === 'checked_in') && !bills.some((b) => b.appointment_id === a.id && b.status !== 'void'));
  const consults = encounters.filter((e) => e.patient_id === patient.id).sort((a, b) => b.started_at.localeCompare(a.started_at));
  // Consultations with no calendar booking (walk-ins, ward rounds) still belong in the visit history.
  const unbooked = consults.filter((e) => !visits.some((a) => a.practitioner_id === e.practitioner_id && apptStart(a) && apptStart(a)!.toISOString().slice(0, 10) === e.started_at.slice(0, 10)));
  const rx = prescriptions.filter((p) => p.patient_id === patient.id && p.status === 'sent_to_pharmacy');
  const orders = pharmacyOrders.filter((o) => o.patient_id === patient.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const risk = noShowRisk(appointments, patient.id, now);
  const last = lastVisit(appointments, patient.id, now);
  const firstSeen = visits.length ? apptStart(visits[visits.length - 1]) : null;

  async function doCheckIn(a: AppointmentRow) {
    setBusy(true);
    const { token, error } = await checkIn(a, appointments, patient, clinicNow());
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not check in', detail: error }); return; }
    await logAudit('reception-check-in', `${patient.name} with ${doc(a.practitioner_id)}, token ${token ?? '-'}`);
    pushToast({ tone: 'ok', title: token ? `Checked in · Token ${token}` : 'Checked in', detail: `${patient.name} is waiting for ${doc(a.practitioner_id)}` });
  }

  const tabs: { id: RecordTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'visits', label: `Visits (${visits.length + unbooked.length})` },
    { id: 'bills', label: `Bills (${theirBills.length})` },
    { id: 'medicines', label: `Medicines (${rx.length})` },
    { id: 'tests', label: `Tests & documents (${extras.labOrders.length + extras.documents.length})` },
    { id: 'therapy', label: `Therapy (${extras.plans.length})` },
  ];

  return (
    <div data-testid="patient-record">
      <Btn variant="ghost" className="mb-3" data-testid="record-back" onClick={onBack}>← {backLabel}</Btn>

      {/* Header */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-start gap-4">
          <div aria-hidden="true" className="w-14 h-14 shrink-0 rounded-full bg-accent text-on-accent flex items-center justify-center text-xl font-bold">
            {patient.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl text-ink" data-testid="record-name">{patient.name}</h2>
            <p className="text-sm text-ink-soft">
              {[patient.age != null ? `${patient.age} years` : null, patient.gender, patient.mrn, patient.preferred_language === 'hi' ? 'Prefers Hindi' : null].filter(Boolean).join(' · ')}
            </p>
            <p className="text-sm text-ink-soft">
              {patient.phone ? <a className="font-semibold text-accent-ink hover:underline" href={`tel:${patient.phone.replace(/\s/g, '')}`}>{patient.phone}</a> : 'No mobile number'}
              {patient.phone_verified ? ' · verified' : ''}
              {patient.auth_user_id ? ' · uses the patient app' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="glow" data-testid="record-book" onClick={() => onBook(patient)}>Book appointment</Btn>
            <Btn variant="default" data-testid="record-bill" onClick={() => onBill(patient)}>New bill</Btn>
            <Btn variant="default" data-testid="record-edit" onClick={() => setEditing(true)}>Edit details</Btn>
          </div>
        </div>

        {/* What needs attention */}
        <ul className="mt-4 flex flex-wrap gap-2" data-testid="record-alerts">
          {patient.allergies.length > 0
            ? <Alert tone="danger">Allergies: {patient.allergies.join(', ')}</Alert>
            : <Alert tone="muted">No allergies recorded</Alert>}
          {owed > 0 && <Alert tone="gate">Owes {money(owed)}</Alert>}
          {risk.risk !== 'none' && <Alert tone={risk.risk === 'high' ? 'danger' : 'gate'}>Missed {risk.noShows} of {risk.visits} visits</Alert>}
          {patient.queue_status === 'admitted' && <Alert tone="gate">On the ward now</Alert>}
          {orders.some((o) => o.status === 'ready') && <Alert tone="ok">Medicines ready to collect</Alert>}
          {extras.labOrders.some((l) => l.flagged) && <Alert tone="danger">A test result needs the doctor</Alert>}
        </ul>

        {/* Today */}
        {todays.length > 0 && (
          <div className="mt-4 rounded-xl border border-accent p-3" data-testid="record-today">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-soft">Today</h3>
            <ul className="divide-y divide-line">
              {todays.map((a) => {
                const w = waitMinutes(a, now);
                const billed = bills.some((b) => b.appointment_id === a.id && b.status !== 'void');
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{timeLabel(apptStart(a)!)} · {doc(a.practitioner_id)}{a.token_no ? ` · Token ${a.token_no}` : ''}</span>
                      <span className="block text-[13px] text-ink-soft">{VISIT_LABEL[a.visit_type ?? 'consultation']}{a.reason ? ` · ${a.reason}` : ''}{w != null && a.status === 'checked_in' ? ` · waiting ${w} min` : ''}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>
                      {a.status === 'scheduled' && <Btn variant="glow" data-testid="record-check-in" disabled={busy} onClick={() => doCheckIn(a)}>Check in</Btn>}
                      {a.status === 'completed' && !billed && <Btn variant="default" onClick={() => onBillAppt(a)}>Bill visit</Btn>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <Tabs tabs={tabs} activeId={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <H>Details</H>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <Row k="Hospital no.">{patient.mrn ?? '—'}</Row>
              <Row k="Age / sex">{[patient.age != null ? `${patient.age} y` : '—', patient.gender ?? '—'].join(' / ')}</Row>
              <Row k="Mobile">{patient.phone ?? '—'}</Row>
              <Row k="Language">{patient.preferred_language === 'hi' ? 'Hindi' : 'English'}</Row>
              <Row k="Usual doctor">{doc(patient.assigned_practitioner_id) || '—'}</Row>
              <Row k="First visit">{firstSeen ? date(firstSeen) : '—'}</Row>
              <Row k="Last visit">{last ? `${date(apptStart(last)!)} · ${doc(last.practitioner_id)}` : '—'}</Row>
              {patient.triage?.complaints && <Row k="Came with">{String(patient.triage.complaints)}</Row>}
            </dl>
          </Card>
          <Card>
            <H>Health summary</H>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <Row k="Allergies"><span className={patient.allergies.length ? 'font-semibold text-danger' : ''}>{patient.allergies.join(', ') || 'None recorded'}</span></Row>
              <Row k="Conditions">{patient.conditions.join(', ') || 'None recorded'}</Row>
              <Row k="Regular medicines">{patient.medications.join(', ') || 'None recorded'}</Row>
              {patient.journey_stage && <Row k="Care stage">{patient.journey_stage.replace('_', ' ')}</Row>}
            </dl>
            <p className="mt-3 text-[12px] text-ink-faint">Doctors' notes are shown to clinicians only.</p>
          </Card>
          <Card>
            <H>Coming up</H>
            {upcoming.length === 0 ? <p className="text-sm text-ink-soft">Nothing booked.</p> : (
              <ul className="divide-y divide-line">{upcoming.slice(0, 5).map((a) => <VisitLine key={a.id} a={a} doctor={doc(a.practitioner_id)} />)}</ul>
            )}
          </Card>
          <Card>
            <H>Money</H>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <Row k="Owes"><span className={owed > 0 ? 'font-semibold text-gate' : ''}>{money(owed)}</span></Row>
              <Row k="Paid so far">{money(paidTotal)}</Row>
              <Row k="Visits to bill">{toBill.length}</Row>
            </dl>
            {toBill.length > 0 && <Btn variant="default" className="mt-3" onClick={() => onBillAppt(toBill[0])}>Bill {toBill.length === 1 ? 'the visit' : 'the latest visit'}</Btn>}
          </Card>
        </div>
      )}

      {tab === 'visits' && (
        <Card>
          {visits.length === 0 && unbooked.length === 0 ? <p className="text-sm text-ink-soft">No visits yet.</p> : (
            <ul className="divide-y divide-line" data-testid="record-visits">
              {unbooked.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{when(e.started_at)}</span>
                      <span className="block text-[13px] text-ink-soft">{doc(e.practitioner_id)} · {e.setting === 'ward' ? `Ward round${e.ward ? `, ${e.ward}${e.bed ? ` bed ${e.bed}` : ''}` : ''}` : 'Consultation (walk-in)'}</span>
                    </span>
                    <Pill tone={e.status === 'completed' ? 'default' : 'accent'}>{e.status === 'completed' ? 'Done' : 'In progress'}</Pill>
                  </div>
                </li>
              ))}
              {visits.map((a) => {
                const consult = consults.find((e) => e.practitioner_id === a.practitioner_id && apptStart(a) && e.started_at.slice(0, 10) === apptStart(a)!.toISOString().slice(0, 10));
                return (
                  <li key={a.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{apptStart(a) ? when(apptStart(a)!) : 'No time'}</span>
                        <span className="block text-[13px] text-ink-soft">{doc(a.practitioner_id)} · {VISIT_LABEL[a.visit_type ?? 'consultation']}{a.reason ? ` · ${a.reason}` : ''}</span>
                      </span>
                      <Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>
                    </div>
                    <p className="text-[12px] text-ink-faint">
                      {[a.checked_in_at && `arrived ${timeLabel(new Date(a.checked_in_at))}`, a.called_in_at && `with doctor ${timeLabel(new Date(a.called_in_at))}`,
                        a.completed_at && `out ${timeLabel(new Date(a.completed_at))}`, a.token_no && `token ${a.token_no}`, consult && 'consultation recorded',
                        a.cancel_reason && `cancelled: ${a.cancel_reason}`].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === 'bills' && (
        <Card>
          {theirBills.length === 0 ? <p className="text-sm text-ink-soft">No bills.</p> : (
            <ul className="divide-y divide-line" data-testid="pt-bills">
              {theirBills.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{b.number} · {money(b.total)}</span>
                    <span className="block text-[13px] text-ink-soft">{date(b.created_at)} · {b.items.map((i) => i.description).join(', ')}</span>
                    <span className={`block text-[13px] ${balance(b) > 0 ? 'font-semibold text-gate' : 'text-ink-soft'}`}>{balance(b) > 0 ? `Due ${money(balance(b))}` : b.status === 'void' ? 'Void' : 'Paid'}</span>
                  </span>
                  <Btn variant="default" onClick={() => onReceipt(b)}>Receipt</Btn>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'medicines' && (
        <Card>
          {rx.length === 0 ? <p className="text-sm text-ink-soft">No prescriptions.</p> : (
            <ul className="divide-y divide-line" data-testid="record-medicines">
              {rx.map((p) => {
                const order = orders.find((o) => o.prescription_id === p.id);
                const e = encounters.find((x) => x.id === p.encounter_id);
                return (
                  <li key={p.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{p.approved_at ? date(p.approved_at) : 'Prescription'}{e ? ` · ${doc(e.practitioner_id)}` : ''}</span>
                      {order && <Pill tone={order.status === 'ready' ? 'ok' : order.status === 'exception' ? 'danger' : 'default'}>{ORDER_LABEL[order.status]}</Pill>}
                    </div>
                    <ul className="mt-1 text-[13px] text-ink-soft">
                      {p.items.map((i, k) => <li key={k}>{i.name} · {i.dosage} · {i.frequency} · {i.duration}</li>)}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === 'tests' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <H>Tests</H>
            {loading ? <p className="text-sm text-ink-soft">Loading…</p> : extras.labOrders.length === 0 ? <p className="text-sm text-ink-soft">No tests ordered.</p> : (
              <ul className="divide-y divide-line" data-testid="record-tests">
                {[...extras.labOrders].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at)).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{l.test_name}</span>
                      <span className="block text-[13px] text-ink-soft">{date(l.ordered_at)}{l.ordered_by ? ` · ${doc(l.ordered_by)}` : ''}{l.urgency === 'urgent' ? ' · Urgent' : ''}</span>
                    </span>
                    <Pill tone={l.flagged ? 'danger' : l.status === 'reviewed' ? 'ok' : 'default'}>{l.flagged ? 'Needs doctor' : LAB_LABEL[l.status]}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <H>Documents</H>
            {loading ? <p className="text-sm text-ink-soft">Loading…</p> : extras.documents.length === 0 ? <p className="text-sm text-ink-soft">No documents.</p> : (
              <ul className="divide-y divide-line" data-testid="record-docs">
                {[...extras.documents].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).map((d) => (
                  <li key={d.id} className="py-2">
                    <span className="block text-sm font-semibold text-ink truncate">{d.file_name}</span>
                    <span className="block text-[13px] text-ink-soft">{DOC_LABEL[d.label] ?? 'Document'} · {date(d.uploaded_at)}{d.uploaded_by ? ` · ${d.uploaded_by}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'therapy' && (
        <Card>
          {loading ? <p className="text-sm text-ink-soft">Loading…</p> : extras.plans.length === 0 ? <p className="text-sm text-ink-soft">No therapy course.</p> : (
            <ul className="divide-y divide-line" data-testid="record-therapy">
              {extras.plans.map((p) => {
                const done = extras.sessions.filter((s) => s.plan_id === p.id).sort((a, b) => b.date.localeCompare(a.date));
                return (
                  <li key={p.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{p.condition ?? 'Physiotherapy'} · {doc(p.practitioner_id)}</span>
                      <Pill tone={p.status === 'active' ? 'accent' : 'default'}>{p.status === 'active' ? 'Active' : 'Completed'}</Pill>
                    </div>
                    <p className="text-[13px] text-ink-soft">
                      {done.length}{p.planned_sessions ? ` of ${p.planned_sessions}` : ''} sessions done · started {date(p.start_date)}
                      {done[0] ? ` · last ${date(done[0].date)}` : ''}{p.review_date ? ` · review ${date(p.review_date)}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {editing && <EditDetails patient={patient} onClose={() => setEditing(false)} />}
    </div>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-ink-soft">{children}</h3>;
}
function Row({ k, children }: { k: string; children: ReactNode }) {
  return <><dt className="text-ink-soft">{k}</dt><dd className="text-ink">{children}</dd></>;
}
function Alert({ tone, children }: { tone: 'danger' | 'gate' | 'ok' | 'muted'; children: ReactNode }) {
  const cls = { danger: 'bg-danger-soft text-danger', gate: 'bg-gate-soft text-gate', ok: 'bg-ok-soft text-ok', muted: 'bg-surface-2 text-ink-soft' }[tone];
  return <li className={`rounded-full px-3 py-1 text-[13px] font-semibold ${cls}`}>{children}</li>;
}
function VisitLine({ a, doctor }: { a: AppointmentRow; doctor: string }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="min-w-0"><span className="block text-ink">{when(apptStart(a)!)}</span><span className="block text-[13px] text-ink-soft">{doctor} · {VISIT_LABEL[a.visit_type ?? 'consultation']}</span></span>
      <Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>
    </li>
  );
}

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** The desk corrects contact details and records what the patient reports (allergies, conditions, medicines). */
function EditDetails({ patient, onClose }: { patient: PatientRow; onClose: () => void }) {
  const { pushToast, logAudit } = useClinic();
  const [f, setF] = useState({
    name: patient.name, phone: patient.phone ?? '', age: patient.age != null ? String(patient.age) : '', gender: patient.gender ?? '',
    language: patient.preferred_language, allergies: patient.allergies.join(', '), conditions: patient.conditions.join(', '), medications: patient.medications.join(', '),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!f.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('patients').update({
      name: f.name.trim(), phone: f.phone.trim() || null, age: f.age.trim() ? Number(f.age) : null, gender: f.gender || null,
      preferred_language: f.language, allergies: list(f.allergies), conditions: list(f.conditions), medications: list(f.medications),
    }).eq('id', patient.id);
    setSaving(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not save', detail: error.message }); return; }
    await logAudit('reception-edit-patient', patient.name);
    pushToast({ tone: 'ok', title: 'Details saved', detail: f.name.trim() });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="edit-title" data-testid="edit-patient">
        <h2 id="edit-title" className="text-lg">Edit details · {patient.mrn}</h2>
        <div className="grid grid-cols-2 gap-x-3">
          <div className="col-span-2"><Field label="Full name"><input className={inputCls} value={f.name} onChange={set('name')} data-testid="ed-name" /></Field></div>
          <Field label="Mobile"><input className={inputCls} value={f.phone} onChange={set('phone')} inputMode="tel" data-testid="ed-phone" /></Field>
          <Field label="Age"><input className={inputCls} value={f.age} onChange={set('age')} inputMode="numeric" /></Field>
          <Field label="Sex">
            <select className={inputCls} value={f.gender} onChange={set('gender')}><option value="">Not given</option><option>Female</option><option>Male</option><option>Other</option></select>
          </Field>
          <Field label="Language">
            <select className={inputCls} value={f.language} onChange={set('language')}><option value="en">English</option><option value="hi">Hindi</option></select>
          </Field>
        </div>
        <Field label="Allergies (comma separated)"><input className={inputCls} value={f.allergies} onChange={set('allergies')} data-testid="ed-allergies" placeholder="e.g. Penicillin, Sulfa" /></Field>
        <Field label="Conditions (comma separated)"><input className={inputCls} value={f.conditions} onChange={set('conditions')} placeholder="e.g. Diabetes, Hypertension" /></Field>
        <Field label="Regular medicines (comma separated)"><input className={inputCls} value={f.medications} onChange={set('medications')} /></Field>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="ed-save" disabled={saving || !f.name.trim()} onClick={save}>Save</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

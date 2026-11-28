import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Btn, Card, Field, Modal, Pill, SectionHead, inputCls } from '../ui';
import { LineChart } from '../LineChart';
import { NaadLogo } from '../Brand';
import { VisitTimeline, type TimelineItem } from './VisitTimeline';
import { STAGE_LABEL } from '../../lib/journey';
import { usePatientData, type PatientData } from '../../hooks/usePatientData';
import { supabase } from '../../lib/supabaseClient';
import { newId } from '../../lib/frontDesk';
import { firstFreeSlot, patientFreeSlots } from '../../lib/patientBooking';
import {
  STATUS_LABEL, VISIT_LABEL, apptStart, balance, clinicNow, clinicToday, dayLabel, money, slotLength, timeLabel, type Slot,
} from '../../lib/schedule';
import { vitalFlags } from '../../lib/ward';
import type { AppointmentRow, BillRow, JourneyStage, PatientRow, PhysioPlanRow, PractitionerRow, TherapySessionRow } from '../../types/db';

type Tab = 'home' | 'visits' | 'medicines' | 'bills' | 'reports';
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'visits', label: 'Visits', icon: '📅' },
  { key: 'medicines', label: 'Medicines', icon: '💊' },
  { key: 'bills', label: 'Bills', icon: '₹' },
  { key: 'reports', label: 'Reports', icon: '📄' },
];
const JOURNEY: JourneyStage[] = ['admitted', 'operation', 'physiotherapy', 'progress_review', 'discharged'];
const ORDER_STATUS: Record<string, { label: string; tone: 'default' | 'gate' | 'ok' | 'accent' }> = {
  received: { label: 'Sent to pharmacy', tone: 'default' }, preparing: { label: 'Being prepared', tone: 'accent' },
  ready: { label: 'Ready to collect', tone: 'ok' }, collected: { label: 'Collected', tone: 'default' },
  exception: { label: 'Pharmacy is checking with your doctor', tone: 'gate' },
};
const when = (d: Date) => `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeLabel(d)}`;

/** The signed-in patient's own app: home, visits and booking, medicines,
 * bills and reports. Phone first: a tab bar along the bottom on small screens. */
export function PatientApp({ patient, onSignOut }: { patient: PatientRow; onSignOut: () => void }) {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'home') as Tab;
  const go = (t: Tab) => { setParams(t === 'home' ? {} : { tab: t }); window.scrollTo(0, 0); };
  const { data, loading, error } = usePatientData(patient);
  const [booking, setBooking] = useState(false);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = data.encounters.map((enc) => ({ kind: 'encounter', id: `enc-${enc.id}`, at: enc.started_at, encounter: enc }));
    for (const entry of patient.journey_stage_history ?? []) items.push({ kind: 'journey', id: `journey-${entry.stage}-${entry.enteredAt}`, at: entry.enteredAt, entry });
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [data.encounters, patient]);

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <header className="sticky top-0 z-30 bg-sidebar text-sidebar-ink">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <NaadLogo tone="light" />
          <Btn variant="ghost" className="!text-sidebar-ink border border-white/10" onClick={onSignOut} data-testid="patient-sign-out">Sign out</Btn>
        </div>
        <nav aria-label="Patient app" className="hidden md:block border-t border-white/10">
          <ul className="max-w-3xl mx-auto px-4 flex gap-1">
            {TABS.map((t) => (
              <li key={t.key}>
                <button type="button" data-testid={`pt-tab-${t.key}`} aria-current={tab === t.key ? 'page' : undefined} onClick={() => go(t.key)}
                  className={`min-h-11 px-3 text-sm font-semibold border-b-2 ${tab === t.key ? 'border-accent text-sidebar-ink' : 'border-transparent text-sidebar-faint hover:text-sidebar-ink'}`}>
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main" className="max-w-3xl mx-auto px-4 py-5">
        <div className="mb-5">
          <h1 className="text-2xl">{patient.name}</h1>
          <p className="text-ink-soft text-sm mt-1">{patient.mrn ? `MRN ${patient.mrn}` : 'No MRN on file'}{data.hospital ? ` · ${data.hospital.name}` : ''}</p>
        </div>
        {error && <p className="mb-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</p>}
        {loading && <p className="mb-4 text-sm text-ink-soft">Loading…</p>}

        {tab === 'home' && <Home patient={patient} data={data} timeline={timeline} onBook={() => { go('visits'); setBooking(true); }} onGo={go} />}
        {tab === 'visits' && <Visits patient={patient} data={data} timeline={timeline} booking={booking} setBooking={setBooking} />}
        {tab === 'medicines' && <Medicines data={data} />}
        {tab === 'bills' && <Bills data={data} patient={patient} />}
        {tab === 'reports' && <Reports data={data} />}
      </main>

      <nav aria-label="Patient app" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface-solid border-t border-line" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="grid grid-cols-5">
          {TABS.map((t) => (
            <li key={t.key}>
              <button type="button" data-testid={`pt-tab-${t.key}-m`} aria-current={tab === t.key ? 'page' : undefined} onClick={() => go(t.key)}
                className={`w-full min-h-14 flex flex-col items-center justify-center text-[12px] font-semibold ${tab === t.key ? 'text-accent-ink' : 'text-ink-soft'}`}>
                <span aria-hidden="true" className="text-base leading-none mb-0.5">{t.icon}</span>{t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function upcomingOf(data: PatientData, now: Date): AppointmentRow[] {
  return data.appointments
    .filter((a) => ['requested', 'scheduled', 'checked_in'].includes(a.status) && (apptStart(a)?.getTime() ?? 0) > now.getTime() - 4 * 3600_000)
    .sort((a, b) => (apptStart(a)?.getTime() ?? 0) - (apptStart(b)?.getTime() ?? 0));
}

function ApptLine({ a, doctors }: { a: AppointmentRow; doctors: PractitionerRow[] }) {
  const s = apptStart(a);
  const doc = doctors.find((d) => d.id === a.practitioner_id);
  return (
    <span className="min-w-0">
      <span className="block text-base font-semibold text-ink">{s ? when(s) : 'Time to be confirmed'}</span>
      <span className="block text-sm text-ink-soft">{doc?.name ?? 'Doctor to be assigned'} · {VISIT_LABEL[a.visit_type ?? 'consultation']}</span>
      <span className="block text-sm mt-0.5">
        {a.status === 'requested' && <span className="text-gate">Requested. The front desk will confirm.</span>}
        {a.status === 'scheduled' && <span className="text-ok">Confirmed.</span>}
        {a.status === 'checked_in' && <span className="text-ok font-semibold">You are checked in{a.token_no ? ` · Token ${a.token_no}` : ''}.</span>}
      </span>
    </span>
  );
}

function Home({ patient, data, timeline, onBook, onGo }: { patient: PatientRow; data: PatientData; timeline: TimelineItem[]; onBook: () => void; onGo: (t: Tab) => void }) {
  const now = clinicNow();
  const next = upcomingOf(data, now)[0];
  const ready = data.pharmacyOrders.filter((o) => o.status === 'ready');
  const due = data.bills.reduce((s, b) => s + balance(b), 0);
  const flaggedLab = data.labOrders.filter((l) => l.flagged && l.result_summary);
  const [rebook, setRebook] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; text?: string }>({ state: 'idle' });
  const stageIdx = patient.journey_stage ? JOURNEY.indexOf(patient.journey_stage) : -1;

  async function requestFollowUp() {
    setRebook({ state: 'busy' });
    const lastDoctorId = patient.assigned_practitioner_id ?? data.encounters[0]?.practitioner_id ?? data.doctors[0]?.id;
    const doctor = data.doctors.find((d) => d.id === lastDoctorId) ?? data.doctors[0];
    const slot = doctor ? await firstFreeSlot(doctor, clinicToday(), now) : null;
    const iso = slot ? slot.start.toISOString() : null;
    const { error } = await supabase.from('appointments').insert({
      id: newId('ap'), org_id: patient.org_id, patient_id: patient.id, practitioner_id: doctor?.id ?? null, specialty: doctor?.specialty ?? null,
      date: iso, start_time: iso, duration_minutes: doctor ? slotLength(doctor) : 15, status: 'requested', reason: 'Follow-up requested in the patient app',
      requested_by_patient: true, token_no: null, checked_in_at: null, cancel_reason: null, visit_type: 'follow_up', rescheduled_from: null, booked_by: null,
    });
    if (error) { setRebook({ state: 'error', text: error.message }); return; }
    setRebook({ state: 'done', text: slot ? `Requested for ${when(slot.start)} with ${doctor?.name}. The front desk will confirm.` : 'Requested. The front desk will call you with a time.' });
  }

  return (
    <>
      <Card className="mb-4" data-testid="next-visit">
        <SectionHead eyebrow="Next visit" title={next ? 'Your next appointment' : 'No appointment booked'} />
        {next ? <ApptLine a={next} doctors={data.doctors} /> : <p className="text-ink-soft">Book a visit when you need one.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="glow" data-testid="home-book" onClick={onBook}>Book an appointment</Btn>
          <Btn variant="default" data-testid="rebook-followup" disabled={rebook.state === 'busy' || rebook.state === 'done'} onClick={requestFollowUp}>
            {rebook.state === 'busy' ? 'Requesting…' : rebook.state === 'done' ? 'Requested' : 'Request a follow-up'}
          </Btn>
        </div>
        {rebook.text && <p className={`mt-3 text-sm rounded-lg px-3 py-2 ${rebook.state === 'error' ? 'text-danger bg-danger-soft' : 'text-ok bg-ok-soft'}`} role="status">{rebook.text}</p>}
      </Card>

      {(ready.length > 0 || due > 0 || flaggedLab.length > 0) && (
        <Card className="mb-4" data-testid="home-alerts">
          <ul className="space-y-2">
            {ready.length > 0 && <li><button type="button" className="text-left min-h-11 text-ink" onClick={() => onGo('medicines')}><span className="font-semibold text-ok">Your medicines are ready to collect</span> at the hospital pharmacy.</button></li>}
            {due > 0 && <li><button type="button" className="text-left min-h-11 text-ink" onClick={() => onGo('bills')}><span className="font-semibold text-gate">{money(due)} to pay</span> on your bills.</button></li>}
            {flaggedLab.length > 0 && <li><button type="button" className="text-left min-h-11 text-ink" onClick={() => onGo('reports')}><span className="font-semibold text-danger">Your doctor has noted a test result</span>: {flaggedLab[0].test_name}.</button></li>}
          </ul>
        </Card>
      )}

      <MyTherapy plans={data.plans} sessions={data.sessions} />

      {stageIdx >= 0 && (
        <Card className="mb-4">
          <SectionHead eyebrow="Care journey" title="Where you are" />
          <ol className="flex flex-wrap gap-3">
            {JOURNEY.map((st, i) => <li key={st}><Pill tone={i === stageIdx ? 'accent' : i < stageIdx ? 'ok' : 'default'}>{STAGE_LABEL[st]}</Pill></li>)}
          </ol>
        </Card>
      )}

      <Card>
        <SectionHead eyebrow="History" title="Recent visits" desc="Tap a visit to see what your doctor wrote." />
        {timeline.length === 0 ? <p className="text-ink-soft text-sm">No visits on record yet.</p> : <VisitTimeline timeline={timeline.slice(0, 3)} />}
        {timeline.length > 3 && <Btn variant="default" className="mt-3" onClick={() => onGo('visits')}>See all {timeline.length} entries</Btn>}
      </Card>
    </>
  );
}

function Visits({ patient, data, timeline, booking, setBooking }: { patient: PatientRow; data: PatientData; timeline: TimelineItem[]; booking: boolean; setBooking: (v: boolean) => void }) {
  const now = clinicNow();
  const upcoming = upcomingOf(data, now);
  const [cancelling, setCancelling] = useState<AppointmentRow | null>(null);
  const past = data.appointments.filter((a) => !upcoming.includes(a)).sort((a, b) => (apptStart(b)?.getTime() ?? 0) - (apptStart(a)?.getTime() ?? 0)).slice(0, 10);
  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SectionHead title="Upcoming" />
          {!booking && <Btn variant="glow" data-testid="visits-book" onClick={() => setBooking(true)}>Book an appointment</Btn>}
        </div>
        {booking && <BookForm patient={patient} data={data} onDone={() => setBooking(false)} />}
        {upcoming.length === 0 && !booking && <p className="text-ink-soft">Nothing booked.</p>}
        <ul className="divide-y divide-line">
          {upcoming.map((a) => (
            <li key={a.id} className="py-3 flex flex-wrap items-start justify-between gap-2" data-testid="upcoming-appt">
              <ApptLine a={a} doctors={data.doctors} />
              {(a.status === 'requested' || a.status === 'scheduled') && <Btn variant="danger" data-testid="cancel-mine" onClick={() => setCancelling(a)}>Cancel</Btn>}
            </li>
          ))}
        </ul>
      </Card>
      {past.length > 0 && (
        <Card className="mb-4">
          <SectionHead title="Past appointments" />
          <ul className="divide-y divide-line">
            {past.map((a) => {
              const s = apptStart(a);
              return (
                <li key={a.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <span>{s ? when(s) : 'No time'} · {data.doctors.find((d) => d.id === a.practitioner_id)?.name ?? ''}</span>
                  <Pill tone={a.status === 'completed' ? 'ok' : a.status === 'cancelled' || a.status === 'no_show' ? 'danger' : 'default'}>{STATUS_LABEL[a.status]}</Pill>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card>
        <SectionHead eyebrow="History" title="Your visits and care" desc="Newest first. Tap a visit to see the full note." />
        {timeline.length === 0 ? <p className="text-ink-soft text-sm">No visits on record yet.</p> : <VisitTimeline timeline={timeline} />}
      </Card>
      {cancelling && <CancelModal appt={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function BookForm({ patient, data, onDone }: { patient: PatientRow; data: PatientData; onDone: () => void }) {
  const [docId, setDocId] = useState(patient.assigned_practitioner_id && data.doctors.some((d) => d.id === patient.assigned_practitioner_id) ? patient.assigned_practitioner_id : data.doctors[0]?.id ?? '');
  const [day, setDay] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const doc = data.doctors.find((d) => d.id === docId);

  async function pickDay(d: string, doctor = doc) {
    setDay(d); setTime(''); setSlots(null); setMsg(null);
    if (!d || !doctor) return;
    const r = await patientFreeSlots(doctor, d, clinicNow());
    if (r.error) setMsg(r.error);
    setSlots(r.slots);
  }

  async function save() {
    const slot = slots?.find((s) => String(s.start.getTime()) === time);
    if (!doc || !slot) return;
    setBusy(true);
    const iso = slot.start.toISOString();
    const { error } = await supabase.from('appointments').insert({
      id: newId('ap'), org_id: patient.org_id, patient_id: patient.id, practitioner_id: doc.id, specialty: doc.specialty,
      date: iso, start_time: iso, duration_minutes: slot.minutes, status: 'requested', reason: reason.trim() || null,
      requested_by_patient: true, token_no: null, checked_in_at: null, cancel_reason: null,
      visit_type: doc.role === 'physio' ? 'therapy' : 'consultation', rescheduled_from: null, booked_by: null,
    });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    onDone();
  }

  return (
    <div className="mb-4 rounded-lg border border-line p-3" data-testid="book-form">
      <Field label="Doctor">
        <select className={inputCls} data-testid="pt-book-doctor" value={docId} onChange={(e) => { setDocId(e.target.value); void pickDay(day, data.doctors.find((d) => d.id === e.target.value)); }}>
          {data.doctors.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.specialty ?? d.title})</option>)}
        </select>
      </Field>
      <Field label="Day"><input type="date" className={inputCls} data-testid="pt-book-day" min={clinicToday()} value={day} onChange={(e) => void pickDay(e.target.value)} /></Field>
      {day && slots && (
        slots.length === 0
          ? <p className="text-sm text-ink-soft mb-3" data-testid="pt-book-none">No free time on {dayLabel(day)}. Try another day.</p>
          : (
            <fieldset className="mb-3">
              <legend className="text-[13px] font-semibold text-ink-soft mb-1.5">Free times on {dayLabel(day)}</legend>
              <div className="flex flex-wrap gap-2" data-testid="pt-book-times">
                {slots.map((s) => (
                  <label key={s.start.getTime()} className={`inline-flex items-center min-h-11 rounded-lg border px-3 cursor-pointer text-sm ${time === String(s.start.getTime()) ? 'border-accent bg-accent-soft text-ink font-semibold' : 'border-line text-ink-soft'}`}>
                    <input type="radio" className="sr-only" name="pt-time" value={String(s.start.getTime())} checked={time === String(s.start.getTime())} onChange={(e) => setTime(e.target.value)} />
                    {timeLabel(s.start)}
                  </label>
                ))}
              </div>
            </fieldset>
          )
      )}
      <Field label="What is it about? (optional)"><input className={inputCls} data-testid="pt-book-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Knee still painful on stairs" /></Field>
      {msg && <p className="text-sm text-danger mb-2" role="alert">{msg}</p>}
      <p className="text-[13px] text-ink-soft mb-3">This sends a request. The front desk confirms it, usually within the day.</p>
      <div className="flex gap-2">
        <Btn variant="glow" data-testid="pt-book-save" disabled={busy || !time} onClick={save}>{busy ? 'Sending…' : 'Request this time'}</Btn>
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
      </div>
    </div>
  );
}

function CancelModal({ appt, onClose }: { appt: AppointmentRow; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = apptStart(appt);
  async function confirm() {
    setBusy(true);
    const { error } = await supabase.from('appointments').update({ status: 'cancelled', cancel_reason: 'Cancelled by the patient in the app' }).eq('id', appt.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="pt-cancel-title">
        <h2 id="pt-cancel-title" className="text-lg">Cancel this appointment?</h2>
        <p className="mt-1 mb-4 text-ink-soft">{s ? when(s) : ''}. The time is given to someone else.</p>
        {err && <p className="text-sm text-danger mb-2" role="alert">{err}</p>}
        <div className="flex gap-2">
          <Btn variant="danger" data-testid="cancel-mine-confirm" disabled={busy} onClick={confirm}>Yes, cancel it</Btn>
          <Btn variant="ghost" onClick={onClose}>Keep it</Btn>
        </div>
      </div>
    </Modal>
  );
}

function Medicines({ data }: { data: PatientData }) {
  const rx = data.prescriptions.filter((p) => p.status !== 'draft' && (p.items ?? []).length > 0)
    .sort((a, b) => (b.approved_at ?? '').localeCompare(a.approved_at ?? ''));
  return (
    <Card>
      <SectionHead title="Your medicines" desc="What your doctor prescribed, how to take it, and where it is at the pharmacy." />
      {rx.length === 0 && <p className="text-ink-soft">No prescriptions yet.</p>}
      <ul className="space-y-4">
        {rx.map((p) => {
          const order = data.pharmacyOrders.find((o) => o.prescription_id === p.id);
          const st = order ? ORDER_STATUS[order.status] ?? { label: order.status, tone: 'default' as const } : null;
          return (
            <li key={p.id} className="rounded-lg border border-line p-3" data-testid="rx-card">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="text-sm text-ink-soft">{p.approved_at ? `Prescribed ${new Date(p.approved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Prescribed'}{p.approved_by ? ` by ${p.approved_by}` : ''}</span>
                {st && <Pill tone={st.tone}>{st.label}</Pill>}
              </div>
              <ul className="divide-y divide-line">
                {p.items.map((it, i) => (
                  <li key={i} className="py-2">
                    <div className="font-semibold text-ink">{it.name}</div>
                    <div className="text-sm text-ink-soft">{[it.dosage, it.frequency, it.duration].filter(Boolean).join(' · ')}{it.foodInstruction ? ` · ${it.foodInstruction}` : ''}</div>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Bills({ data, patient }: { data: PatientData; patient: PatientRow }) {
  const [open, setOpen] = useState<BillRow | null>(null);
  const bills = [...data.bills].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const due = bills.reduce((s, b) => s + balance(b), 0);
  return (
    <>
      <Card>
        <SectionHead title="Your bills" desc={due > 0 ? `${money(due)} still to pay. You can pay at the front desk or the pharmacy.` : 'Everything is paid.'} />
        {bills.length === 0 && <p className="text-ink-soft">No bills yet.</p>}
        <ul className="divide-y divide-line">
          {bills.map((b) => (
            <li key={b.id} className="py-3 flex flex-wrap items-center justify-between gap-2" data-testid="pt-bill">
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{b.number} · {money(b.total)}</span>
                <span className="block text-sm text-ink-soft">{new Date(b.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {b.source === 'pharmacy' ? 'Pharmacy' : 'Hospital'}{b.status === 'void' ? ' · Cancelled' : balance(b) > 0 ? ` · ${money(balance(b))} to pay` : ' · Paid'}</span>
              </span>
              <Btn variant="default" data-testid="pt-bill-open" onClick={() => setOpen(b)}>View</Btn>
            </li>
          ))}
        </ul>
      </Card>
      {open && (
        <Modal onClose={() => setOpen(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="pt-bill-title" data-testid="pt-receipt">
            <div className="print-receipt">
              <div className="text-center border-b border-line pb-3 mb-3">
                <div className="text-lg font-semibold text-ink">{data.hospital?.name ?? 'Hospital'}</div>
                <div className="text-[13px] text-ink-soft">{data.hospital?.address ?? ''}{data.hospital?.contact_phone ? ` · ${data.hospital.contact_phone}` : ''}</div>
                <h2 id="pt-bill-title" className="mt-2 text-base">{open.number}</h2>
              </div>
              <p className="text-sm text-ink-soft mb-2">{patient.name}{patient.mrn ? ` (${patient.mrn})` : ''} · {new Date(open.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              <ul className="divide-y divide-line text-sm">
                {open.items.map((it, i) => <li key={i} className="py-1.5 flex justify-between gap-2"><span>{it.qty} × {it.description.replace(/ \(batch.*\)$/, '')}</span><span>{money(it.qty * it.rate)}</span></li>)}
              </ul>
              <div className="mt-2 text-sm space-y-0.5">
                {open.discount > 0 && <div className="flex justify-between"><span className="text-ink-soft">Discount</span><span>− {money(open.discount)}</span></div>}
                <div className="flex justify-between font-semibold"><span>Total</span><span>{money(open.total)}</span></div>
                <div className="flex justify-between"><span className="text-ink-soft">Paid</span><span>{money(open.paid)}</span></div>
                {balance(open) > 0 && <div className="flex justify-between font-semibold text-gate"><span>To pay</span><span>{money(balance(open))}</span></div>}
              </div>
            </div>
            <div className="no-print mt-4 flex gap-2">
              <Btn variant="glow" onClick={() => window.print()}>Print or save as PDF</Btn>
              <Btn variant="ghost" onClick={() => setOpen(null)}>Close</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Reports({ data }: { data: PatientData }) {
  const labs = [...data.labOrders].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at));
  const docs = [...data.documents].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  const vitals = [...data.vitals].sort((a, b) => b.taken_at.localeCompare(a.taken_at));
  const latest = vitals[0];
  const d = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <>
      <Card className="mb-4">
        <SectionHead title="Test results" desc="Results appear once your doctor has looked at them." />
        {labs.length === 0 && <p className="text-ink-soft">No tests yet.</p>}
        <ul className="divide-y divide-line">
          {labs.map((l) => (
            <li key={l.id} className="py-3" data-testid="pt-lab">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink">{l.test_name}</span>
                {l.result_summary ? <Pill tone={l.flagged ? 'danger' : 'ok'}>{l.flagged ? 'Doctor noted' : 'Normal'}</Pill> : <Pill tone="gate">Awaiting result</Pill>}
              </div>
              <div className="text-sm text-ink-soft">Ordered {d(l.ordered_at)}{l.ordered_by ? ` by ${l.ordered_by}` : ''}</div>
              {l.result_summary && <p className="text-sm text-ink mt-1">{l.result_summary}</p>}
            </li>
          ))}
        </ul>
      </Card>
      {latest && (
        <Card className="mb-4" data-testid="pt-vitals">
          <SectionHead title="Your vital signs" desc={`Last taken ${new Date(latest.taken_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`} />
          <p className="text-ink">BP {latest.bp_systolic ?? '–'}/{latest.bp_diastolic ?? '–'} · pulse {latest.pulse ?? '–'} · temperature {latest.temp_c ?? '–'}°C · oxygen {latest.spo2 ?? '–'}%</p>
          {vitalFlags(latest).length > 0 && <p className="text-sm text-ink-soft mt-1">Your care team is watching: {vitalFlags(latest).map((f) => f.label.toLowerCase()).join(', ')}.</p>}
        </Card>
      )}
      <Card>
        <SectionHead title="Documents" desc="Reports and scans the hospital holds for you. Ask the front desk for a printed copy." />
        {docs.length === 0 && <p className="text-ink-soft">No documents yet.</p>}
        <ul className="divide-y divide-line">
          {docs.map((doc) => (
            <li key={doc.id} className="py-2 flex items-center justify-between gap-2 text-sm" data-testid="pt-doc">
              <span className="text-ink">{doc.file_name.replace(/_/g, ' ').replace(/\.pdf$/i, '')}</span>
              <span className="text-ink-soft whitespace-nowrap">{d(doc.uploaded_at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** The patient's active physiotherapy: home exercises and pain over sessions. */
function MyTherapy({ plans, sessions }: { plans: PhysioPlanRow[]; sessions: TherapySessionRow[] }) {
  const plan = plans.find((p) => p.status === 'active');
  if (!plan) return null;
  const own = sessions.filter((s) => s.plan_id === plan.id && s.pain_score != null);
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <>
      <Card className="mb-4" data-testid="my-exercises">
        <SectionHead eyebrow="Physiotherapy" title="Your home exercises" desc={`For: ${plan.condition ?? 'your therapy plan'}. Do these on the days shown; stop and tell your physio if anything causes sharp pain.`} />
        <ul className="flex flex-col divide-y divide-line">
          {(plan.home_programme ?? []).map((h, i) => (
            <li key={`${h.name}-${i}`} className="py-3">
              <div className="font-semibold text-[16px]">{h.name}</div>
              <div className="text-ink-soft">{h.sets ? `${h.sets} sets of ` : ''}{h.reps}{h.timesPerWeek ? ` · ${h.timesPerWeek} days a week` : ''}</div>
              {h.notes && <div className="text-sm mt-0.5">{h.notes}</div>}
            </li>
          ))}
          {(plan.home_programme ?? []).length === 0 && <li className="py-2 text-ink-soft">Your physio hasn't added home exercises yet.</li>}
        </ul>
      </Card>
      {own.length > 0 && (
        <Card className="mb-4" data-testid="my-progress">
          <SectionHead eyebrow="Physiotherapy" title="Your progress" desc={`Pain score after each session (0 = no pain, 10 = worst). ${own.length} session${own.length === 1 ? '' : 's'} so far.`} />
          <LineChart points={own.map((s, i) => ({ label: `S${i + 1} · ${day(s.date)}`, value: s.pain_score as number }))} yMax={10} title="Your pain score by session" />
        </Card>
      )}
    </>
  );
}


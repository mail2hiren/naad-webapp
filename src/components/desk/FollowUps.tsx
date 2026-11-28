import { useMemo, useState } from 'react';
import { Btn, Card, Field, Modal, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { useContacts, useFollowUps } from '../../hooks/useDesk';
import { useWaitlist } from '../../hooks/useCalendarData';
import { PatientPicker } from '../reception/PatientPicker';
import { addDays, apptStart, clinicNow, clinicToday, onDay, timeLabel } from '../../lib/schedule';
import { groupFollowUps, lapsedPatients } from '../../lib/desk';
import { reminderText } from '../../lib/calendar';
import { addFollowUp, logContact, setFollowUp } from '../../lib/deskActions';
import type { AppointmentRow, PatientRow } from '../../types/db';
import type { ContactOutcome, FollowUpRow } from '../../types/desk';
import { CallOutcome, Empty, PageTabs, Row, Stat } from './common';
import { OUTCOME_LABEL, fmtDay } from './labels';

type Tab = 'due' | 'reminders' | 'lapsed' | 'waitlist' | 'log';

/**
 * Follow-ups and calls: patients due back (set by the doctor or the desk),
 * tomorrow's reminder calls, patients who have drifted away, the waitlist,
 * and a log of every call with its outcome.
 */
export function FollowUpsSection({ onBook, orgName }: { onBook: (p: PatientRow, doctorId: string | null, after: (a: AppointmentRow | null) => void) => void; orgName: string }) {
  const { orgId, patients, appointments, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const followUps = useFollowUps(orgId);
  const contacts = useContacts(orgId);
  const { waitlist } = useWaitlist(orgId);
  const [tab, setTab] = useState<Tab>('due');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = clinicToday();
  const now = clinicNow();
  const pt = (id: string | null) => patients.find((p) => p.id === id);
  const doc = (id: string | null) => clinicians.find((c) => c.id === id)?.name ?? 'Any doctor';
  const groups = groupFollowUps(followUps, today);
  const lapsed = useMemo(() => lapsedPatients(appointments, followUps, now, 60), [appointments, followUps, now]);
  const tomorrow = addDays(today, 1);
  const reminders = appointments.filter((a) => onDay(a, tomorrow) && (a.status === 'scheduled' || a.status === 'requested'))
    .sort((a, b) => apptStart(a)!.getTime() - apptStart(b)!.getTime());
  const lastContact = (key: { patientId?: string; followUpId?: string }) => contacts
    .filter((c) => (key.followUpId ? c.follow_up_id === key.followUpId : c.patient_id === key.patientId))
    .sort((a, b) => b.contacted_at.localeCompare(a.contacted_at))[0];
  const remindedToday = (pid: string) => contacts.some((c) => c.patient_id === pid && c.purpose === 'reminder' && c.contacted_at.slice(0, 10) === new Date(now).toISOString().slice(0, 10));

  async function record(patientId: string, purpose: 'recall' | 'reminder', outcome: ContactOutcome, note: string, f?: FollowUpRow) {
    setBusy(true);
    const e = await logContact(orgId, { patientId, followUpId: f?.id ?? null, channel: 'call', purpose, outcome, note, by: me?.name ?? null, at: clinicNow() });
    if (!e && f && outcome === 'declined') await setFollowUp(f, 'declined');
    setBusy(false);
    if (e) { pushToast({ tone: 'critical', title: 'Could not save the call', detail: e }); return; }
    await logAudit(`reception-call-${purpose}`, `${pt(patientId)?.name ?? ''}: ${OUTCOME_LABEL[outcome]}`);
    pushToast({ tone: 'ok', title: `Call saved: ${OUTCOME_LABEL[outcome]}`, detail: pt(patientId)?.name ?? '' });
    setOpen(null);
  }

  function book(p: PatientRow | undefined, doctorId: string | null, f?: FollowUpRow) {
    if (!p) return;
    onBook(p, doctorId, async (a) => {
      if (f && a) { await setFollowUp(f, 'booked', a.id); await logContact(orgId, { patientId: p.id, followUpId: f.id, channel: 'call', purpose: 'recall', outcome: 'booked', note: '', by: me?.name ?? null, at: clinicNow() }); }
    });
  }

  const dueRow = (f: FollowUpRow, tone?: 'danger' | 'gate') => {
    const p = pt(f.patient_id);
    const last = lastContact({ followUpId: f.id });
    return (
      <Row key={f.id} testid="fu-row" tone={tone} title={`${p?.name ?? 'Patient'} · due ${fmtDay(f.due_on)}`}
        meta={<>{doc(f.practitioner_id)}{f.reason ? ` · ${f.reason}` : ''}{p?.phone ? ` · ${p.phone}` : ''}{last ? ` · last call: ${OUTCOME_LABEL[last.outcome]} ${new Date(last.contacted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</>}>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Btn variant="glow" data-testid="fu-book" onClick={() => book(p, f.practitioner_id, f)}>Book</Btn>
          {p?.phone && <a className="inline-flex items-center min-h-11 rounded-lg px-3 text-sm font-semibold text-accent-ink hover:bg-hover" href={`tel:${p.phone.replace(/\s/g, '')}`}>Call</a>}
          <Btn variant="default" data-testid="fu-log" onClick={() => setOpen(open === f.id ? null : f.id)}>Log call</Btn>
          <Btn variant="ghost" onClick={async () => { await setFollowUp(f, 'open', null, addDays(f.due_on < today ? today : f.due_on, 7)); pushToast({ tone: 'ok', title: 'Moved a week later', detail: p?.name ?? '' }); }}>+1 week</Btn>
          <Btn variant="ghost" data-testid="fu-done" onClick={async () => { await setFollowUp(f, 'done'); pushToast({ tone: 'ok', title: 'Follow-up closed', detail: p?.name ?? '' }); }}>Close</Btn>
        </div>
        {open === f.id && <CallOutcome busy={busy} outcomes={['no_answer', 'call_later', 'declined', 'wrong_number', 'other']} onSave={(o, n) => record(f.patient_id, 'recall', o, n, f)} />}
      </Row>
    );
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'due', label: `Due (${groups.overdue.length + groups.today.length + groups.week.length})` },
    { id: 'reminders', label: `Tomorrow's reminders (${reminders.length})` },
    { id: 'lapsed', label: `Not seen lately (${lapsed.length})` },
    { id: 'waitlist', label: `Waitlist (${waitlist.filter((w) => w.status === 'waiting').length})` },
    { id: 'log', label: 'Call log' },
  ];

  return (
    <div data-testid="follow-ups">
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Overdue" value={groups.overdue.length} tone={groups.overdue.length ? 'danger' : undefined} />
        <Stat label="Due today" value={groups.today.length} tone={groups.today.length ? 'gate' : undefined} />
        <Stat label="Reminders for tomorrow" value={`${reminders.filter((a) => remindedToday(a.patient_id)).length}/${reminders.length}`} />
        <Stat label="Calls today" value={contacts.filter((c) => c.contacted_at.slice(0, 10) === new Date(now).toISOString().slice(0, 10)).length} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageTabs tabs={tabs} value={tab} onChange={setTab} />
        <Btn variant="glow" data-testid="fu-add" onClick={() => setAdding(true)}>+ Add follow-up</Btn>
      </div>

      {tab === 'due' && (
        <Card>
          {(['overdue', 'today', 'week', 'later'] as const).map((g) => groups[g].length > 0 && (
            <section key={g} className="mb-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-ink-soft">{{ overdue: 'Overdue', today: 'Due today', week: 'This week', later: 'Later' }[g]}</h3>
              <ul className="divide-y divide-line">{groups[g].map((f) => dueRow(f, g === 'overdue' ? 'danger' : g === 'today' ? 'gate' : undefined))}</ul>
            </section>
          ))}
          {groups.overdue.length + groups.today.length + groups.week.length + groups.later.length === 0 && <ul><Empty>No follow-ups open. Doctors add them when they ask a patient to come back; you can add one too.</Empty></ul>}
        </Card>
      )}

      {tab === 'reminders' && (
        <Card>
          <p className="mb-2 text-[13px] text-ink-soft">Call or message each patient booked for {fmtDay(tomorrow)}. Copy the message for SMS or WhatsApp; automatic sending needs a paid messaging account (not set up).</p>
          <ul className="divide-y divide-line">
            {reminders.length === 0 && <Empty>Nobody is booked for tomorrow.</Empty>}
            {reminders.map((a) => {
              const p = pt(a.patient_id);
              const done = remindedToday(a.patient_id);
              return (
                <Row key={a.id} testid="reminder-row" tone={done ? 'ok' : undefined} title={`${timeLabel(apptStart(a)!)} · ${p?.name ?? 'Patient'}${done ? ' · reminded' : ''}`} meta={`${doc(a.practitioner_id)}${p?.phone ? ` · ${p.phone}` : ' · no mobile'}`}>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Btn variant="default" onClick={async () => {
                      const text = reminderText(p?.name ?? '', doc(a.practitioner_id), apptStart(a)!, orgName);
                      try { await navigator.clipboard.writeText(text); pushToast({ tone: 'ok', title: 'Message copied', detail: 'Paste it into SMS or WhatsApp.' }); } catch { pushToast({ tone: 'warning', title: 'Copy this message', detail: text }); }
                    }}>Copy message</Btn>
                    <Btn variant="default" data-testid="reminder-log" onClick={() => setOpen(open === a.id ? null : a.id)}>Log reminder</Btn>
                  </div>
                  {open === a.id && <CallOutcome busy={busy} outcomes={['informed', 'no_answer', 'call_later', 'declined', 'wrong_number']} onSave={(o, n) => record(a.patient_id, 'reminder', o, n)} />}
                </Row>
              );
            })}
          </ul>
        </Card>
      )}

      {tab === 'lapsed' && (
        <Card>
          <p className="mb-2 text-[13px] text-ink-soft">Patients last seen 2 to 12 months ago with nothing booked. A call often brings them back.</p>
          <ul className="divide-y divide-line">
            {lapsed.length === 0 && <Empty>Nobody has drifted away.</Empty>}
            {lapsed.map(({ patientId, last, days }) => {
              const p = pt(patientId);
              const lc = lastContact({ patientId });
              return (
                <Row key={patientId} testid="lapsed-row" title={`${p?.name ?? 'Patient'} · last seen ${Math.round(days / 30)} months ago`}
                  meta={`${doc(last.practitioner_id)}${last.reason ? ` · ${last.reason}` : ''}${p?.phone ? ` · ${p.phone}` : ''}${lc ? ` · last call: ${OUTCOME_LABEL[lc.outcome]}` : ''}`}>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Btn variant="glow" onClick={() => book(p, last.practitioner_id)}>Book</Btn>
                    <Btn variant="default" onClick={() => setOpen(open === patientId ? null : patientId)}>Log call</Btn>
                  </div>
                  {open === patientId && <CallOutcome busy={busy} outcomes={['no_answer', 'call_later', 'declined', 'wrong_number', 'other']} onSave={(o, n) => record(patientId, 'recall', o, n)} />}
                </Row>
              );
            })}
          </ul>
        </Card>
      )}

      {tab === 'waitlist' && (
        <Card>
          <ul className="divide-y divide-line">
            {waitlist.filter((w) => w.status === 'waiting').length === 0 && <Empty>Nobody is on the waitlist. Add patients from the calendar's booking window.</Empty>}
            {waitlist.filter((w) => w.status === 'waiting').map((w) => {
              const p = pt(w.patient_id);
              return (
                <Row key={w.id} title={p?.name ?? 'Patient'} meta={`${doc(w.practitioner_id)} · ${fmtDay(w.from_day)} to ${fmtDay(w.to_day)}${w.note ? ` · ${w.note}` : ''}`}>
                  <div className="mt-1.5"><Btn variant="glow" onClick={() => book(p, w.practitioner_id)}>Book</Btn></div>
                </Row>
              );
            })}
          </ul>
        </Card>
      )}

      {tab === 'log' && (
        <Card>
          <ul className="divide-y divide-line" data-testid="call-log">
            {contacts.length === 0 && <Empty>No calls logged yet.</Empty>}
            {[...contacts].sort((a, b) => b.contacted_at.localeCompare(a.contacted_at)).slice(0, 100).map((c) => (
              <Row key={c.id} title={`${pt(c.patient_id)?.name ?? 'Enquiry'} · ${OUTCOME_LABEL[c.outcome]}`}
                meta={`${new Date(c.contacted_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${c.purpose} · ${c.channel}${c.contacted_by ? ` · ${c.contacted_by}` : ''}${c.note ? ` · ${c.note}` : ''}`} />
            ))}
          </ul>
        </Card>
      )}

      {adding && <AddFollowUp onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddFollowUp({ onClose }: { onClose: () => void }) {
  const { orgId, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [docId, setDocId] = useState(clinicians[0]?.id ?? '');
  const [due, setDue] = useState(addDays(clinicToday(), 14));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!patient) return;
    setSaving(true);
    const e = await addFollowUp(orgId, { patientId: patient.id, practitionerId: docId || null, dueOn: due, reason, by: me?.name ?? null });
    setSaving(false);
    if (e) { pushToast({ tone: 'critical', title: 'Could not add', detail: e }); return; }
    await logAudit('reception-add-follow-up', `${patient.name}, due ${due}`);
    pushToast({ tone: 'ok', title: 'Follow-up added', detail: `${patient.name} · ${fmtDay(due)}` });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="fu-title" data-testid="fu-form">
        <h2 id="fu-title" className="text-lg mb-3">Add a follow-up</h2>
        <PatientPicker value={patient} onChange={setPatient} />
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Doctor">
            <select className={inputCls} value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">Any doctor</option>
              {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Due on"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} data-testid="fu-due" /></Field>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {[7, 14, 30, 90].map((d) => <button key={d} type="button" onClick={() => setDue(addDays(clinicToday(), d))} className="min-h-9 rounded-full border border-line-strong px-3 text-[13px] font-semibold text-ink-soft hover:bg-hover">{d === 7 ? '1 week' : d === 14 ? '2 weeks' : d === 30 ? '1 month' : '3 months'}</button>)}
        </div>
        <Field label="Reason"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Review X-ray, suture removal" data-testid="fu-reason" /></Field>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="fu-save" disabled={saving || !patient} onClick={save}>Add follow-up</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

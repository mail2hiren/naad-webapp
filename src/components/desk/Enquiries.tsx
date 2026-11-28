import { useState } from 'react';
import { Btn, Card, Field, Modal, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { useClinicians } from '../../hooks/useClinicians';
import { useContacts, useEnquiries } from '../../hooks/useDesk';
import { addDays, clinicNow, clinicToday } from '../../lib/schedule';
import { registerPatient, searchPatients } from '../../lib/frontDesk';
import { addEnquiry, logContact, updateEnquiry } from '../../lib/deskActions';
import type { PatientRow } from '../../types/db';
import type { EnquiryRow, EnquirySource } from '../../types/desk';
import { CallOutcome, Empty, PageTabs, Row, Stat } from './common';
import { OUTCOME_LABEL, fmtDay } from './labels';

const SOURCE: Record<EnquirySource, string> = { phone: 'Phone call', walk_in: 'Walked in', website: 'Website', referral: 'Referred', other: 'Other' };

/**
 * Enquiries: people who called or walked in to ask (fees, timings, a
 * doctor, a surgery). The desk notes them, calls back on the day promised,
 * and turns them into patients with a booking.
 */
export function EnquiriesSection({ onBook }: { onBook: (p: PatientRow, doctorId: string | null, after: () => void) => void }) {
  const { orgId, patients, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const enquiries = useEnquiries(orgId);
  const contacts = useContacts(orgId);
  const [tab, setTab] = useState<'open' | 'booked' | 'closed'>('open');
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = clinicToday();
  const list = enquiries.filter((e) => e.status === tab).sort((a, b) => (a.next_follow_up_on ?? '9').localeCompare(b.next_follow_up_on ?? '9') || b.created_at.localeCompare(a.created_at));
  const due = enquiries.filter((e) => e.status === 'open' && e.next_follow_up_on && e.next_follow_up_on <= today);
  const month = today.slice(0, 7);
  const thisMonth = enquiries.filter((e) => e.created_at.slice(0, 7) === month);
  const converted = thisMonth.filter((e) => e.status === 'booked').length;

  async function book(e: EnquiryRow) {
    // Use the existing patient with this mobile, or register the caller.
    let p = e.patient_id ? patients.find((x) => x.id === e.patient_id) ?? null : null;
    if (!p && e.phone) p = searchPatients(patients, e.phone)[0] ?? null;
    if (!p) {
      const r = await registerPatient(orgId, patients, { name: e.name, phone: e.phone ?? '', age: '', gender: '' });
      if (r.error || !r.patient) { pushToast({ tone: 'critical', title: 'Could not register', detail: r.error ?? '' }); return; }
      p = r.patient;
    }
    const patient = p;
    onBook(patient, e.practitioner_id, async () => {
      await updateEnquiry(e, { status: 'booked', patient_id: patient.id });
      await logContact(orgId, { enquiryId: e.id, patientId: patient.id, channel: 'call', purpose: 'enquiry', outcome: 'booked', note: '', by: me?.name ?? null, at: clinicNow() });
    });
  }

  return (
    <div data-testid="enquiries">
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Open" value={enquiries.filter((e) => e.status === 'open').length} />
        <Stat label="Call back today" value={due.length} tone={due.length ? 'gate' : undefined} />
        <Stat label="This month" value={thisMonth.length} />
        <Stat label="Became patients" value={thisMonth.length ? `${Math.round((converted / thisMonth.length) * 100)}%` : '–'} tone="ok" />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageTabs tabs={[{ id: 'open', label: `Open (${enquiries.filter((e) => e.status === 'open').length})` }, { id: 'booked', label: 'Booked' }, { id: 'closed', label: 'Closed' }]} value={tab} onChange={setTab} />
        <Btn variant="glow" data-testid="enq-new" onClick={() => setAdding(true)}>+ New enquiry</Btn>
      </div>
      <Card>
        <ul className="divide-y divide-line" data-testid="enq-list">
          {list.length === 0 && <Empty>{tab === 'open' ? 'No open enquiries. Note every caller who asks about fees, timings or a doctor.' : 'None.'}</Empty>}
          {list.map((e) => {
            const last = contacts.filter((c) => c.enquiry_id === e.id).sort((a, b) => b.contacted_at.localeCompare(a.contacted_at))[0];
            const late = e.status === 'open' && e.next_follow_up_on && e.next_follow_up_on <= today;
            return (
              <Row key={e.id} testid="enq-row" tone={late ? 'gate' : undefined} title={`${e.name}${e.phone ? ` · ${e.phone}` : ''}`}
                meta={<>
                  {SOURCE[e.source]} · {new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{e.interest ? ` · ${e.interest}` : ''}{e.practitioner_id ? ` · ${clinicians.find((c) => c.id === e.practitioner_id)?.name}` : ''}
                  {e.next_follow_up_on && e.status === 'open' ? <span className={`block ${late ? 'font-semibold text-gate' : ''}`}>Call back {fmtDay(e.next_follow_up_on)}</span> : null}
                  {last ? <span className="block">Last call: {OUTCOME_LABEL[last.outcome]}{last.note ? ` · ${last.note}` : ''}</span> : null}
                  {e.note ? <span className="block">{e.note}</span> : null}
                </>}>
                {e.status === 'open' && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Btn variant="glow" data-testid="enq-book" onClick={() => book(e)}>Book appointment</Btn>
                    {e.phone && <a className="inline-flex items-center min-h-11 rounded-lg px-3 text-sm font-semibold text-accent-ink hover:bg-hover" href={`tel:${e.phone.replace(/\s/g, '')}`}>Call</a>}
                    <Btn variant="default" data-testid="enq-log" onClick={() => setLogging(logging === e.id ? null : e.id)}>Log call</Btn>
                    <Btn variant="ghost" data-testid="enq-close" onClick={async () => { await updateEnquiry(e, { status: 'closed' }); pushToast({ tone: 'ok', title: 'Enquiry closed', detail: e.name }); }}>Close</Btn>
                  </div>
                )}
                {logging === e.id && (
                  <CallOutcome busy={busy} outcomes={['no_answer', 'call_later', 'declined', 'wrong_number', 'informed']} onSave={async (o, n) => {
                    setBusy(true);
                    const err = await logContact(orgId, { enquiryId: e.id, channel: 'call', purpose: 'enquiry', outcome: o, note: n, by: me?.name ?? null, at: clinicNow() });
                    if (!err) await updateEnquiry(e, o === 'declined' || o === 'wrong_number' ? { status: 'closed' } : { next_follow_up_on: addDays(today, o === 'no_answer' ? 1 : 3) });
                    setBusy(false);
                    if (err) { pushToast({ tone: 'critical', title: 'Could not save', detail: err }); return; }
                    await logAudit('reception-enquiry-call', `${e.name}: ${OUTCOME_LABEL[o]}`);
                    pushToast({ tone: 'ok', title: `Call saved: ${OUTCOME_LABEL[o]}`, detail: e.name });
                    setLogging(null);
                  }} />
                )}
              </Row>
            );
          })}
        </ul>
      </Card>
      {adding && <NewEnquiry onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewEnquiry({ onClose }: { onClose: () => void }) {
  const { orgId, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const clinicians = useClinicians();
  const [f, setF] = useState({ name: '', phone: '', source: 'phone' as EnquirySource, interest: '', doctor: '', next: addDays(clinicToday(), 1), note: '' });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const e = await addEnquiry(orgId, { name: f.name, phone: f.phone, source: f.source, interest: f.interest, practitionerId: f.doctor || null, nextOn: f.next || null, note: f.note, by: me?.name ?? null });
    setSaving(false);
    if (e) { pushToast({ tone: 'critical', title: 'Could not save', detail: e }); return; }
    await logAudit('reception-enquiry-new', `${f.name}: ${f.interest}`);
    pushToast({ tone: 'ok', title: 'Enquiry noted', detail: f.name });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="enq-title" data-testid="enq-form">
        <h2 id="enq-title" className="text-lg mb-3">New enquiry</h2>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="enq-name" /></Field>
          <Field label="Mobile"><input className={inputCls} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="enq-phone" /></Field>
          <Field label="How they reached us">
            <select className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as EnquirySource })}>
              {(Object.keys(SOURCE) as EnquirySource[]).map((s) => <option key={s} value={s}>{SOURCE[s]}</option>)}
            </select>
          </Field>
          <Field label="Doctor asked for">
            <select className={inputCls} value={f.doctor} onChange={(e) => setF({ ...f, doctor: e.target.value })}>
              <option value="">Any</option>
              {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="What they asked about"><input className={inputCls} value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} placeholder="e.g. Knee replacement cost, physio timings" data-testid="enq-interest" /></Field>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Call back on"><input type="date" className={inputCls} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
          <Field label="Note"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="enq-save" disabled={saving || !f.name.trim()} onClick={save}>Save enquiry</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

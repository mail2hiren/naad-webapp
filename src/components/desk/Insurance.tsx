import { useState } from 'react';
import { Btn, Card, Field, Modal, Pill, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { useAdmissions, useClaims } from '../../hooks/useDesk';
import { PatientPicker } from '../reception/PatientPicker';
import { clinicNow, money } from '../../lib/schedule';
import { CLAIM_LABEL, claimAgeDays, claimNextStep } from '../../lib/desk';
import { createClaim, saveInsurance, updateClaim } from '../../lib/deskActions';
import type { PatientRow } from '../../types/db';
import type { ClaimStatus, InsuranceClaimRow } from '../../types/desk';
import { Empty, PageTabs, Row, Stat } from './common';

const DOCS = ['Policy card copy', 'Photo ID (Aadhaar/PAN)', 'Doctor\'s admission note', 'Investigation reports', 'Estimate of cost', 'Discharge summary', 'Final bill', 'Pharmacy bills'];
const OPEN: ClaimStatus[] = ['draft', 'submitted', 'query', 'approved', 'partly_approved'];

type PatientIns = PatientRow & { insurer?: string | null; insurance_policy_no?: string | null; insurance_tpa?: string | null; insurance_valid_till?: string | null };

/**
 * Insurance and TPA desk: every pre-authorisation and claim with its stage,
 * the next thing to do, documents still missing and how long it has sat;
 * insured patients on the ward with no claim yet.
 */
export function InsuranceSection({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const { orgId, patients } = useClinic();
  const claims = useClaims(orgId);
  const admissions = useAdmissions(orgId);
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [editing, setEditing] = useState<InsuranceClaimRow | null>(null);
  const [creating, setCreating] = useState<{ patientId?: string; admissionId?: string } | null>(null);
  const now = clinicNow();
  const pt = (id: string) => patients.find((p) => p.id === id) as PatientIns | undefined;
  const open = claims.filter((c) => OPEN.includes(c.status)).sort((a, b) => claimAgeDays(b, now) - claimAgeDays(a, now));
  const closed = claims.filter((c) => !OPEN.includes(c.status)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const noClaim = admissions.filter((a) => a.status === 'admitted' && a.payer === 'insurance' && !claims.some((c) => c.admission_id === a.id));
  const pending = open.reduce((s, c) => s + (c.amount_approved ?? c.amount_requested), 0);

  const claimRow = (c: InsuranceClaimRow) => {
    const age = claimAgeDays(c, now);
    const slow = (c.status === 'submitted' || c.status === 'query') && age >= 2;
    return (
      <Row key={c.id} testid="claim-row" tone={c.status === 'query' || c.status === 'rejected' ? 'danger' : slow ? 'gate' : undefined}
        title={<>{pt(c.patient_id)?.name ?? 'Patient'} · {c.insurer}{c.tpa ? ` via ${c.tpa}` : ''} <Pill tone={c.status === 'approved' || c.status === 'settled' ? 'ok' : c.status === 'query' || c.status === 'rejected' ? 'danger' : 'gate'}>{CLAIM_LABEL[c.status]}</Pill></>}
        meta={<>
          {c.kind === 'preauth' ? 'Pre-authorisation' : c.kind === 'final' ? 'Final claim' : 'Reimbursement'}{c.claim_no ? ` · claim ${c.claim_no}` : ''} · asked {money(c.amount_requested)}
          {c.amount_approved != null ? ` · approved ${money(c.amount_approved)}` : ''}{c.amount_settled != null ? ` · paid ${money(c.amount_settled)}` : ''}
          <span className="block font-semibold text-ink">Next: {claimNextStep(c)}</span>
          {c.documents_pending.length > 0 && <span className="block">Missing: {c.documents_pending.join(', ')}</span>}
          <span className="block">{age === 0 ? 'Updated today' : `No change for ${age} day${age === 1 ? '' : 's'}`}{slow ? ', follow up with the insurer' : ''}</span>
        </>}>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Btn variant="default" data-testid="claim-update" onClick={() => setEditing(c)}>Update</Btn>
          <Btn variant="ghost" onClick={() => onOpenPatient(c.patient_id)}>Open record</Btn>
        </div>
      </Row>
    );
  };

  return (
    <div data-testid="insurance">
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Open claims" value={open.length} />
        <Stat label="Insurer queries" value={open.filter((c) => c.status === 'query').length} tone={open.some((c) => c.status === 'query') ? 'danger' : undefined} />
        <Stat label="Awaiting money" value={money(pending)} />
        <Stat label="Insured, no claim yet" value={noClaim.length} tone={noClaim.length ? 'gate' : undefined} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageTabs tabs={[{ id: 'open', label: `Open (${open.length})` }, { id: 'closed', label: `Closed (${closed.length})` }]} value={tab} onChange={setTab} />
        <Btn variant="glow" data-testid="claim-new" onClick={() => setCreating({})}>+ New claim</Btn>
      </div>
      {noClaim.length > 0 && tab === 'open' && (
        <Card className="mb-3 border border-gate">
          <h2 className="text-sm font-semibold text-gate">Admitted on insurance with no pre-authorisation</h2>
          <ul className="divide-y divide-line">
            {noClaim.map((a) => (
              <Row key={a.id} title={pt(a.patient_id)?.name ?? 'Patient'} meta={`${a.reason ?? 'Admitted'} · ${new Date(a.admitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}>
                <div className="mt-1.5"><Btn variant="glow" data-testid="claim-start" onClick={() => setCreating({ patientId: a.patient_id, admissionId: a.id })}>Start pre-authorisation</Btn></div>
              </Row>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <ul className="divide-y divide-line" data-testid="claims">
          {(tab === 'open' ? open : closed).length === 0 && <Empty>{tab === 'open' ? 'No open claims.' : 'No closed claims yet.'}</Empty>}
          {(tab === 'open' ? open : closed).map(claimRow)}
        </ul>
      </Card>
      {creating && <ClaimForm init={creating} onClose={() => setCreating(null)} />}
      {editing && <ClaimUpdate claim={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ClaimForm({ init, onClose }: { init: { patientId?: string; admissionId?: string }; onClose: () => void }) {
  const { orgId, patients, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const [patient, setPatient] = useState<PatientIns | null>((init.patientId ? patients.find((p) => p.id === init.patientId) : null) as PatientIns | null);
  const [insurer, setInsurer] = useState(patient?.insurer ?? '');
  const [tpa, setTpa] = useState(patient?.insurance_tpa ?? '');
  const [policy, setPolicy] = useState(patient?.insurance_policy_no ?? '');
  const [kind, setKind] = useState<InsuranceClaimRow['kind']>(init.admissionId ? 'preauth' : 'final');
  const [amount, setAmount] = useState('');
  const [missing, setMissing] = useState<string[]>(DOCS.slice(0, 5));
  const [saving, setSaving] = useState(false);
  function pick(p: PatientRow | null) {
    const x = p as PatientIns | null;
    setPatient(x);
    if (x) { setInsurer(x.insurer ?? ''); setTpa(x.insurance_tpa ?? ''); setPolicy(x.insurance_policy_no ?? ''); }
  }
  async function save() {
    if (!patient || !insurer.trim()) return;
    setSaving(true);
    if (!patient.insurer) await saveInsurance(patient, { insurer, policyNo: policy, tpa, validTill: '' });
    const e = await createClaim(orgId, {
      patient_id: patient.id, admission_id: init.admissionId ?? null, bill_id: null, insurer: insurer.trim(), tpa: tpa.trim() || null, policy_no: policy.trim() || null,
      claim_no: null, kind, amount_requested: Number(amount) || 0, amount_approved: null, amount_settled: null, status: 'draft', documents_pending: missing,
      submitted_on: null, decided_on: null, settled_on: null, note: null, updated_by: me?.name ?? null,
    });
    setSaving(false);
    if (e) { pushToast({ tone: 'critical', title: 'Could not create the claim', detail: e }); return; }
    await logAudit('reception-claim-new', `${patient.name}: ${insurer} ${kind}`);
    pushToast({ tone: 'ok', title: 'Claim started', detail: `${patient.name} · ${insurer}` });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="claim-title" data-testid="claim-form">
        <h2 id="claim-title" className="text-lg mb-3">New insurance claim</h2>
        <PatientPicker value={patient} onChange={pick} />
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Insurer"><input className={inputCls} value={insurer} onChange={(e) => setInsurer(e.target.value)} placeholder="e.g. Star Health" data-testid="claim-insurer" /></Field>
          <Field label="TPA (if any)"><input className={inputCls} value={tpa} onChange={(e) => setTpa(e.target.value)} placeholder="e.g. Medi Assist" /></Field>
          <Field label="Policy number"><input className={inputCls} value={policy} onChange={(e) => setPolicy(e.target.value)} /></Field>
          <Field label="Type">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as InsuranceClaimRow['kind'])}>
              <option value="preauth">Pre-authorisation (cashless)</option><option value="final">Final claim (cashless)</option><option value="reimbursement">Reimbursement</option>
            </select>
          </Field>
          <Field label="Amount asked (₹)"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="claim-amount" /></Field>
        </div>
        <fieldset className="mt-3">
          <legend className="text-[13px] font-semibold text-ink-soft">Documents still to collect</legend>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {DOCS.map((d) => (
              <label key={d} className="inline-flex items-center gap-2 text-[13px] text-ink min-h-9">
                <input type="checkbox" className="w-4 h-4 accent-[var(--accent)]" checked={missing.includes(d)} onChange={() => setMissing(missing.includes(d) ? missing.filter((x) => x !== d) : [...missing, d])} />{d}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="claim-save" disabled={saving || !patient || !insurer.trim()} onClick={save}>Create claim</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ClaimUpdate({ claim, onClose }: { claim: InsuranceClaimRow; onClose: () => void }) {
  const { patients, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const [status, setStatus] = useState<ClaimStatus>(claim.status);
  const [claimNo, setClaimNo] = useState(claim.claim_no ?? '');
  const [approved, setApproved] = useState(claim.amount_approved != null ? String(claim.amount_approved) : '');
  const [settled, setSettled] = useState(claim.amount_settled != null ? String(claim.amount_settled) : '');
  const [missing, setMissing] = useState<string[]>(claim.documents_pending);
  const [note, setNote] = useState(claim.note ?? '');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const e = await updateClaim(claim, {
      status, claim_no: claimNo.trim() || null, amount_approved: approved ? Number(approved) : null, amount_settled: settled ? Number(settled) : null,
      documents_pending: missing, note: note.trim() || null,
    }, me?.name ?? null);
    setSaving(false);
    if (e) { pushToast({ tone: 'critical', title: 'Could not update', detail: e }); return; }
    await logAudit('reception-claim-update', `${patients.find((p) => p.id === claim.patient_id)?.name ?? ''}: ${CLAIM_LABEL[status]}`);
    pushToast({ tone: 'ok', title: `Claim: ${CLAIM_LABEL[status]}`, detail: claim.insurer });
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="cu-title" data-testid="claim-edit">
        <h2 id="cu-title" className="text-lg mb-3">Update claim · {claim.insurer}</h2>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Stage">
          {(Object.keys(CLAIM_LABEL) as ClaimStatus[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} data-testid={`claim-status-${s}`} onClick={() => setStatus(s)}
              className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold ${status === s ? 'bg-accent text-on-accent border-accent' : 'border-line-strong text-ink-soft hover:bg-hover'}`}>{CLAIM_LABEL[s]}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-x-3">
          <Field label="Claim number"><input className={inputCls} value={claimNo} onChange={(e) => setClaimNo(e.target.value)} data-testid="claim-no" /></Field>
          <Field label="Approved (₹)"><input className={inputCls} inputMode="decimal" value={approved} onChange={(e) => setApproved(e.target.value)} data-testid="claim-approved" /></Field>
          <Field label="Paid (₹)"><input className={inputCls} inputMode="decimal" value={settled} onChange={(e) => setSettled(e.target.value)} /></Field>
        </div>
        <fieldset className="mt-3">
          <legend className="text-[13px] font-semibold text-ink-soft">Still missing</legend>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {[...new Set([...DOCS, ...claim.documents_pending])].map((d) => (
              <label key={d} className="inline-flex items-center gap-2 text-[13px] text-ink min-h-9">
                <input type="checkbox" className="w-4 h-4 accent-[var(--accent)]" checked={missing.includes(d)} onChange={() => setMissing(missing.includes(d) ? missing.filter((x) => x !== d) : [...missing, d])} />{d}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Note (insurer's query, call details)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="mt-4 flex gap-2">
          <Btn variant="glow" data-testid="claim-update-save" disabled={saving} onClick={save}>Save</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

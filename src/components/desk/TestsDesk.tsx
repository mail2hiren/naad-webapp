import { useState } from 'react';
import { Btn, Card, Field, inputCls } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useClinic } from '../../context/ClinicContext';
import { useOrgTable } from '../../hooks/useOrgTable';
import { useContacts } from '../../hooks/useDesk';
import { supabase } from '../../lib/supabaseClient';
import { clinicNow } from '../../lib/schedule';
import { logContact } from '../../lib/deskActions';
import type { LabOrderRow } from '../../types/db';
import { CallOutcome, Empty, PageTabs, Row, Stat } from './common';

const TYPE: Record<string, string> = { xray: 'X-ray', mri: 'MRI', ct: 'CT scan', blood: 'Blood test', urine: 'Urine test', other: 'Test' };

/**
 * Tests and reports desk: tests the doctor ordered that the patient still
 * has to do, samples sent and results awaited, results to enter, and
 * reports to hand over (with a record of who was told).
 */
export function TestsDeskSection({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const { orgId, patients, practitioners, pushToast, logAudit } = useClinic();
  const { practitioner: me } = useAuth();
  const { rows: labs } = useOrgTable<LabOrderRow>('lab_orders', orgId);
  const contacts = useContacts(orgId);
  const [tab, setTab] = useState<'todo' | 'awaited' | 'handover'>('todo');
  const [entering, setEntering] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [telling, setTelling] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pt = (id: string) => patients.find((p) => p.id === id);
  const doc = (id: string | null) => practitioners.find((d) => d.id === id)?.name ?? '';
  const byDate = (a: LabOrderRow, b: LabOrderRow) => (a.urgency === b.urgency ? a.ordered_at.localeCompare(b.ordered_at) : a.urgency === 'urgent' ? -1 : 1);
  const todo = labs.filter((l) => l.status === 'ordered').sort(byDate);
  const awaited = labs.filter((l) => l.status === 'in_progress').sort(byDate);
  const done = labs.filter((l) => l.status === 'completed' || l.status === 'reviewed').sort((a, b) => b.ordered_at.localeCompare(a.ordered_at));
  const told = (l: LabOrderRow) => contacts.some((c) => c.patient_id === l.patient_id && c.purpose === 'report' && c.outcome === 'informed' && c.contacted_at >= l.ordered_at && (c.note ?? '').includes(l.test_name));
  const handover = done.filter((l) => !told(l));

  async function update(l: LabOrderRow, patch: Partial<LabOrderRow>, msg: string) {
    setBusy(true);
    const { error } = await supabase.from('lab_orders').update(patch).eq('id', l.id);
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not update the test', detail: error.message }); return false; }
    await logAudit('reception-lab-update', `${pt(l.patient_id)?.name ?? ''}: ${l.test_name} ${msg}`);
    pushToast({ tone: 'ok', title: msg, detail: `${l.test_name} · ${pt(l.patient_id)?.name ?? ''}` });
    return true;
  }

  const head = (l: LabOrderRow) => `${l.urgency === 'urgent' ? 'URGENT · ' : ''}${l.test_name} · ${pt(l.patient_id)?.name ?? 'Patient'}`;
  const meta = (l: LabOrderRow) => `${TYPE[l.test_type] ?? 'Test'} · ordered ${new Date(l.ordered_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${l.ordered_by ? ` by ${doc(l.ordered_by)}` : ''}${pt(l.patient_id)?.phone ? ` · ${pt(l.patient_id)!.phone}` : ''}${l.notes ? ` · ${l.notes}` : ''}`;

  return (
    <div data-testid="tests-desk">
      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="To do" value={todo.length} tone={todo.some((l) => l.urgency === 'urgent') ? 'danger' : undefined} />
        <Stat label="Results awaited" value={awaited.length} />
        <Stat label="To hand over" value={handover.length} tone={handover.length ? 'gate' : undefined} />
        <Stat label="Flagged by doctor" value={labs.filter((l) => l.flagged).length} tone={labs.some((l) => l.flagged) ? 'danger' : undefined} />
      </div>
      <PageTabs tabs={[{ id: 'todo', label: `To do (${todo.length})` }, { id: 'awaited', label: `Results awaited (${awaited.length})` }, { id: 'handover', label: `Hand over (${handover.length})` }]} value={tab} onChange={setTab} />

      {tab === 'todo' && (
        <Card>
          <ul className="divide-y divide-line" data-testid="tests-todo">
            {todo.length === 0 && <Empty>No tests waiting to be done.</Empty>}
            {todo.map((l) => (
              <Row key={l.id} testid="lab-row" tone={l.urgency === 'urgent' ? 'danger' : undefined} title={head(l)} meta={meta(l)}>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Btn variant="glow" data-testid="lab-collected" disabled={busy} onClick={() => update(l, { status: 'in_progress' }, l.test_type === 'blood' || l.test_type === 'urine' ? 'Sample collected' : 'Sent for the scan')}>
                    {l.test_type === 'blood' || l.test_type === 'urine' ? 'Sample collected' : 'Done / sent'}
                  </Btn>
                  <Btn variant="ghost" onClick={() => onOpenPatient(l.patient_id)}>Open record</Btn>
                </div>
              </Row>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'awaited' && (
        <Card>
          <ul className="divide-y divide-line" data-testid="tests-awaited">
            {awaited.length === 0 && <Empty>No results awaited.</Empty>}
            {awaited.map((l) => (
              <Row key={l.id} testid="lab-row" title={head(l)} meta={meta(l)}>
                {entering === l.id ? (
                  <div className="mt-1.5">
                    <Field label="Result (as written on the report)"><input className={inputCls} value={result} onChange={(e) => setResult(e.target.value)} data-testid="lab-result" placeholder="e.g. Haemoglobin 11.2 g/dL" /></Field>
                    <div className="mt-1.5 flex gap-1.5">
                      <Btn variant="glow" data-testid="lab-result-save" disabled={busy || !result.trim()} onClick={async () => { if (await update(l, { status: 'completed', result_summary: result.trim() }, 'Result entered')) { setEntering(null); setResult(''); } }}>Save result</Btn>
                      <Btn variant="ghost" onClick={() => setEntering(null)}>Cancel</Btn>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-faint">The doctor sees it and marks it reviewed. Attaching the report file needs document storage (proposed separately).</p>
                  </div>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Btn variant="glow" data-testid="lab-enter" onClick={() => { setEntering(l.id); setResult(''); }}>Report received</Btn>
                    <Btn variant="ghost" onClick={() => onOpenPatient(l.patient_id)}>Open record</Btn>
                  </div>
                )}
              </Row>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'handover' && (
        <Card>
          <ul className="divide-y divide-line" data-testid="tests-handover">
            {handover.length === 0 && <Empty>Every finished report has been handed over.</Empty>}
            {handover.map((l) => (
              <Row key={l.id} testid="lab-row" tone={l.flagged ? 'danger' : undefined} title={head(l)}
                meta={<>{meta(l)}{l.result_summary ? <span className="block text-ink">Result: {l.result_summary}</span> : null}{l.flagged ? <span className="block font-semibold text-danger">The doctor wants to see the patient about this result.</span> : l.status === 'completed' ? <span className="block">Waiting for the doctor to review.</span> : null}</>}>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Btn variant="default" data-testid="lab-tell" onClick={() => setTelling(telling === l.id ? null : l.id)}>Patient told / collected</Btn>
                  <Btn variant="ghost" onClick={() => onOpenPatient(l.patient_id)}>Open record</Btn>
                </div>
                {telling === l.id && (
                  <CallOutcome busy={busy} outcomes={['informed', 'no_answer', 'call_later']} onSave={async (o, n) => {
                    setBusy(true);
                    const e = await logContact(orgId, { patientId: l.patient_id, channel: o === 'informed' ? 'in_person' : 'call', purpose: 'report', outcome: o, note: `${l.test_name}${n ? `: ${n}` : ''}`, by: me?.name ?? null, at: clinicNow() });
                    setBusy(false);
                    if (e) { pushToast({ tone: 'critical', title: 'Could not save', detail: e }); return; }
                    pushToast({ tone: 'ok', title: o === 'informed' ? 'Report handed over' : 'Call saved', detail: l.test_name });
                    setTelling(null);
                  }} />
                )}
              </Row>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

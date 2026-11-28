import { useMemo, useState } from 'react';
import { Btn, Card, Pill, SectionHead, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { useOrgTable } from '../../hooks/useOrgTable';
import { supabase } from '../../lib/supabaseClient';
import { downloadCsv } from '../../lib/csv';
import { dayKey } from '../../lib/schedule';
import type { AuditEventRow } from '../../types/db';

const ROLE_LABEL: Record<string, string> = {
  surgeon: 'Doctor', physio: 'Physiotherapist', receptionist: 'Reception', pharmacist: 'Pharmacy', admin: 'Admin', system: 'System',
};
const PAGE = 50;

/** Who did what, when: every action staff take in Naad, newest first, with
 * a check that the log's hash chain is unbroken. */
export function AuditLogSection() {
  const { orgId } = useClinic();
  const { rows } = useOrgTable<AuditEventRow>('audit_events', orgId);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [check, setCheck] = useState<{ state: 'idle' | 'busy' | 'ok' | 'broken' | 'error'; text?: string }>({ state: 'idle' });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...rows]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .filter((r) => (role === 'all' || r.role === role)
        && (!from || dayKey(new Date(r.ts)) >= from) && (!to || dayKey(new Date(r.ts)) <= to)
        && (!s || [r.actor, r.action, r.detail].some((v) => (v ?? '').toLowerCase().includes(s))));
  }, [rows, q, role, from, to]);
  const roles = [...new Set(rows.map((r) => r.role).filter(Boolean) as string[])].sort();

  async function runCheck() {
    setCheck({ state: 'busy' });
    const { data, error } = await supabase.rpc('audit_chain_check');
    if (error) { setCheck({ state: 'error', text: error.message }); return; }
    const row = (Array.isArray(data) ? data[0] : data) as { checked: number; broken_id: string | null } | null;
    if (!row) { setCheck({ state: 'error', text: 'No answer from the database.' }); return; }
    setCheck(row.broken_id
      ? { state: 'broken', text: `Entry ${row.checked} (${row.broken_id}) does not match the chain. The log may have been changed.` }
      : { state: 'ok', text: `All ${row.checked} entries checked. The log has not been changed.` });
  }

  const when = (ts: string) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <Card className="mb-4">
        <SectionHead title="Every action, on record" desc="Every action recorded by Naad. Entries cannot be edited or deleted; each one is chained to the one before it." />
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="glow" data-testid="audit-check" disabled={check.state === 'busy'} onClick={runCheck}>{check.state === 'busy' ? 'Checking…' : 'Check the log is intact'}</Btn>
          {check.text && (
            <p role="status" data-testid="audit-check-result" className={`text-sm ${check.state === 'ok' ? 'text-ok' : 'text-danger'}`}>{check.text}</p>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <label className="block flex-1 min-w-[12rem]"><span className="block text-[13px] font-semibold text-ink-soft mb-1">Search</span>
            <input className={inputCls} data-testid="audit-search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Name, action or patient" /></label>
          <label className="block"><span className="block text-[13px] font-semibold text-ink-soft mb-1">Who</span>
            <select className={inputCls} data-testid="audit-role" value={role} onChange={(e) => { setRole(e.target.value); setLimit(PAGE); }}>
              <option value="all">Everyone</option>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
            </select></label>
          <label className="block"><span className="block text-[13px] font-semibold text-ink-soft mb-1">From</span>
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="block"><span className="block text-[13px] font-semibold text-ink-soft mb-1">To</span>
            <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Btn variant="default" data-testid="audit-csv" onClick={() => downloadCsv('naad-audit-log.csv', ['When (UTC)', 'Who', 'Role', 'Action', 'Detail'],
            filtered.map((r) => [r.ts, r.actor, r.role, r.action, r.detail]))}>Download CSV</Btn>
        </div>
        <p className="text-[13px] text-ink-soft mb-2" data-testid="audit-count">{filtered.length} of {rows.length} entries</p>
        <ul className="divide-y divide-line">
          {filtered.slice(0, limit).map((r) => (
            <li key={r.id} className="py-2" data-testid="audit-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{r.actor ?? 'Unknown'}</span>
                <span className="flex items-center gap-2"><Pill>{ROLE_LABEL[r.role ?? ''] ?? r.role ?? '–'}</Pill><span className="text-[13px] text-ink-soft">{when(r.ts)}</span></span>
              </div>
              <div className="text-sm text-ink"><span className="font-mono text-[13px] text-ink-soft">{r.action}</span>{r.detail ? ` · ${r.detail}` : ''}</div>
            </li>
          ))}
        </ul>
        {filtered.length > limit && <Btn variant="default" className="mt-3" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</Btn>}
      </Card>
    </>
  );
}

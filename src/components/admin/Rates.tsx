import { useState } from 'react';
import { Btn, Card, Field, SectionHead, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { useRates } from '../../hooks/useHospitalSetup';
import { supabase } from '../../lib/supabaseClient';
import { newId } from '../../lib/frontDesk';
import { money } from '../../lib/schedule';
import { CATEGORY_LABEL } from '../../lib/labels';
import type { RateCategory, ServiceRateRow } from '../../types/db';

/** The hospital's price list. Reception picks from it when billing. */
export function RatesSection() {
  const { orgId, pushToast, logAudit } = useClinic();
  const { rates } = useRates(orgId);
  const [f, setF] = useState({ name: '', category: 'procedure' as RateCategory, amount: '' });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const dup = rates.some((r) => r.name.trim().toLowerCase() === f.name.trim().toLowerCase());

  async function add() {
    const amount = Number(f.amount);
    if (!f.name.trim() || !Number.isFinite(amount) || amount < 0 || dup) return;
    setBusy(true);
    const { error } = await supabase.from('service_rates').insert({
      id: newId('rt'), org_id: orgId, name: f.name.trim(), category: f.category, amount, active: true, created_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not add the rate', detail: error.message }); return; }
    await logAudit('admin-rate-added', `${f.name.trim()} ${money(amount)}`);
    pushToast({ tone: 'ok', title: 'Rate added', detail: `${f.name.trim()} · ${money(amount)}` });
    setF({ name: '', category: f.category, amount: '' });
  }

  async function update(r: ServiceRateRow, patch: Partial<ServiceRateRow>, what: string) {
    const { error } = await supabase.from('service_rates').update(patch).eq('id', r.id);
    if (error) { pushToast({ tone: 'critical', title: 'Could not update the rate', detail: error.message }); return; }
    await logAudit('admin-rate-changed', `${r.name}: ${what}`);
    pushToast({ tone: 'ok', title: 'Rate updated', detail: `${r.name}: ${what}` });
  }

  async function commitAmount(r: ServiceRateRow) {
    const raw = drafts[r.id];
    if (raw === undefined) return;
    const v = Number(raw);
    setDrafts((d) => { const n = { ...d }; delete n[r.id]; return n; });
    if (!Number.isFinite(v) || v < 0) { pushToast({ tone: 'warning', title: 'Enter an amount of 0 or more' }); return; }
    if (v !== r.amount) await update(r, { amount: v }, `${money(r.amount)} to ${money(v)}`);
  }

  const shown = rates.filter((r) => showRetired || r.active);
  const groups = (Object.keys(CATEGORY_LABEL) as RateCategory[]).map((c) => [c, shown.filter((r) => r.category === c)] as const).filter(([, l]) => l.length);

  return (
    <Card className="mb-6">
      <SectionHead title="Price list" desc="Charges reception adds to a bill with one tap. A new price applies to new bills only." />
      {groups.length === 0 && <p className="text-sm text-ink-soft mb-3">No rates yet. Add the first one below.</p>}
      {groups.map(([cat, list]) => (
        <section key={cat} className="mb-4">
          <h3 className="text-sm font-semibold text-ink-soft mb-1">{CATEGORY_LABEL[cat]}</h3>
          <ul className="divide-y divide-line">
            {list.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2" data-testid="rate-row">
                <span className={`text-sm ${r.active ? 'text-ink' : 'text-ink-soft line-through'}`}>{r.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-ink-soft text-sm" aria-hidden="true">₹</span>
                  <input className={`${inputCls} w-28`} inputMode="decimal" data-testid="rate-amount" aria-label={`Price of ${r.name} in rupees`}
                    value={drafts[r.id] ?? String(r.amount)} disabled={!r.active}
                    onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value.replace(/[^\d.]/g, '') })} onBlur={() => commitAmount(r)} />
                  <Btn variant={r.active ? 'ghost' : 'primary'} data-testid="rate-toggle" onClick={() => update(r, { active: !r.active }, r.active ? 'retired' : 'back in use')}>
                    {r.active ? 'Retire' : 'Use again'}
                  </Btn>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rates.some((r) => !r.active) && (
        <Btn variant="default" aria-pressed={showRetired} onClick={() => setShowRetired(!showRetired)}>{showRetired ? 'Hide retired rates' : 'Show retired rates'}</Btn>
      )}
      <div className="mt-4 border-t border-line pt-4" data-testid="add-rate">
        <h3 className="text-sm font-semibold text-ink mb-2">Add a charge</h3>
        <div className="grid sm:grid-cols-[1fr_12rem_8rem] gap-x-3">
          <Field label="Name"><input className={inputCls} data-testid="rate-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Suture removal" /></Field>
          <Field label="Kind">
            <select className={inputCls} data-testid="rate-category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as RateCategory })}>
              {(Object.keys(CATEGORY_LABEL) as RateCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Price (₹)"><input className={inputCls} inputMode="decimal" data-testid="rate-new-amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        </div>
        {dup && f.name.trim() && <p className="text-[13px] text-danger -mt-1 mb-2" role="alert">There is already a charge with this name.</p>}
        <Btn variant="glow" data-testid="rate-add" disabled={busy || !f.name.trim() || f.amount === '' || dup} onClick={add}>Add charge</Btn>
      </div>
    </Card>
  );
}

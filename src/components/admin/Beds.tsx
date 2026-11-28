import { useMemo, useState } from 'react';
import { Btn, Card, Field, Modal, Pill, SectionHead, StatTile, inputCls } from '../ui';
import { useClinic } from '../../context/ClinicContext';
import { useBeds } from '../../hooks/useHospitalSetup';
import { supabase } from '../../lib/supabaseClient';
import { newId } from '../../lib/frontDesk';
import { money } from '../../lib/schedule';
import { BED_KIND } from '../../lib/labels';
import type { BedKind, BedRow } from '../../types/db';

/** Wards and beds: what exists, what it costs a day and who is in it. */
export function BedsSection() {
  const { orgId, patients, pushToast, logAudit } = useClinic();
  const { beds } = useBeds(orgId);
  const [editing, setEditing] = useState<BedRow | null>(null);
  const wards = useMemo(() => [...new Set(beds.map((b) => b.ward))], [beds]);
  const [f, setF] = useState({ ward: '', newWard: '', label: '', kind: 'general' as BedKind, rate: '' });
  const [busy, setBusy] = useState(false);
  const active = beds.filter((b) => b.active);
  const occupied = active.filter((b) => b.patient_id);
  const ward = f.ward === '__new' ? f.newWard.trim() : f.ward || wards[0] || f.newWard.trim();
  const clash = beds.some((b) => b.ward === ward && b.label.toLowerCase() === f.label.trim().toLowerCase());

  async function add() {
    const rate = Number(f.rate);
    if (!ward || !f.label.trim() || clash || !Number.isFinite(rate) || rate < 0) return;
    setBusy(true);
    const { error } = await supabase.from('beds').insert({
      id: newId('bed'), org_id: orgId, ward, label: f.label.trim(), kind: f.kind, daily_rate: rate, active: true,
      patient_id: null, occupied_since: null, created_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not add the bed', detail: error.message }); return; }
    await logAudit('admin-bed-added', `${ward} ${f.label.trim()} (${BED_KIND[f.kind]}, ${money(rate)}/day)`);
    pushToast({ tone: 'ok', title: 'Bed added', detail: `${ward} · ${f.label.trim()}` });
    setF({ ...f, label: '', newWard: '', ward: ward });
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <StatTile label="Beds in use" value={active.length} />
        <StatTile label="Occupied" value={occupied.length} tone="gate" />
        <StatTile label="Free" value={active.length - occupied.length} tone="ok" />
        <StatTile label="Occupancy" value={active.length ? `${Math.round((occupied.length / active.length) * 100)}%` : '–'} tone="accent" />
      </div>

      {wards.map((w) => {
        const list = beds.filter((b) => b.ward === w);
        return (
          <Card key={w} className="mb-4" data-testid="ward-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="text-lg">{w}</h2>
              <span className="text-[13px] text-ink-soft">{list.filter((b) => b.active && b.patient_id).length} of {list.filter((b) => b.active).length} occupied</span>
            </div>
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {list.map((b) => {
                const p = b.patient_id ? patients.find((x) => x.id === b.patient_id) : null;
                return (
                  <li key={b.id}>
                    <button type="button" data-testid="bed-tile" onClick={() => setEditing(b)}
                      className={`w-full min-h-11 rounded-lg px-3 py-2 text-left hover:bg-hover ${b.active ? 'bg-surface-2' : 'border border-dashed border-line-strong'}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">{b.label}</span>
                        {!b.active ? <Pill>Closed</Pill> : p ? <Pill tone="gate">Occupied</Pill> : <Pill tone="ok">Free</Pill>}
                      </span>
                      <span className="block text-[13px] text-ink-soft">{BED_KIND[b.kind]} · {money(b.daily_rate)}/day</span>
                      {p && <span className="block text-[13px] text-ink truncate">{p.name}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}

      <Card data-testid="add-bed">
        <SectionHead title="Add a bed" desc="Pick a ward or start a new one. Beds are never deleted; close one instead." />
        <div className="grid sm:grid-cols-2 gap-x-3">
          <Field label="Ward">
            <select className={inputCls} data-testid="bed-ward" value={f.ward || (wards[0] ?? '__new')} onChange={(e) => setF({ ...f, ward: e.target.value })}>
              {wards.map((w) => <option key={w} value={w}>{w}</option>)}
              <option value="__new">New ward…</option>
            </select>
          </Field>
          {(f.ward === '__new' || wards.length === 0) && (
            <Field label="New ward name"><input className={inputCls} data-testid="bed-new-ward" value={f.newWard} onChange={(e) => setF({ ...f, newWard: e.target.value })} placeholder="e.g. Maternity" /></Field>
          )}
          <Field label="Bed label"><input className={inputCls} data-testid="bed-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. G-9" /></Field>
          <Field label="Type">
            <select className={inputCls} data-testid="bed-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as BedKind })}>
              {(Object.keys(BED_KIND) as BedKind[]).map((k) => <option key={k} value={k}>{BED_KIND[k]}</option>)}
            </select>
          </Field>
          <Field label="Daily rate (₹)"><input className={inputCls} inputMode="decimal" data-testid="bed-rate" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        </div>
        {clash && f.label.trim() && <p className="text-[13px] text-danger -mt-1 mb-2" role="alert">{ward} already has a bed called {f.label.trim()}.</p>}
        <Btn variant="glow" data-testid="bed-add" disabled={busy || !ward || !f.label.trim() || f.rate === '' || clash} onClick={add}>Add bed</Btn>
      </Card>

      {editing && <BedModal bed={beds.find((b) => b.id === editing.id) ?? editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function BedModal({ bed, onClose }: { bed: BedRow; onClose: () => void }) {
  const { patients, pushToast, logAudit } = useClinic();
  const [kind, setKind] = useState<BedKind>(bed.kind);
  const [rate, setRate] = useState(String(bed.daily_rate));
  const [busy, setBusy] = useState(false);
  const p = bed.patient_id ? patients.find((x) => x.id === bed.patient_id) : null;

  async function save(patch: Partial<BedRow>, what: string) {
    setBusy(true);
    const { error } = await supabase.from('beds').update(patch).eq('id', bed.id);
    setBusy(false);
    if (error) { pushToast({ tone: 'critical', title: 'Could not update the bed', detail: error.message }); return; }
    await logAudit('admin-bed-changed', `${bed.ward} ${bed.label}: ${what}`);
    pushToast({ tone: 'ok', title: 'Bed updated', detail: `${bed.label}: ${what}` });
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="bed-title" data-testid="bed-modal">
        <h2 id="bed-title" className="text-lg">{bed.ward} · {bed.label}</h2>
        <p className="mt-1 mb-3 text-sm text-ink-soft">
          {p ? `Occupied by ${p.name} since ${new Date(bed.occupied_since ?? '').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.` : bed.active ? 'Free.' : 'Closed.'}
        </p>
        <div className="grid sm:grid-cols-2 gap-x-3">
          <Field label="Type">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as BedKind)}>
              {(Object.keys(BED_KIND) as BedKind[]).map((k) => <option key={k} value={k}>{BED_KIND[k]}</option>)}
            </select>
          </Field>
          <Field label="Daily rate (₹)"><input className={inputCls} inputMode="decimal" data-testid="bed-edit-rate" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="glow" data-testid="bed-save" disabled={busy || rate === ''} onClick={() => save({ kind, daily_rate: Number(rate) }, `${BED_KIND[kind]}, ${money(Number(rate))}/day`)}>Save</Btn>
          {bed.active
            ? <Btn variant="danger" data-testid="bed-close" disabled={busy || !!p} onClick={() => save({ active: false }, 'closed')}>Close bed</Btn>
            : <Btn variant="primary" disabled={busy} onClick={() => save({ active: true }, 'reopened')}>Reopen bed</Btn>}
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
        {p && bed.active && <p className="mt-2 text-[13px] text-ink-soft">An occupied bed cannot be closed. Discharge or move the patient first.</p>}
      </div>
    </Modal>
  );
}

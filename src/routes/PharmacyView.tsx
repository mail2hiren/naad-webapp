import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { Card, Btn, Pill, SectionHead } from '../components/ui';
import Shell from '../components/Shell';
import { supabase } from '../lib/supabaseClient';
import type { InventoryRow, PharmacyOrderRow, PrescriptionItem } from '../types/db';

/**
 * Pharmacy Counter — a 3-column Kanban board (Pending / Preparing / Ready)
 * reading live off `useClinic().pharmacyOrders` (already realtime-synced by
 * ClinicContext, so a doctor's authorization lands here with zero polling).
 * The "flash toast + chime on incoming authorization" requirement is handled
 * globally by ClinicContext watching `notifications` — this view only needs
 * to render the board and drive the stage-advance / substitution writes.
 */

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Formats a millisecond duration as "Xm Ys". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Live incremental stopwatch: ticks every second and formats the elapsed
 * time since `sinceIso` as "Xm Ys". Used for the in-flight timers on Pending
 * / Preparing cards. Called unconditionally on every card (Rules of Hooks) —
 * columns that don't need a visible timer (Ready) simply don't render the
 * returned string.
 */
function useElapsed(sinceIso: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const since = new Date(sinceIso).getTime();
  return formatDuration(now - since);
}

/** Cross-references an inventory row against a prescribed item by a simple
 * case-insensitive substring match on the drug's first word (e.g.
 * "Ibuprofen 400mg" ~ item name "Ibuprofen"). */
function matchInventory(inventory: InventoryRow[], itemName: string): InventoryRow | undefined {
  const key = itemName.toLowerCase().trim().split(' ')[0];
  if (!key) return undefined;
  return inventory.find((inv) => inv.drug.toLowerCase().includes(key));
}

function isLowStock(matched: InventoryRow | undefined): boolean {
  if (!matched) return true;
  return matched.stock === 0 || matched.stock <= matched.low;
}

function exceptionNoteFor(matched: InventoryRow | undefined): string {
  if (!matched) return 'Item not in inventory — pharmacist review needed';
  if (matched.alternates.length > 0) {
    return `No stock — molecular equivalents: ${matched.alternates.join(', ')}`;
  }
  return `No stock — no listed alternates on file for ${matched.drug}, pharmacist review needed`;
}

export default function PharmacyView() {
  useAuth(); // practitioner identity flows into logAudit via ClinicContext
  // Row 4.0 — Real-Time Sync Notification: the toast + audio chime for a
  // fresh authorization already fire globally (ClinicContext watches
  // `notifications`); `newPharmacyOrderIds` is the same idea for the
  // card-level neon flash the checklist also calls for -- tracked in
  // ClinicContext (see its comment) so an order that lands while the
  // pharmacist is elsewhere still arrives flagged, not just ones that show
  // up while this view happens to already be mounted.
  const { orgId, pharmacyOrders, inventory, patients, pushToast, logAudit, newPharmacyOrderIds } = useClinic();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [showInventory, setShowInventory] = useState(true);

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  }

  function patientName(patientId: string): string {
    return patients.find((p) => p.id === patientId)?.name ?? 'Unknown patient';
  }

  const pending = useMemo(() => pharmacyOrders.filter((o) => o.status === 'received'), [pharmacyOrders]);
  const preparing = useMemo(() => pharmacyOrders.filter((o) => o.status === 'preparing'), [pharmacyOrders]);
  const ready = useMemo(() => pharmacyOrders.filter((o) => o.status === 'ready'), [pharmacyOrders]);
  const exceptions = useMemo(() => pharmacyOrders.filter((o) => o.status === 'exception'), [pharmacyOrders]);

  async function handleStartPreparing(order: PharmacyOrderRow) {
    setBusy(order.id, true);
    try {
      const nowIso = new Date().toISOString();
      await supabase.from('pharmacy_orders')
        .update({ status: 'preparing', prep_started_at: nowIso, updated_at: nowIso })
        .eq('id', order.id);
      await logAudit('pharmacy-start-preparing', patientName(order.patient_id));
    } finally {
      setBusy(order.id, false);
    }
  }

  async function handleMarkReady(order: PharmacyOrderRow) {
    setBusy(order.id, true);
    try {
      const nowIso = new Date().toISOString();
      await supabase.from('pharmacy_orders')
        .update({ status: 'ready', ready_at: nowIso, updated_at: nowIso })
        .eq('id', order.id);
      await logAudit('pharmacy-mark-ready', patientName(order.patient_id));
    } finally {
      setBusy(order.id, false);
    }
  }

  async function handleDispense(order: PharmacyOrderRow) {
    setBusy(order.id, true);
    try {
      const name = patientName(order.patient_id);
      const nowIso = new Date().toISOString();
      await supabase.from('pharmacy_orders')
        .update({ status: 'collected', updated_at: nowIso })
        .eq('id', order.id);
      await supabase.from('notifications').insert({
        id: newId('nt'), org_id: orgId, type: 'general', patient_id: order.patient_id, practitioner_id: null,
        message: `Medicines dispensed for ${name}`, channel: 'inapp', read: false,
      });
      await logAudit('pharmacy-dispense', name);
      pushToast({ tone: 'ok', title: 'Dispensed', detail: name });
    } finally {
      setBusy(order.id, false);
    }
  }

  async function handleFlagAlternate(order: PharmacyOrderRow, item: PrescriptionItem) {
    setBusy(order.id, true);
    try {
      const name = patientName(order.patient_id);
      const matched = matchInventory(inventory, item.name);
      const note = exceptionNoteFor(matched);
      const nowIso = new Date().toISOString();
      await supabase.from('pharmacy_orders')
        .update({ status: 'exception', exception_note: note, updated_at: nowIso })
        .eq('id', order.id);
      // Simplification: broadcasting (practitioner_id: null) rather than
      // chasing prescription_id -> encounters.practitioner_id -- see summary.
      await supabase.from('notifications').insert({
        id: newId('nt'), org_id: orgId, type: 'substitution_flag', patient_id: order.patient_id, practitioner_id: null,
        message: `Stock substitution needed for ${name}: ${item.name} — pharmacist has flagged alternates for your approval`,
        channel: 'inapp', read: false,
      });
      await logAudit('pharmacy-flag-alternate', `${name}: ${item.name}`);
      pushToast({ tone: 'warning', title: 'Flagged for doctor review', detail: item.name });
    } finally {
      setBusy(order.id, false);
    }
  }

  async function handleResumeException(order: PharmacyOrderRow) {
    setBusy(order.id, true);
    try {
      const nowIso = new Date().toISOString();
      await supabase.from('pharmacy_orders')
        .update({ status: 'received', exception_note: '', updated_at: nowIso })
        .eq('id', order.id);
      await logAudit('pharmacy-resume-from-exception', patientName(order.patient_id));
      pushToast({ tone: 'ok', title: 'Resumed to Pending Orders', detail: patientName(order.patient_id) });
    } finally {
      setBusy(order.id, false);
    }
  }

  return (
    <Shell title="Pharmacy Counter">
      {exceptions.length > 0 && (
        <div className="mb-6 space-y-3">
          {exceptions.map((order) => (
            <Card key={order.id} className="border border-danger !bg-danger-soft">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-mono text-[10px] tracking-wider uppercase text-danger mb-1">
                    ⚠ Needs Doctor Clearance
                  </div>
                  <div className="text-sm font-semibold text-ink">{patientName(order.patient_id)}</div>
                  {order.exception_note && (
                    <div className="text-xs text-ink-soft mt-1 max-w-[52ch]">{order.exception_note}</div>
                  )}
                </div>
                <Btn
                  variant="danger"
                  data-testid="resume-from-exception"
                  disabled={busyIds.has(order.id)}
                  onClick={() => handleResumeException(order)}
                >
                  Substitution Approved — Resume
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KanbanColumn
            title="Pending Orders"
            dotClass="bg-gate"
            orders={pending}
            patientName={patientName}
            inventory={inventory}
            busyIds={busyIds}
            flashingIds={newPharmacyOrderIds}
            actionLabel="Start Preparing"
            actionTestId="start-preparing"
            onAction={handleStartPreparing}
            onFlagAlternate={handleFlagAlternate}
            timerSourceField="updated_at"
          />
          <KanbanColumn
            title="Preparing"
            dotClass="bg-accent-ink"
            orders={preparing}
            patientName={patientName}
            inventory={inventory}
            busyIds={busyIds}
            flashingIds={newPharmacyOrderIds}
            actionLabel="Mark Ready for Pickup"
            actionTestId="mark-ready"
            onAction={handleMarkReady}
            onFlagAlternate={handleFlagAlternate}
            timerSourceField="prep_started_at"
          />
          <KanbanColumn
            title="Ready for Pickup"
            dotClass="bg-ok"
            orders={ready}
            patientName={patientName}
            inventory={inventory}
            busyIds={busyIds}
            flashingIds={newPharmacyOrderIds}
            actionLabel="Dispense"
            actionTestId="dispense"
            onAction={handleDispense}
            onFlagAlternate={handleFlagAlternate}
            timerSourceField={null}
          />
        </div>

        <Card className="h-fit">
          <div className="flex items-center justify-between mb-1">
            <SectionHead eyebrow="Stock" title="Inventory" />
            <Btn variant="ghost" className="!px-2 !py-1 !text-[11px] -mt-5" onClick={() => setShowInventory((v) => !v)}>
              {showInventory ? 'Hide' : 'Show'}
            </Btn>
          </div>
          {showInventory && (
            <div className="space-y-2">
              {inventory.length === 0 && <div className="text-sm text-ink-faint">No inventory records.</div>}
              {inventory.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2">
                  <div>
                    <div className="text-sm text-ink font-semibold">{inv.drug}</div>
                    <div className="text-[11px] text-ink-faint">{inv.stock} {inv.unit ?? ''}</div>
                  </div>
                  <Pill tone={inv.stock <= inv.low ? 'danger' : 'ok'}>{inv.stock <= inv.low ? 'Low' : 'OK'}</Pill>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

type TimerField = 'updated_at' | 'prep_started_at' | null;

function KanbanColumn({
  title, dotClass, orders, patientName, inventory, busyIds, flashingIds, actionLabel, actionTestId, onAction, onFlagAlternate, timerSourceField,
}: {
  title: string;
  dotClass: string;
  orders: PharmacyOrderRow[];
  patientName: (id: string) => string;
  inventory: InventoryRow[];
  busyIds: Set<string>;
  flashingIds: Set<string>;
  actionLabel: string;
  actionTestId: string;
  onAction: (order: PharmacyOrderRow) => void;
  onFlagAlternate: (order: PharmacyOrderRow, item: PrescriptionItem) => void;
  timerSourceField: TimerField;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          <h3 className="text-sm font-bold text-ink">{title}</h3>
        </div>
        <span className="font-mono text-[11px] text-ink-faint">{orders.length}</span>
      </div>
      <div className="space-y-3">
        {orders.length === 0 && <div className="text-xs text-ink-faint">No orders.</div>}
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            patientName={patientName(order.patient_id)}
            inventory={inventory}
            busy={busyIds.has(order.id)}
            flashing={flashingIds.has(order.id)}
            actionLabel={actionLabel}
            actionTestId={actionTestId}
            onAction={onAction}
            onFlagAlternate={onFlagAlternate}
            timerSourceField={timerSourceField}
          />
        ))}
      </div>
    </Card>
  );
}

function OrderCard({
  order, patientName, inventory, busy, flashing, actionLabel, actionTestId, onAction, onFlagAlternate, timerSourceField,
}: {
  order: PharmacyOrderRow;
  patientName: string;
  inventory: InventoryRow[];
  busy: boolean;
  flashing: boolean;
  actionLabel: string;
  actionTestId: string;
  onAction: (order: PharmacyOrderRow) => void;
  onFlagAlternate: (order: PharmacyOrderRow, item: PrescriptionItem) => void;
  timerSourceField: TimerField;
}) {
  const timerSince = timerSourceField === 'prep_started_at' ? (order.prep_started_at ?? order.updated_at) : order.updated_at;
  const elapsed = useElapsed(timerSince);
  const preparedIn = order.prep_started_at && order.ready_at
    ? formatDuration(new Date(order.ready_at).getTime() - new Date(order.prep_started_at).getTime())
    : null;

  return (
    <div
      className={`bg-surface-2 rounded-lg px-3 py-3 transition-shadow duration-500 ${
        flashing ? 'ring-2 ring-accent-ink shadow-[0_0_20px_2px_rgba(143,217,255,.5)]' : ''
      }`}
      data-testid={flashing ? 'new-order-flash' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-ink">{patientName}</div>
        {timerSourceField !== null && (
          <span className="font-mono text-[11px] text-accent-ink whitespace-nowrap" data-testid="order-elapsed">
            {elapsed}
          </span>
        )}
      </div>

      {preparedIn && (
        <div className="mt-1">
          <Pill tone="ok">Prepared in {preparedIn}</Pill>
        </div>
      )}

      <ul className="mt-2 space-y-1.5">
        {order.items.map((item, idx) => {
          const matched = matchInventory(inventory, item.name);
          const low = isLowStock(matched);
          return (
            <li key={`${order.id}-${idx}`} className="text-xs text-ink-soft">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span>
                  <span className="text-ink font-medium">{item.name}</span>
                  {' '}· {item.dosage} · {item.frequency}
                </span>
                {low && <span className="text-danger font-semibold whitespace-nowrap">⚠ Low stock</span>}
              </div>
              {low && matched && matched.alternates.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5" data-testid="generic-equivalent-tags">
                  <span className="text-[10px] text-ink-faint uppercase tracking-wide">Generic equivalents:</span>
                  {matched.alternates.map((alt) => (
                    <span
                      key={alt}
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-accent-soft text-accent-ink"
                    >
                      {alt}
                    </span>
                  ))}
                </div>
              )}
              {low && (
                <Btn
                  variant="danger"
                  className="!px-2 !py-1 !text-[10px] mt-1.5"
                  data-testid="flag-alternate"
                  disabled={busy}
                  onClick={() => onFlagAlternate(order, item)}
                >
                  Flag Alternate Item
                </Btn>
              )}
            </li>
          );
        })}
      </ul>

      <Btn
        variant="glow"
        className="mt-3 w-full"
        data-testid={actionTestId}
        disabled={busy}
        onClick={() => onAction(order)}
      >
        {busy ? 'Working…' : actionLabel}
      </Btn>
    </div>
  );
}

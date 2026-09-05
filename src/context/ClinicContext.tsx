import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';
import { playCriticalChime, playSoftChime } from '../lib/chime';
import type {
  PatientRow, PractitionerRow, AppointmentRow, EncounterRow, PharmacyOrderRow,
  InventoryRow, NotificationRow, PrescriptionRow, ReferralRow, WardBillingLedgerRow,
} from '../types/db';

export interface Toast {
  id: string;
  tone: 'critical' | 'warning' | 'ok' | 'info';
  title: string;
  detail?: string;
}

interface ClinicState {
  orgId: string;
  patients: PatientRow[];
  practitioners: PractitionerRow[];
  appointments: AppointmentRow[];
  encounters: EncounterRow[];
  prescriptions: PrescriptionRow[];
  pharmacyOrders: PharmacyOrderRow[];
  referrals: ReferralRow[];
  wardLedger: WardBillingLedgerRow[];
  inventory: InventoryRow[];
  notifications: NotificationRow[];
  newPharmacyOrderIds: Set<string>;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  logAudit: (action: string, detail: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const ORG_ID = 'org1';
// Row 4.0 (Clinical_User_Stories) -- "Card flashes neon border glow on
// incoming updates". How long a pharmacy order stays in the "just arrived"
// set after its INSERT event lands, so PharmacyView can ring its card.
// Tracked here (not locally inside PharmacyView) for the same reason
// seenNotificationIds/toasts are tracked here: ClinicProvider wraps the
// whole app and its realtime channels stay subscribed across route changes,
// so an order authorized while the pharmacist is on a different screen (or
// not yet logged in) still gets flagged the moment it lands, rather than
// only catching arrivals that happen to occur while PharmacyView itself is
// already mounted.
const PHARMACY_FLASH_DURATION_MS = 10000;
// Caps how many alerts can pile up on screen at once -- a burst of events
// (several unseen notifications toasting on load, a doctor authorizing
// multiple patients in quick succession) previously had no limit and could
// stack toasts high enough to bury the header and the patient list beneath
// them. Keeping only the most recent MAX_VISIBLE_TOASTS means the newest,
// most relevant alert is always visible without a wall of stale ones.
const MAX_VISIBLE_TOASTS = 3;
const ClinicCtx = createContext<ClinicState | null>(null);

/**
 * The single global Context Layer the whole app reads from. It hooks
 * directly into Supabase's real-time channels for every table a screen
 * depends on (patients, appointments, encounters, prescriptions,
 * pharmacy_orders, referrals, ward_billing_ledger, inventory,
 * notifications) so a write from any route -- Front Desk checking a
 * patient in, a doctor authorizing a prescription, a pharmacist marking an
 * order ready -- lands in this one state pool and every other open route
 * re-renders from it immediately, with zero manual refresh.
 */
export function ClinicProvider({ children }: { children: ReactNode }) {
  const { practitioner } = useAuth();
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [practitioners, setPractitioners] = useState<PractitionerRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [pharmacyOrders, setPharmacyOrders] = useState<PharmacyOrderRow[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [wardLedger, setWardLedger] = useState<WardBillingLedgerRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [newPharmacyOrderIds, setNewPharmacyOrderIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenNotificationIds = useRef(new Set<string>());

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...t, id }].slice(-MAX_VISIBLE_TOASTS));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 7000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    const [p, pr, ap, en, rx, po, rf, wl, inv, nt] = await Promise.all([
      supabase.from('patients').select('*').eq('org_id', ORG_ID),
      supabase.from('practitioners').select('*').eq('org_id', ORG_ID),
      supabase.from('appointments').select('*').eq('org_id', ORG_ID),
      supabase.from('encounters').select('*').eq('org_id', ORG_ID),
      supabase.from('prescriptions').select('*').eq('org_id', ORG_ID),
      supabase.from('pharmacy_orders').select('*').eq('org_id', ORG_ID),
      supabase.from('referrals').select('*').eq('org_id', ORG_ID),
      supabase.from('ward_billing_ledger').select('*').eq('org_id', ORG_ID),
      supabase.from('inventory').select('*').eq('org_id', ORG_ID),
      supabase.from('notifications').select('*').eq('org_id', ORG_ID).order('created_at', { ascending: false }).limit(50),
    ]);
    setPatients((p.data as PatientRow[]) ?? []);
    setPractitioners((pr.data as PractitionerRow[]) ?? []);
    setAppointments((ap.data as AppointmentRow[]) ?? []);
    setEncounters((en.data as EncounterRow[]) ?? []);
    setPrescriptions((rx.data as PrescriptionRow[]) ?? []);
    setPharmacyOrders((po.data as PharmacyOrderRow[]) ?? []);
    setReferrals((rf.data as ReferralRow[]) ?? []);
    setWardLedger((wl.data as WardBillingLedgerRow[]) ?? []);
    setInventory((inv.data as InventoryRow[]) ?? []);
    setNotifications((nt.data as NotificationRow[]) ?? []);
  }, []);

  const logAudit = useCallback(async (action: string, detail: string) => {
    await supabase.from('audit_events').insert({
      id: `ae-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      org_id: ORG_ID,
      actor: practitioner?.name ?? 'system',
      role: practitioner?.role ?? 'system',
      action,
      detail,
    });
  }, [practitioner]);

  // Re-fetch whenever the signed-in practitioner changes -- not just once on
  // mount. ClinicProvider mounts at the app root and stays mounted across the
  // login screen, so its very first refresh() often fires before signIn()
  // has finished (or before an already-persisted session is recognized by
  // the Supabase client), landing under anonymous RLS and getting back
  // empty results for every table. Nothing used to retry after that, so
  // every screen looked permanently empty post-login until a hard page
  // reload happened to re-run refresh() at a moment the session was already
  // attached. Keying this effect on practitioner?.id re-runs refresh() the
  // moment AuthContext resolves a real practitioner (interactive sign-in,
  // session restoration on load, or switching accounts), so data always
  // shows up without requiring a manual refresh.
  useEffect(() => { refresh(); }, [refresh, practitioner?.id]);

  // One real-time channel per table, applying inserts/updates/deletes
  // directly onto local state so every screen reading from this context
  // reflects a remote mutation the instant it lands -- true zero-refresh
  // cross-device sync, not polling.
  useEffect(() => {
    const upsert = <T extends { id: string | number }>(setter: React.Dispatch<React.SetStateAction<T[]>>) =>
      (payload: any) => {
        setter((prev) => {
          if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== payload.old.id);
          const exists = prev.some((r) => r.id === payload.new.id);
          return exists ? prev.map((r) => (r.id === payload.new.id ? payload.new : r)) : [...prev, payload.new];
        });
      };

    const channels = [
      supabase.channel('rt-patients').on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, upsert(setPatients)).subscribe(),
      supabase.channel('rt-appointments').on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, upsert(setAppointments)).subscribe(),
      supabase.channel('rt-encounters').on('postgres_changes', { event: '*', schema: 'public', table: 'encounters' }, upsert(setEncounters)).subscribe(),
      supabase.channel('rt-prescriptions').on('postgres_changes', { event: '*', schema: 'public', table: 'prescriptions' }, upsert(setPrescriptions)).subscribe(),
      supabase.channel('rt-pharmacy_orders').on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_orders' }, (payload: any) => {
        upsert(setPharmacyOrders)(payload);
        if (payload.eventType === 'INSERT' && payload.new?.status === 'received') {
          const id = payload.new.id as string;
          setNewPharmacyOrderIds((prev) => new Set(prev).add(id));
          setTimeout(() => {
            setNewPharmacyOrderIds((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }, PHARMACY_FLASH_DURATION_MS);
        }
      }).subscribe(),
      supabase.channel('rt-referrals').on('postgres_changes', { event: '*', schema: 'public', table: 'referrals' }, upsert(setReferrals)).subscribe(),
      supabase.channel('rt-ward_billing_ledger').on('postgres_changes', { event: '*', schema: 'public', table: 'ward_billing_ledger' }, upsert(setWardLedger)).subscribe(),
      supabase.channel('rt-inventory').on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, upsert(setInventory)).subscribe(),
      supabase.channel('rt-notifications').on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, upsert(setNotifications)).subscribe(),
    ];
    return () => { channels.forEach((ch) => supabase.removeChannel(ch)); };
  }, []);

  // Turn new notifications addressed to me (or broadcast, practitioner_id
  // null) into a toast + chime -- CRITICAL_BYPASS triage gets the sharper
  // repeated tone, everything else a single soft note.
  useEffect(() => {
    for (const n of notifications) {
      if (seenNotificationIds.current.has(n.id)) continue;
      seenNotificationIds.current.add(n.id);
      if (!n.practitioner_id || n.practitioner_id === practitioner?.id) {
        const isCritical = n.type === 'critical_bypass';
        pushToast({
          tone: isCritical ? 'critical' : n.type === 'substitution_flag' ? 'warning' : n.type === 'prescription_authorized' ? 'ok' : 'info',
          title: n.message ?? 'Notification',
        });
        if (isCritical) playCriticalChime(); else playSoftChime();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications, practitioner?.id]);

  const value: ClinicState = {
    orgId: ORG_ID, patients, practitioners, appointments, encounters, prescriptions,
    pharmacyOrders, referrals, wardLedger, inventory, notifications, newPharmacyOrderIds,
    toasts, pushToast, dismissToast, logAudit, refresh,
  };
  return <ClinicCtx.Provider value={value}>{children}</ClinicCtx.Provider>;
}

export function useClinic() {
  const ctx = useContext(ClinicCtx);
  if (!ctx) throw new Error('useClinic must be used within ClinicProvider');
  return ctx;
}

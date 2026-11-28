import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { platformCall, type DepartmentRow, type StaffWithEmail } from '../lib/platformApi';
import { DepartmentsManager, StaffManager } from '../components/StaffManager';
import { subscriptionStatusLabel } from '../lib/labels';
import Shell from '../components/Shell';
import { useSection } from '../lib/nav';
import { Card, Btn, Pill, StatTile, inputCls } from '../components/ui';
import { useClinic } from '../context/ClinicContext';
import { supabase } from '../lib/supabaseClient';
import type { PatientRow, PractitionerRow } from '../types/db';
import { useBills } from '../hooks/useBills';
import { useBeds } from '../hooks/useHospitalSetup';
import { WorkingHoursSection } from '../components/admin/WorkingHours';
import { RatesSection } from '../components/admin/Rates';
import { BedsSection } from '../components/admin/Beds';
import { ReportsSection } from '../components/admin/Reports';
import { AuditLogSection } from '../components/admin/AuditLog';
import { balance, clinicToday, dayKey, holdsSlot, money, onDay } from '../lib/schedule';

function fmtRupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

/**
 * Hospital admin (/admin): today's numbers, staff and departments, working
 * hours, fees and the price list, wards and beds, reports, the audit log
 * and discharge billing. Each sidebar item is one section (?section=).
 */
type AdminSection = 'overview' | 'staff' | 'departments' | 'hours' | 'fees' | 'beds' | 'reports' | 'audit' | 'billing';
const TITLES: Record<AdminSection, string> = {
  overview: 'Overview', staff: 'Staff', departments: 'Departments', hours: 'Working hours', fees: 'Fees and price list',
  beds: 'Wards and beds', reports: 'Reports', audit: 'Audit log', billing: 'Discharge billing',
};

export default function AdminView() {
  const section = useSection<AdminSection>('overview');
  const { orgId, patients, practitioners, appointments, encounters, wardLedger, pharmacyOrders, pushToast, logAudit } = useClinic();
  const { bills } = useBills(orgId);
  const { beds } = useBeds(orgId);

  const doctors = useMemo(
    () => practitioners.filter((p) => p.role === 'surgeon' || p.role === 'physio'),
    [practitioners],
  );

  const pendingClearance = useMemo(
    () => patients.filter((p) => p.queue_status === 'pending_discharge_clearance'),
    [patients],
  );

  const today = clinicToday();
  const visitsToday = appointments.filter((a) => onDay(a, today) && holdsSlot(a.status)).length;
  const seenToday = appointments.filter((a) => onDay(a, today) && a.status === 'completed').length;
  const collectedToday = bills.filter((b) => b.status !== 'void' && b.paid_at && dayKey(new Date(b.paid_at)) === today).reduce((s, b) => s + b.paid, 0);
  const owed = bills.reduce((s, b) => s + balance(b), 0);
  const activeBeds = beds.filter((b) => b.active);
  const pendingPharmacy = pharmacyOrders.filter((o) => o.status === 'received' || o.status === 'preparing' || o.status === 'ready').length;

  return (
    <Shell title={TITLES[section]}>
      {section === 'overview' && (<>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6" data-testid="admin-overview">
        <StatTile label="Visits booked today" value={visitsToday} />
        <StatTile label="Seen today" value={seenToday} tone="ok" />
        <StatTile label="Collected today" value={money(collectedToday)} tone="accent" />
        <StatTile label="Balance due (all bills)" value={money(owed)} tone="danger" />
        <StatTile label="Beds occupied" value={`${activeBeds.filter((b) => b.patient_id).length} of ${activeBeds.length}`} tone="gate" />
        <StatTile label="Pharmacy orders waiting" value={pendingPharmacy} />
      </div>

      <PlanAndSeats practitionerCount={practitioners.length} />
      </>)}

      {section === 'fees' && <><FeeEditor doctors={doctors} pushToast={pushToast} /><RatesSection /></>}
      {section === 'hours' && <WorkingHoursSection />}
      {section === 'beds' && <BedsSection />}
      {section === 'reports' && <ReportsSection bills={bills} />}
      {section === 'audit' && <AuditLogSection />}

      {(section === 'staff' || section === 'departments') && <HospitalTeam section={section} />}

      {section === 'billing' && <DischargeSettlement
        patients={pendingClearance}
        wardLedger={wardLedger}
        encounters={encounters}
        pharmacyOrders={pharmacyOrders}
        pushToast={pushToast}
        logAudit={logAudit}
      />}
    </Shell>
  );
}

/* ---------------------------------------------------------------------- */
/* Plan & seats (subscription)                                            */
/* ---------------------------------------------------------------------- */

interface SeatUsage {
  plan: string;
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled';
  seat_limit: number;
  seats_used: number;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

const STATUS_TONE = { active: 'ok', trialing: 'accent', past_due: 'gate', canceled: 'danger' } as const;

/** Read-only view of this hospital's plan and how many of its user seats are
 * in use. The limit itself is enforced in the database (see
 * supabase/migrations) and can only be changed by the service role -- i.e.
 * your billing webhook or an admin SQL update -- never from this screen. */
function PlanAndSeats({ practitionerCount }: { practitionerCount: number }) {
  const [usage, setUsage] = useState<SeatUsage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('org_seat_usage');
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) { setFailed(true); return; }
      setUsage(row as SeatUsage);
    })();
    return () => { cancelled = true; };
    // practitionerCount: re-read when staff are added/removed.
  }, [practitionerCount]);

  if (failed) return null; // older database without the subscription migration
  if (!usage) return null;

  const pct = usage.seat_limit > 0 ? Math.min(100, Math.round((usage.seats_used / usage.seat_limit) * 100)) : 100;
  const nearLimit = pct >= 90;
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
  const renews = usage.subscription_status === 'trialing' ? fmtDate(usage.trial_ends_at) : fmtDate(usage.current_period_end);

  return (
    <Card className="mb-6" data-testid="plan-seats">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="text-base font-bold text-ink">Plan &amp; User Seats</div>
        <Pill tone={STATUS_TONE[usage.subscription_status]}>{subscriptionStatusLabel(usage.subscription_status)}</Pill>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-xl font-bold text-ink" data-testid="seats-used">{usage.seats_used} / {usage.seat_limit}</span>
        <span className="text-sm text-ink-soft">user seats in use · <span className="capitalize">{usage.plan}</span> plan</span>
      </div>
      <div
        className="mt-3 h-2 rounded-full bg-surface-2 overflow-hidden"
        role="progressbar" aria-label="User seats in use" aria-valuemin={0} aria-valuemax={usage.seat_limit} aria-valuenow={usage.seats_used}
      >
        <div className={`h-full rounded-full ${nearLimit ? 'bg-gate' : 'bg-accent-ink'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-ink-faint mt-2">
        {nearLimit
          ? 'You are close to your seat limit. Contact DigiYaan to add more seats before onboarding new staff.'
          : 'Each active staff account uses one seat. Patients never use a seat.'}
        {renews ? ` ${usage.subscription_status === 'trialing' ? 'Trial ends' : 'Current period ends'} ${renews}.` : ''}
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Doctor base fee alteration                                             */
/* ---------------------------------------------------------------------- */

function FeeEditor({
  doctors,
  pushToast,
}: {
  doctors: PractitionerRow[];
  pushToast: (t: { tone: 'critical' | 'warning' | 'ok' | 'info'; title: string; detail?: string }) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  function valueFor(doc: PractitionerRow): string {
    return drafts[doc.id] ?? String(doc.consult_fee ?? 0);
  }

  async function commitFee(doc: PractitionerRow) {
    const raw = drafts[doc.id];
    if (raw === undefined) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      pushToast({ tone: 'warning', title: 'Invalid fee', detail: 'Enter a non-negative number.' });
      return;
    }
    if (parsed === (doc.consult_fee ?? 0)) return;
    setSavingId(doc.id);
    const { error } = await supabase.from('practitioners').update({ consult_fee: parsed }).eq('id', doc.id);
    setSavingId(null);
    if (error) {
      pushToast({ tone: 'critical', title: 'Could not update fee', detail: error.message });
      return;
    }
    pushToast({ tone: 'ok', title: 'Consult fee updated', detail: `${doc.name} → ${fmtRupees(parsed)}` });
  }

  return (
    <Card className="mb-6">
      <div className="text-base font-bold text-ink mb-3">
        Consultation fee per doctor
      </div>
      <div className="flex flex-col divide-y divide-line">
        {doctors.map((doc) => (
          <div key={doc.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-ink">{doc.name}</div>
              <div className="text-xs text-ink-faint mt-0.5">
                {doc.title ?? (doc.role === 'surgeon' ? 'Surgeon' : 'Physiotherapist')}
                {doc.specialty ? ` · ${doc.specialty}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-faint text-sm">₹</span>
              <input
                type="number"
                min={0}
                data-testid="fee-input"
                aria-label={`Consultation fee for ${doc.name}`}
                className={`${inputCls} w-28`}
                value={valueFor(doc)}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                onBlur={() => commitFee(doc)}
                disabled={savingId === doc.id}
              />
            </div>
          </div>
        ))}
        {doctors.length === 0 && <div className="text-sm text-ink-faint py-2">No doctors on record.</div>}
      </div>
      <p className="text-xs text-ink-faint mt-3 leading-relaxed">
        A new fee applies to <span className="text-ink">future</span> consultations only. Past visits keep the
        fee that was charged at the time.
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Discharge balance settlement                                           */
/* ---------------------------------------------------------------------- */

interface WardLedgerLike { id: string; patient_id: string; description: string; amount: number }
interface EncounterLike { id: string; patient_id: string; consultation_fee: number | null }
interface PharmacyOrderLike { id: string; patient_id: string; items: { price: number }[] }

function DischargeSettlement({
  patients,
  wardLedger,
  encounters,
  pharmacyOrders,
  pushToast,
  logAudit,
}: {
  patients: PatientRow[];
  wardLedger: WardLedgerLike[];
  encounters: EncounterLike[];
  pharmacyOrders: PharmacyOrderLike[];
  pushToast: (t: { tone: 'critical' | 'warning' | 'ok' | 'info'; title: string; detail?: string }) => void;
  logAudit: (action: string, detail: string) => Promise<void>;
}) {
  const [clearingId, setClearingId] = useState<string | null>(null);

  async function handleClear(patient: PatientRow) {
    setClearingId(patient.id);

    const { error: encErr } = await supabase
      .from('encounters')
      .update({ payment_status: 'paid' })
      .eq('patient_id', patient.id);
    if (encErr) {
      setClearingId(null);
      pushToast({ tone: 'critical', title: 'Could not settle encounters', detail: encErr.message });
      return;
    }

    const { error: patErr } = await supabase
      .from('patients')
      .update({ queue_status: 'active_follow_up' })
      .eq('id', patient.id);
    setClearingId(null);
    if (patErr) {
      pushToast({ tone: 'critical', title: 'Could not update patient status', detail: patErr.message });
      return;
    }

    await logAudit('discharge-balance-cleared', patient.name);
    pushToast({ tone: 'ok', title: 'Balance cleared', detail: `${patient.name} moved to active follow-up.` });
  }

  return (
    <Card className="mb-6">
      <div className="text-base font-bold text-danger mb-3">
        Patients waiting for discharge payment
      </div>
      {patients.length === 0 ? (
        <div className="text-sm text-ink-faint py-2">No patients awaiting discharge clearance.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {patients.map((p) => {
            const lines = wardLedger.filter((l) => l.patient_id === p.id);
            const ledgerTotal = lines.reduce((sum, l) => sum + l.amount, 0);
            const consultTotal = encounters
              .filter((e) => e.patient_id === p.id)
              .reduce((sum, e) => sum + (e.consultation_fee || 0), 0);
            const pharmacyTotal = pharmacyOrders
              .filter((o) => o.patient_id === p.id)
              .reduce((sum, o) => sum + o.items.reduce((s, it) => s + (it.price || 0), 0), 0);
            const grandTotal = ledgerTotal + consultTotal + pharmacyTotal;

            return (
              <Card key={p.id} className="!bg-surface-2">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div>
                    <div className="text-sm font-semibold text-ink">{p.name}</div>
                    <div className="text-xs text-ink-faint mt-0.5">
                      {p.age != null ? `${p.age}y` : '—'} · {p.gender ?? '—'}
                    </div>
                  </div>
                  <Pill tone="gate">Pending discharge clearance</Pill>
                </div>

                <div className="text-[13px] font-semibold text-ink-soft mt-3 mb-1.5">
                  Ward billing ledger
                </div>
                {lines.length === 0 ? (
                  <div className="text-xs text-ink-faint">No ward ledger charges.</div>
                ) : (
                  <div className="flex flex-col divide-y divide-line">
                    {lines.map((l) => (
                      <div key={l.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="text-ink-soft">{l.description}</span>
                        <span className="font-mono text-ink">{fmtRupees(l.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between py-1.5 text-sm border-t border-line mt-1">
                  <span className="text-ink-faint">Ward ledger subtotal</span>
                  <span className="font-mono text-ink font-semibold">{fmtRupees(ledgerTotal)}</span>
                </div>

                <div className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-ink-faint">Consultation fees (encounters during stay)</span>
                  <span className="font-mono text-ink">{fmtRupees(consultTotal)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-ink-faint">Pharmacy charges</span>
                  <span className="font-mono text-ink">{fmtRupees(pharmacyTotal)}</span>
                </div>

                <div className="flex items-center justify-between pt-2.5 mt-1.5 border-t border-line-strong">
                  <span className="text-sm font-semibold text-ink">Grand total</span>
                  <span className="font-mono text-lg text-accent-ink font-bold">{fmtRupees(grandTotal)}</span>
                </div>

                <Btn
                  variant="glow"
                  className="mt-3"
                  data-testid="clear-payment"
                  onClick={() => handleClear(p)}
                  disabled={clearingId === p.id}
                >
                  {clearingId === p.id ? 'Clearing…' : 'Mark Payment Cleared'}
                </Btn>
              </Card>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Staff and departments (real logins, via the platform-admin function)   */
/* ---------------------------------------------------------------------- */

function HospitalTeam({ section }: { section: 'staff' | 'departments' }) {
  const { practitioner } = useAuth();
  const orgId = practitioner?.org_id ?? '';
  const [data, setData] = useState<{ hospital: { seat_limit: number }; departments: DepartmentRow[]; staff: StaffWithEmail[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!orgId) return;
    platformCall<{ hospital: { seat_limit: number }; departments: DepartmentRow[]; staff: StaffWithEmail[] }>('get_hospital', { orgId })
      .then(setData, (e) => setError(e.message));
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Card><p className="text-danger" role="alert">{error}</p></Card>;
  if (!data) return <p className="text-ink-soft">Loading…</p>;
  return section === 'staff'
    ? <StaffManager orgId={orgId} staff={data.staff} departments={data.departments} seatLimit={data.hospital.seat_limit} onChanged={load} />
    : <DepartmentsManager orgId={orgId} departments={data.departments} onChanged={load} />;
}

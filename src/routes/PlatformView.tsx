import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import {
  platformCall, type AuditEvent, type DepartmentRow, type HospitalSummary, type StaffWithEmail,
} from '../lib/platformApi';
import { NaadLogo } from '../components/Brand';
import { DepartmentsManager, StaffManager, TempPasswordNotice } from '../components/StaffManager';
import { Btn, Card, Field, Modal, Panel, Pill, SectionHead, StatTile, inputCls } from '../components/ui';
import { subscriptionStatusLabel } from '../lib/labels';

/**
 * DigiYaan Super admin console (/platform). Its own sign-in: super admins
 * are not hospital staff. Every read and write goes through the
 * platform-admin edge function, which re-checks the caller each time.
 */
export default function PlatformView() {
  const [state, setState] = useState<'loading' | 'signedOut' | 'notAdmin' | 'ready'>('loading');
  const [name, setName] = useState<string | null>(null);

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) { setState('signedOut'); return; }
    try {
      const me = await platformCall<{ platformAdmin: boolean; name: string | null }>('whoami');
      setName(me.name);
      setState(me.platformAdmin ? 'ready' : 'notAdmin');
    } catch {
      setState('notAdmin');
    }
  }, []);

  useEffect(() => {
    document.title = 'Super admin — Naad';
    queueMicrotask(() => { void check(); });
  }, [check]);

  async function signOut() {
    await supabase.auth.signOut();
    setState('signedOut');
  }

  if (state === 'loading') return <div className="min-h-screen flex items-center justify-center text-ink-soft">Loading…</div>;
  if (state === 'signedOut') return <PlatformSignIn onSignedIn={check} />;
  if (state === 'notAdmin') {
    return (
      <Centered>
        <h1 className="text-2xl mb-2">Not a super admin login</h1>
        <p className="text-ink-soft mb-6">This account can't open the DigiYaan Super admin console. Hospital staff sign in on the staff sign-in page.</p>
        <div className="flex gap-2">
          <Btn variant="glow" onClick={signOut}>Sign out</Btn>
          <Link to="/login" className="inline-flex items-center min-h-11 px-3 font-semibold">Staff sign-in</Link>
        </div>
      </Centered>
    );
  }
  return <Console name={name ?? 'Super admin'} onSignOut={signOut} />;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Panel className="max-w-[460px] w-full p-8 md:p-10">
        <div className="mb-7"><NaadLogo sub="DigiYaan super admin" /></div>
        {children}
      </Panel>
    </div>
  );
}

function PlatformSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) { setError('Wrong email or password.'); return; }
    onSignedIn();
  }

  return (
    <Centered>
      <h1 className="text-2xl mb-2">Super admin sign-in</h1>
      <p className="text-ink-soft mb-6">For DigiYaan staff who set up hospitals and their logins.</p>
      <form onSubmit={submit} data-testid="platform-login-form">
        <Field label="Email"><input data-testid="platform-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
        <Field label="Password"><input data-testid="platform-password" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        {error && <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
        <Btn type="submit" variant="glow" className="w-full mt-6" disabled={busy} data-testid="platform-submit">{busy ? 'Signing in…' : 'Sign in'}</Btn>
      </form>
    </Centered>
  );
}

/* ---------------------------------------------------------------------- */

function Console({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [params] = useSearchParams();
  const view = params.get('view') ?? 'hospitals';
  const hospitalId = params.get('hospital');
  const [menuOpen, setMenuOpen] = useState(false);
  const title = hospitalId ? 'Hospital' : view === 'activity' ? 'Activity log' : 'Hospitals';

  useEffect(() => { document.title = `${title} — Naad super admin`; }, [title]);

  const nav = (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-4 border-b border-white/10"><NaadLogo tone="light" sub="Super admin" /></div>
      <nav aria-label="Main" className="flex-1 px-3 py-4 flex flex-col gap-1">
        {[['hospitals', 'Hospitals', '/platform'], ['activity', 'Activity log', '/platform?view=activity']].map(([id, label, to]) => {
          const active = id === 'activity' ? view === 'activity' : view !== 'activity';
          return (
            <Link key={id} to={to} onClick={() => setMenuOpen(false)} data-testid={`platform-nav-${id}`} aria-current={active ? 'page' : undefined}
              className={`flex items-center min-h-11 rounded-lg px-3 text-[15px] font-medium ${active ? 'bg-sidebar-active text-sidebar-ink' : 'text-sidebar-faint hover:text-sidebar-ink hover:bg-white/5'}`}>
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-white/10">
        <div className="text-sm font-semibold text-sidebar-ink mb-3 truncate">{name}</div>
        <button type="button" onClick={onSignOut} data-testid="platform-sign-out" className="w-full min-h-11 rounded-lg text-sm font-semibold text-sidebar-ink hover:bg-white/5 border border-white/10">Sign out</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden md:block w-64 shrink-0 bg-sidebar sticky top-0 h-screen">{nav}</aside>
      <header className="md:hidden sticky top-0 z-40 bg-sidebar px-4 py-3 flex items-center justify-between">
        <NaadLogo tone="light" />
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className="min-h-11 min-w-11 rounded-lg text-sidebar-ink border border-white/10">☰</button>
      </header>
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="w-72 max-w-[85%] bg-sidebar h-full">{nav}</div>
          <button type="button" aria-label="Close menu" className="flex-1 bg-black/40" onClick={() => setMenuOpen(false)} />
        </div>
      )}
      <main id="main" className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
          {hospitalId ? <HospitalDetail orgId={hospitalId} /> : view === 'activity' ? <ActivityLog /> : <HospitalList />}
        </div>
      </main>
    </div>
  );
}

function fmtUsd(n: number) { return `$${n.toFixed(2)}`; }
const STATUS_TONE: Record<string, 'ok' | 'gate' | 'danger' | 'accent'> = { active: 'ok', trialing: 'accent', past_due: 'gate', canceled: 'danger' };

function HospitalList() {
  const [hospitals, setHospitals] = useState<HospitalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<{ orgId: string; adminEmail: string; tempPassword: string } | null>(null);

  const load = useCallback(() => {
    platformCall<{ hospitals: HospitalSummary[] }>('list_hospitals').then((r) => setHospitals(r.hospitals), (e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const totals = (hospitals ?? []).reduce((t, h) => ({
    seats: t.seats + h.seats_used, patients: t.patients + h.patient_count, ai: t.ai + h.ai_spent_this_month,
  }), { seats: 0, patients: 0, ai: 0 });

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <h1 className="text-2xl md:text-[28px]">Hospitals</h1>
        <Btn variant="glow" onClick={() => setAdding(true)} data-testid="add-hospital">+ Add hospital</Btn>
      </div>
      {error && <div className="mb-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
      {created && (
        <div className="mb-6">
          <TempPasswordNotice email={created.adminEmail} password={created.tempPassword} onClose={() => setCreated(null)} />
          <Link to={`/platform?hospital=${created.orgId}`} className="inline-block mt-2 font-semibold">Open the new hospital →</Link>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatTile label="Hospitals" value={hospitals?.length ?? '–'} />
        <StatTile label="Staff seats in use" value={totals.seats} />
        <StatTile label="Patients" value={totals.patients} />
        <StatTile label="AI spend this month" value={fmtUsd(totals.ai)} tone="accent" />
      </div>
      <div className="grid gap-3">
        {(hospitals ?? []).map((h) => (
          <Link key={h.id} to={`/platform?hospital=${h.id}`} data-testid="hospital-row"
            className="block bg-surface rounded-[var(--radius)] shadow-[var(--card-shadow)] p-5 hover:ring-2 hover:ring-accent text-ink">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-lg font-bold">{h.name}</div>
                <div className="text-sm text-ink-soft">{h.city ?? 'City not set'} · {h.plan} plan</div>
              </div>
              <Pill tone={STATUS_TONE[h.subscription_status] ?? 'default'}>{subscriptionStatusLabel(h.subscription_status)}</Pill>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><span className="text-ink-soft">Seats</span><div className="font-semibold">{h.seats_used} / {h.seat_limit}</div></div>
              <div><span className="text-ink-soft">Patients</span><div className="font-semibold">{h.patient_count}</div></div>
              <div><span className="text-ink-soft">AI this month</span><div className="font-semibold">{fmtUsd(h.ai_spent_this_month)} / {fmtUsd(Number(h.ai_monthly_budget_usd))}</div></div>
            </div>
          </Link>
        ))}
        {hospitals?.length === 0 && <Card><p className="text-ink-soft">No hospitals yet. Add the first one.</p></Card>}
      </div>
      {adding && <AddHospitalModal onClose={() => setAdding(false)} onCreated={(r) => { setAdding(false); setCreated(r); load(); }} />}
    </>
  );
}

function AddHospitalModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: { orgId: string; adminEmail: string; tempPassword: string }) => void }) {
  const [f, setF] = useState({ name: '', city: '', address: '', contactPhone: '', plan: 'trial', seatLimit: '10', aiBudgetUsd: '5', adminName: '', adminEmail: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      onCreated(await platformCall('create_hospital', f));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-xl mb-1">Add a hospital</h2>
      <p className="text-ink-soft text-sm mb-3">Creates the hospital and its first admin login. That admin can then add their own staff.</p>
      <form onSubmit={submit}>
        <Field label="Hospital name"><input data-testid="hospital-name" className={inputCls} value={f.name} onChange={set('name')} placeholder="e.g. Sahyadri Ortho Care" /></Field>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="City"><input className={inputCls} value={f.city} onChange={set('city')} /></Field>
          <Field label="Phone"><input className={inputCls} value={f.contactPhone} onChange={set('contactPhone')} /></Field>
        </div>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={set('address')} /></Field>
        <div className="grid grid-cols-3 gap-x-3">
          <Field label="Plan">
            <select className={inputCls} value={f.plan} onChange={set('plan')}>
              {['trial', 'pilot', 'basic', 'pro'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="User seats"><input className={inputCls} inputMode="numeric" value={f.seatLimit} onChange={set('seatLimit')} /></Field>
          <Field label="AI budget ($/month)"><input className={inputCls} inputMode="decimal" value={f.aiBudgetUsd} onChange={set('aiBudgetUsd')} /></Field>
        </div>
        <div className="mt-4 text-[15px] font-bold">First hospital admin</div>
        <Field label="Name"><input data-testid="hospital-admin-name" className={inputCls} value={f.adminName} onChange={set('adminName')} /></Field>
        <Field label="Email (their sign-in)"><input data-testid="hospital-admin-email" type="email" className={inputCls} value={f.adminEmail} onChange={set('adminEmail')} /></Field>
        {error && <div className="mt-4 text-sm text-danger bg-danger-soft rounded-lg px-3 py-2" role="alert">{error}</div>}
        <div className="mt-5 flex gap-2">
          <Btn type="submit" variant="glow" disabled={busy} data-testid="save-hospital">{busy ? 'Creating…' : 'Create hospital'}</Btn>
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </form>
    </Modal>
  );
}

interface HospitalDetailData { hospital: HospitalSummary; departments: DepartmentRow[]; staff: StaffWithEmail[] }

function HospitalDetail({ orgId }: { orgId: string }) {
  const [data, setData] = useState<HospitalDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    platformCall<HospitalDetailData>('get_hospital', { orgId }).then(setData, (e) => setError(e.message));
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Card><p className="text-danger" role="alert">{error}</p><Btn variant="primary" onClick={() => navigate('/platform')}>Back to hospitals</Btn></Card>;
  if (!data) return <p className="text-ink-soft">Loading…</p>;

  return (
    <>
      <Link to="/platform" className="inline-flex items-center min-h-11 font-semibold mb-2">← All hospitals</Link>
      <h1 className="text-2xl md:text-[28px] mb-6" data-testid="hospital-title">{data.hospital.name}</h1>
      <HospitalProfile hospital={data.hospital} onSaved={load} />
      <DepartmentsManager orgId={orgId} departments={data.departments} onChanged={load} />
      <StaffManager orgId={orgId} staff={data.staff} departments={data.departments} seatLimit={data.hospital.seat_limit} onChanged={load} />
    </>
  );
}

function HospitalProfile({ hospital, onSaved }: { hospital: HospitalSummary; onSaved: () => void }) {
  const [f, setF] = useState({
    name: hospital.name, city: hospital.city ?? '', address: hospital.address ?? '', contactPhone: hospital.contact_phone ?? '',
    billingEmail: hospital.billing_email ?? '', plan: hospital.plan, subscriptionStatus: hospital.subscription_status,
    seatLimit: String(hospital.seat_limit), aiBudgetUsd: String(hospital.ai_monthly_budget_usd),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await platformCall('update_hospital', { orgId: hospital.id, ...f });
      setMsg({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <SectionHead title="Profile and plan" desc="Only DigiYaan can change a hospital's plan, seats, AI budget and status." />
      <form onSubmit={submit}>
        <div className="grid md:grid-cols-2 gap-x-4">
          <Field label="Hospital name"><input className={inputCls} value={f.name} onChange={set('name')} /></Field>
          <Field label="City"><input className={inputCls} value={f.city} onChange={set('city')} /></Field>
          <Field label="Address"><input className={inputCls} value={f.address} onChange={set('address')} /></Field>
          <Field label="Phone"><input className={inputCls} value={f.contactPhone} onChange={set('contactPhone')} /></Field>
          <Field label="Billing email"><input className={inputCls} type="email" value={f.billingEmail} onChange={set('billingEmail')} /></Field>
          <Field label="Status">
            <select data-testid="hospital-status" className={inputCls} value={f.subscriptionStatus} onChange={set('subscriptionStatus')}>
              <option value="trialing">Trial</option>
              <option value="active">Active</option>
              <option value="past_due">Payment overdue</option>
              <option value="canceled">Suspended</option>
            </select>
          </Field>
          <Field label="Plan">
            <select className={inputCls} value={f.plan} onChange={set('plan')}>
              {['trial', 'pilot', 'basic', 'pro'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="User seats"><input data-testid="hospital-seats" className={inputCls} inputMode="numeric" value={f.seatLimit} onChange={set('seatLimit')} /></Field>
            <Field label="AI budget ($/month)"><input className={inputCls} inputMode="decimal" value={f.aiBudgetUsd} onChange={set('aiBudgetUsd')} /></Field>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Btn type="submit" variant="glow" disabled={busy} data-testid="save-hospital-profile">{busy ? 'Saving…' : 'Save changes'}</Btn>
          {msg && <span className={msg.ok ? 'text-ok text-sm font-semibold' : 'text-danger text-sm'} role="status">{msg.text}</span>}
        </div>
      </form>
    </Card>
  );
}

function ActivityLog() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    platformCall<{ events: AuditEvent[] }>('list_audit').then((r) => setEvents(r.events), (e) => setError(e.message));
  }, []);
  const label: Record<string, string> = {
    create_hospital: 'Added hospital', update_hospital: 'Edited hospital', add_department: 'Added department', update_department: 'Edited department',
    add_staff: 'Added staff', deactivate_staff: 'Deactivated staff', reactivate_staff: 'Reactivated staff', reset_password: 'Reset password',
  };
  return (
    <>
      <h1 className="text-2xl md:text-[28px] mb-6">Activity log</h1>
      {error && <p className="text-danger" role="alert">{error}</p>}
      <Card>
        <p className="text-ink-soft text-sm mb-3">Every change made in this console, and by hospital admins managing their own staff. Newest first.</p>
        <div className="flex flex-col divide-y divide-line">
          {(events ?? []).map((e) => (
            <div key={e.id} className="py-2.5 grid sm:grid-cols-[170px_1fr] gap-1" data-testid="audit-row">
              <div className="text-sm text-ink-soft font-mono">{new Date(e.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              <div>
                <span className="font-semibold">{label[e.action] ?? e.action}</span>
                <span className="text-ink-soft"> · {e.actor}{e.actor_role === 'hospital_admin' ? ' (hospital admin)' : ''}</span>
                {e.detail && <div className="text-sm text-ink-soft">{e.detail}</div>}
              </div>
            </div>
          ))}
          {events?.length === 0 && <p className="text-ink-soft py-2">Nothing yet.</p>}
        </div>
      </Card>
    </>
  );
}

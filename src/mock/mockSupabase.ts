import * as seed from './seed';
import * as physioSeed from './physioSeed';
import * as receptionSeed from './receptionSeed';
import * as adminSeed from './adminSeed';
import * as pharmacySeed from './pharmacySeed';
import { handle as platformAdminHandle } from '../../supabase/functions/platform-admin/handler';

/**
 * A minimal in-memory implementation of the subset of the @supabase/supabase-js
 * v2 API this app actually uses (from().select/insert/update/eq/order/single,
 * channel().on('postgres_changes').subscribe(), auth.signInWithPassword/
 * signOut/getSession/onAuthStateChange). Selected via VITE_USE_MOCK so local
 * dev and the Playwright suite never touch the live production database --
 * every component/hook calls the exact same `supabase.from(...)` / `supabase
 * .channel(...)` surface regardless of which implementation is active, so
 * there is exactly one code path to test.
 */

type Row = Record<string, any>;

/**
 * Demo dates move with the calendar. The seed was written as if "today" were
 * SEED_DAY; every timestamp in it is shifted by whole days so the demo always
 * happens today (queues, timers, "charges added today", upcoming
 * appointments). Times of day are kept. The Playwright builds set
 * VITE_FREEZE_DEMO_DATES=1 so tests stay deterministic.
 */
const SEED_DAY = '2026-08-29';
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDates(value: any, ms: number): any {
  if (typeof value === 'string') {
    if (ISO_TS.test(value)) return new Date(Date.parse(value) + ms).toISOString();
    if (ISO_DAY.test(value)) return new Date(Date.parse(value) + ms).toISOString().slice(0, 10);
    return value;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => { value[i] = shiftDates(v, ms); });
    return value;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((k) => { value[k] = shiftDates(value[k], ms); });
    return value;
  }
  return value;
}

const DAY_MS = 86_400_000;
const dayShiftMs = import.meta.env.VITE_FREEZE_DEMO_DATES === '1'
  ? 0
  : Math.round((Date.parse(localDay(new Date())) - Date.parse(SEED_DAY)) / DAY_MS) * DAY_MS;
type Listener = (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Row; old: Row | null }) => void;

const TABLES: Record<string, Row[]> = {
  organizations: [
    { id: seed.ORG_ID, name: 'Naad Demo Hospital', city: 'Pune', ai_monthly_budget_usd: 45, plan: 'pilot', subscription_status: 'active', seat_limit: 25, address: 'FC Road, Pune', contact_phone: '+91 20 4000 1234', billing_email: null },
    { id: seed.ORG2_ID, name: 'Sahyadri Ortho Care', city: 'Nashik', ai_monthly_budget_usd: 20, plan: 'trial', subscription_status: 'trialing', seat_limit: 10, address: null, contact_phone: null, billing_email: null },
  ],
  practitioners: [...(seed.practitioners as unknown as Row[]), ...(seed.extraPractitioners as unknown as Row[])],
  platform_admins: seed.platformAdmins as unknown as Row[],
  platform_audit: seed.platformAudit as unknown as Row[],
  departments: seed.departments as unknown as Row[],
  ai_usage_log: [],
  physiotherapy_plans: physioSeed.plans as unknown as Row[],
  therapy_sessions: physioSeed.sessions as unknown as Row[],
  exercise_library: physioSeed.exercises as unknown as Row[],
  patients: [...seed.patients, ...receptionSeed.patients] as unknown as Row[],
  appointments: [...seed.appointments, ...receptionSeed.appointments] as unknown as Row[],
  bills: receptionSeed.bills as unknown as Row[],
  service_rates: adminSeed.rates as unknown as Row[],
  beds: adminSeed.beds as unknown as Row[],
  encounters: seed.encounters as unknown as Row[],
  prescriptions: seed.prescriptions as unknown as Row[],
  pharmacy_orders: seed.pharmacyOrders as unknown as Row[],
  referrals: seed.referrals as unknown as Row[],
  ward_billing_ledger: seed.wardBillingLedger as unknown as Row[],
  inventory: [...seed.inventory, ...pharmacySeed.inventory] as unknown as Row[],
  stock_batches: pharmacySeed.batches as unknown as Row[],
  vitals: pharmacySeed.vitals as unknown as Row[],
  documents: seed.documents as unknown as Row[],
  notifications: seed.notifications as unknown as Row[],
  audit_events: seed.auditEvents as unknown as Row[],
};

if (dayShiftMs !== 0) Object.values(TABLES).forEach((rows) => shiftDates(rows, dayShiftMs));

const tableListeners: Record<string, Set<Listener>> = {};
function notify(table: string, payload: Parameters<Listener>[0]) {
  (tableListeners[table] ?? new Set()).forEach((cb) => cb(payload));
}

let idCounter = 1000;
function genId(prefix: string) { idCounter += 1; return `${prefix}-${idCounter}`; }

type Filter = { col: string; op: 'eq' | 'neq' | 'in' | 'gte'; val: any };

class MockBuilder {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private wantSingle: 'single' | 'maybeSingle' | null = null;
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private table: string;

  // The real @supabase/supabase-js query builder is "thenable" but fires its
  // request EAGERLY -- the request goes out as soon as the synchronous chain
  // of .eq()/.update()/etc. calls finishes (on the next microtask), whether
  // or not the caller ever awaits it or attaches a .then(). A caller that
  // fires a query and doesn't await it (e.g. a debounced autosave) still
  // expects the write to happen. This mock used to only run its query
  // inside `.then()`, so an un-awaited `supabase.from(...).update(...)`
  // (exactly the pattern DoctorView's persistNote/persistRx debounce use)
  // silently never executed -- found via e2e/doctor-module2.spec.ts's
  // doctor-edit -> patient-portal round trip coming back empty. Scheduling
  // the run on a microtask from the constructor mirrors the real client:
  // by the time it fires, the whole synchronous .eq()/.select()/etc. chain
  // (all called synchronously right after construction) has already been
  // applied, and `run()` executes exactly once no matter how many times the
  // result is awaited.
  private resultPromise: Promise<{ data: any; error: any }>;

  constructor(table: string) {
    this.table = table;
    this.resultPromise = new Promise((resolve) => {
      queueMicrotask(() => resolve(this.run()));
    });
  }

  select(_cols?: string) { if (this.op === 'select' && !this.payload) this.op = 'select'; return this; }
  eq(col: string, val: any) { this.filters.push({ col, op: 'eq', val }); return this; }
  neq(col: string, val: any) { this.filters.push({ col, op: 'neq', val }); return this; }
  in(col: string, vals: any[]) { this.filters.push({ col, op: 'in', val: vals }); return this; }
  gte(col: string, val: any) { this.filters.push({ col, op: 'gte', val }); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orderCol = col; this.orderAsc = opts?.ascending ?? true; return this; }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.wantSingle = 'single'; return this; }
  maybeSingle() { this.wantSingle = 'maybeSingle'; return this; }

  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this; }
  update(partial: Row) { this.op = 'update'; this.payload = partial; return this; }
  delete() { this.op = 'delete'; return this; }

  private applyFilters(rows: Row[]) {
    return rows.filter((r) => this.filters.every((f) => {
      if (f.op === 'eq') return r[f.col] === f.val;
      if (f.op === 'neq') return r[f.col] !== f.val;
      if (f.op === 'in') return (f.val as any[]).includes(r[f.col]);
      if (f.op === 'gte') return String(r[f.col] ?? '') >= String(f.val);
      return true;
    }));
  }

  private run(): { data: any; error: any } {
    const table = TABLES[this.table];
    if (!table) return { data: null, error: { message: `mock: unknown table "${this.table}"` } };

    if (this.op === 'select') {
      let rows = this.applyFilters(table);
      if (this.orderCol) {
        rows = [...rows].sort((a, b) => {
          const av = a[this.orderCol!]; const bv = b[this.orderCol!];
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (this.orderAsc ? 1 : -1);
        });
      }
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      if (this.wantSingle) {
        if (rows.length === 0) return this.wantSingle === 'maybeSingle' ? { data: null, error: null } : { data: null, error: { message: 'no rows' } };
        return { data: { ...rows[0] }, error: null };
      }
      return { data: rows.map((r) => ({ ...r })), error: null };
    }

    if (this.op === 'insert') {
      const rowsIn = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      // Mirrors the real unique (org_id, name) constraint on departments.
      if (this.table === 'departments' && rowsIn.some((r) => table.some((d) => d.org_id === r.org_id && d.name === r.name))) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
      }
      // Mirrors the real unique (org_id, number) constraint on bills.
      if (this.table === 'bills' && rowsIn.some((r) => table.some((b) => b.org_id === r.org_id && b.number === r.number))) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint "bills_org_id_number_key"' } };
      }
      const inserted: Row[] = rowsIn.map((r) => {
        // Identity (bigint) ids for the tables that have them in Postgres.
        const numeric = this.table === 'inventory' || this.table === 'exercise_library';
        const nextNum = () => Math.max(0, ...table.map((x) => Number(x.id) || 0)) + 1;
        const row = { id: r.id ?? (numeric ? nextNum() : genId(this.table.slice(0, 4))), ...r };
        // Like the real column default (ts timestamptz default now()).
        if (this.table === 'audit_events' && !row.ts) row.ts = new Date().toISOString();
        table.push(row);
        notify(this.table, { eventType: 'INSERT', new: { ...row }, old: null });
        return row;
      });
      const data = this.wantSingle ? { ...inserted[0] } : inserted.map((r) => ({ ...r }));
      return { data, error: null };
    }

    if (this.op === 'update') {
      const targets = this.applyFilters(table);
      targets.forEach((row) => {
        const old = { ...row };
        Object.assign(row, this.payload);
        notify(this.table, { eventType: 'UPDATE', new: { ...row }, old });
      });
      const data = this.wantSingle ? (targets[0] ? { ...targets[0] } : null) : targets.map((r) => ({ ...r }));
      return { data, error: null };
    }

    if (this.op === 'delete') {
      const targets = this.applyFilters(table);
      targets.forEach((row) => {
        const idx = table.indexOf(row);
        if (idx >= 0) table.splice(idx, 1);
        notify(this.table, { eventType: 'DELETE', new: {}, old: { ...row } });
      });
      return { data: targets.map((r) => ({ ...r })), error: null };
    }

    return { data: null, error: { message: 'unsupported op' } };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.resultPromise.then(onfulfilled, onrejected);
  }
}

class MockChannel {
  private subs: { table: string; cb: Listener }[] = [];
  constructor(_name: string) {}
  on(_type: 'postgres_changes', filter: { event: string; schema: string; table: string; filter?: string }, cb: Listener) {
    const wrapped: Listener = (payload) => {
      if (filter.filter) {
        const [col, , val] = filter.filter.split(/=eq\.|=/);
        const target = filter.filter.includes('=eq.') ? filter.filter.split('=eq.')[1] : val;
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (row && String(row[col]) !== String(target)) return;
      }
      if (filter.event !== '*' && filter.event !== payload.eventType) return;
      cb(payload);
    };
    this.subs.push({ table: filter.table, cb: wrapped });
    return this;
  }
  subscribe(cb?: (status: string) => void) {
    this.subs.forEach(({ table, cb: wrapped }) => {
      if (!tableListeners[table]) tableListeners[table] = new Set();
      tableListeners[table].add(wrapped);
    });
    cb?.('SUBSCRIBED');
    return this;
  }
  unsubscribe() {
    this.subs.forEach(({ table, cb }) => tableListeners[table]?.delete(cb));
    return Promise.resolve('ok');
  }
}

type AuthUser = { id: string; email: string; user_metadata?: Record<string, unknown> };
type MockSession = { user: AuthUser; access_token: string };
type AuthChangeCb = (event: string, session: MockSession | null) => void;

// Demo sign-in survives a page refresh (per browser tab), like the real
// Supabase client. The demo data itself still resets on reload.
const SESSION_KEY = 'naad-mock-session';
function loadSession(): MockSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as MockSession) : null;
  } catch {
    return null;
  }
}
function saveSession(session: MockSession | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: sign-in just won't survive a refresh */
  }
}

class MockAuth {
  private session: MockSession | null = loadSession();
  private listeners = new Set<AuthChangeCb>();

  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const cred = seed.MOCK_CREDENTIALS[email];
    if (!cred || cred.password !== password) {
      return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
    }
    const user: AuthUser = { id: cred.userId, email, user_metadata: { ...(cred.metadata ?? {}) } };
    this.session = { user, access_token: 'mock-access-token' };
    saveSession(this.session);
    this.listeners.forEach((cb) => cb('SIGNED_IN', this.session));
    return { data: { user, session: this.session }, error: null };
  }

  async signOut() {
    this.session = null;
    saveSession(null);
    this.listeners.forEach((cb) => cb('SIGNED_OUT', null));
    return { error: null };
  }

  async getSession() {
    return { data: { session: this.session }, error: null };
  }

  /** Demo mode sends no email; the UI shows the same neutral message. */
  async resetPasswordForEmail(_email: string, _opts?: { redirectTo?: string }) {
    return { data: {}, error: null };
  }

  async getUser() {
    return this.session
      ? { data: { user: this.session.user }, error: null }
      : { data: { user: null }, error: { message: 'Not signed in' } };
  }

  /** Signed-in user changes their own password / metadata (first sign-in). */
  async updateUser(attrs: { password?: string; data?: Record<string, unknown> }) {
    if (!this.session) return { data: { user: null }, error: { message: 'Not signed in' } };
    const entry = Object.entries(seed.MOCK_CREDENTIALS).find(([, c]) => c.userId === this.session!.user.id);
    if (entry) {
      if (attrs.password) entry[1].password = attrs.password;
      if (attrs.data) entry[1].metadata = { ...(entry[1].metadata ?? {}), ...attrs.data };
    }
    this.session.user.user_metadata = { ...(this.session.user.user_metadata ?? {}), ...(attrs.data ?? {}) };
    saveSession(this.session);
    return { data: { user: this.session.user }, error: null };
  }

  /** Service-role user admin, as used by the platform-admin function. */
  admin = {
    createUser: async (a: { email: string; password: string; user_metadata?: Record<string, unknown> }) => {
      if (seed.MOCK_CREDENTIALS[a.email]) return { data: null, error: { message: 'User already registered' } };
      const id = genId('auth');
      seed.MOCK_CREDENTIALS[a.email] = { password: a.password, userId: id, metadata: a.user_metadata };
      return { data: { user: { id, email: a.email } }, error: null };
    },
    getUserById: async (id: string) => {
      const entry = Object.entries(seed.MOCK_CREDENTIALS).find(([, c]) => c.userId === id);
      return { data: { user: entry ? { id, email: entry[0] } : null }, error: null };
    },
    updateUserById: async (id: string, a: { password?: string; user_metadata?: Record<string, unknown> }) => {
      const entry = Object.entries(seed.MOCK_CREDENTIALS).find(([, c]) => c.userId === id);
      if (!entry) return { data: null, error: { message: 'User not found' } };
      if (a.password) entry[1].password = a.password;
      if (a.user_metadata) entry[1].metadata = { ...(entry[1].metadata ?? {}), ...a.user_metadata };
      return { data: {}, error: null };
    },
    deleteUser: async (id: string) => {
      const entry = Object.entries(seed.MOCK_CREDENTIALS).find(([, c]) => c.userId === id);
      if (entry) delete seed.MOCK_CREDENTIALS[entry[0]];
      return { data: {}, error: null };
    },
  };

  onAuthStateChange(cb: AuthChangeCb) {
    this.listeners.add(cb);
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(cb) } } };
  }
}

export function createMockSupabaseClient() {
  const auth = new MockAuth();
  // Demo mode runs the REAL platform-admin handler against the in-memory
  // tables, so the Super admin console behaves exactly as it will live.
  const serviceClient = () => ({ from: (table: string) => new MockBuilder(table), auth });
  async function invokePlatformAdmin(body: unknown) {
    const res = await platformAdminHandle(
      new Request('http://mock/functions/v1/platform-admin', {
        method: 'POST',
        headers: { authorization: 'Bearer mock', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      {
        env: () => 'mock',
        createClient: serviceClient,
        randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      },
    );
    const json = await res.json();
    return res.ok
      ? { data: json, error: null }
      : { data: null, error: { message: json.error ?? 'Request failed', context: { json: async () => json } } };
  }
  return {
    from: (table: string) => new MockBuilder(table),
    channel: (name: string) => new MockChannel(name),
    removeChannel: (ch: MockChannel) => ch.unsubscribe(),
    auth,
    // Mirrors the org_seat_usage() SQL function (supabase/migrations).
    rpc: async (fn: string) => {
      if (fn === 'audit_chain_check') {
        // The demo has no hashes to check; report every entry as checked.
        const { data: sess } = await auth.getSession();
        const me = TABLES.practitioners.find((p) => p.auth_user_id === sess.session?.user.id);
        if (me?.role !== 'admin') return { data: null, error: { message: 'admins_only' } };
        return { data: [{ checked: TABLES.audit_events.filter((a) => a.org_id === me.org_id).length, broken_id: null }], error: null };
      }
      if (fn !== 'org_seat_usage') return { data: null, error: { message: `mock: unknown rpc "${fn}"` } };
      // Like the real function: the signed-in staff member's own hospital.
      const { data: sess } = await auth.getSession();
      const me = TABLES.practitioners.find((p) => p.auth_user_id === sess.session?.user.id);
      const used = TABLES.practitioners.filter((p) => p.active && p.org_id === (me?.org_id ?? seed.ORG_ID)).length;
      return {
        data: [{ plan: 'pilot', subscription_status: 'active', seat_limit: 25, seats_used: used, trial_ends_at: null, current_period_end: null }],
        error: null,
      };
    },
    // No edge functions in mock mode (no real backend to run them against).
    // Callers -- currently just the Clinical Whisperer's AI prompt fetch --
    // are written to treat `fallback: true` exactly like "AI unavailable"
    // and drop back to their static list, so this keeps mock/test builds
    // working without ever reaching a real function.
    functions: {
      invoke: async (name: string, opts?: { body?: unknown }) => name === 'platform-admin' ? invokePlatformAdmin(opts?.body) : ({
        data: { prompts: null, fallback: true, reason: 'mock: edge functions not available' },
        error: null,
      }),
    },
  };
}

export type MockSupabaseClient = ReturnType<typeof createMockSupabaseClient>;

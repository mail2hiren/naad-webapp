import * as seed from './seed';

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
type Listener = (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Row; old: Row | null }) => void;

const TABLES: Record<string, Row[]> = {
  organizations: [{ id: seed.ORG_ID, name: 'DigiYaan Ambient AI Healthcare', city: 'Pune', ai_monthly_budget_usd: 45 }],
  practitioners: seed.practitioners as unknown as Row[],
  patients: seed.patients as unknown as Row[],
  appointments: seed.appointments as unknown as Row[],
  encounters: seed.encounters as unknown as Row[],
  prescriptions: seed.prescriptions as unknown as Row[],
  pharmacy_orders: seed.pharmacyOrders as unknown as Row[],
  referrals: seed.referrals as unknown as Row[],
  ward_billing_ledger: seed.wardBillingLedger as unknown as Row[],
  inventory: seed.inventory as unknown as Row[],
  documents: seed.documents as unknown as Row[],
  notifications: seed.notifications as unknown as Row[],
  audit_events: seed.auditEvents as unknown as Row[],
};

const tableListeners: Record<string, Set<Listener>> = {};
function notify(table: string, payload: Parameters<Listener>[0]) {
  (tableListeners[table] ?? new Set()).forEach((cb) => cb(payload));
}

let idCounter = 1000;
function genId(prefix: string) { idCounter += 1; return `${prefix}-${idCounter}`; }

type Filter = { col: string; op: 'eq' | 'neq' | 'in'; val: any };

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
      const inserted: Row[] = rowsIn.map((r) => {
        const row = { id: r.id ?? genId(this.table.slice(0, 4)), ...r };
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

type AuthUser = { id: string; email: string };
type AuthChangeCb = (event: string, session: { user: AuthUser } | null) => void;

class MockAuth {
  private session: { user: AuthUser } | null = null;
  private listeners = new Set<AuthChangeCb>();

  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const cred = seed.MOCK_CREDENTIALS[email];
    if (!cred || cred.password !== password) {
      return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
    }
    const user: AuthUser = { id: cred.userId, email };
    this.session = { user };
    this.listeners.forEach((cb) => cb('SIGNED_IN', this.session));
    return { data: { user, session: this.session }, error: null };
  }

  async signOut() {
    this.session = null;
    this.listeners.forEach((cb) => cb('SIGNED_OUT', null));
    return { error: null };
  }

  async getSession() {
    return { data: { session: this.session }, error: null };
  }

  onAuthStateChange(cb: AuthChangeCb) {
    this.listeners.add(cb);
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(cb) } } };
  }
}

export function createMockSupabaseClient() {
  return {
    from: (table: string) => new MockBuilder(table),
    channel: (name: string) => new MockChannel(name),
    removeChannel: (ch: MockChannel) => ch.unsubscribe(),
    auth: new MockAuth(),
    // No edge functions in mock mode (no real backend to run them against).
    // Callers -- currently just the Clinical Whisperer's AI prompt fetch --
    // are written to treat `fallback: true` exactly like "AI unavailable"
    // and drop back to their static list, so this keeps mock/test builds
    // working without ever reaching a real function.
    functions: {
      invoke: async (_name: string, _opts?: unknown) => ({
        data: { prompts: null, fallback: true, reason: 'mock: edge functions not available' },
        error: null,
      }),
    },
  };
}

export type MockSupabaseClient = ReturnType<typeof createMockSupabaseClient>;

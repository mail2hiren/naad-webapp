// platform-admin: who may do what, and that every change is safe and audited.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, type Deps } from '../../supabase/functions/platform-admin/handler.ts';

type Row = Record<string, any>;
type Db = Record<string, Row[]>;

function seed(): Db {
  return {
    platform_admins: [{ auth_user_id: 'u-owner', name: 'Hiren (DigiYaan)' }],
    organizations: [
      { id: 'org1', name: 'Naad Demo Hospital', city: 'Pune', plan: 'pilot', seat_limit: 3, subscription_status: 'active', ai_monthly_budget_usd: 5 },
      { id: 'org2', name: 'Other Hospital', city: 'Mumbai', plan: 'trial', seat_limit: 10, subscription_status: 'trialing', ai_monthly_budget_usd: 5 },
    ],
    practitioners: [
      { id: 'pr-admin1', org_id: 'org1', auth_user_id: 'u-admin1', name: 'Raj', role: 'admin', active: true },
      { id: 'pr-recep1', org_id: 'org1', auth_user_id: 'u-recep1', name: 'Sunita', role: 'receptionist', active: true },
      { id: 'pr-admin2', org_id: 'org2', auth_user_id: 'u-admin2', name: 'Other Admin', role: 'admin', active: true },
    ],
    departments: [{ id: 'dep-ortho2', org_id: 'org2', name: 'Orthopaedics', specialty: 'Orthopedics', active: true }],
    patients: [{ id: 'p1', org_id: 'org1' }],
    ai_usage_log: [],
    platform_audit: [],
  };
}

class Q {
  private f: ((r: Row) => boolean)[] = [];
  private patch: Row | null = null;
  private db: Db;
  private t: string;
  constructor(db: Db, t: string) { this.db = db; this.t = t; }
  select() { return this; }
  order() { return this; }
  limit() { return this; }
  eq(c: string, v: unknown) { this.f.push((r) => r[c] === v); return this; }
  gte(c: string, v: string) { this.f.push((r) => String(r[c] ?? '') >= v); return this; }
  update(p: Row) { this.patch = p; return this; }
  private rows() { return (this.db[this.t] ?? []).filter((r) => this.f.every((fn) => fn(r))); }
  async maybeSingle() { return { data: this.rows()[0] ?? null, error: null }; }
  then<T>(resolve: (v: { data: Row[] | null; error: null }) => T) {
    if (this.patch) { this.rows().forEach((r) => Object.assign(r, this.patch)); return Promise.resolve(resolve({ data: null, error: null })); }
    return Promise.resolve(resolve({ data: this.rows(), error: null }));
  }
}

function fakeClient(db: Db, users: Map<string, Row>, caller: string | null) {
  return (_u: string, _k: string, opts?: Row) => ({
    auth: {
      async getUser() {
        const signed = opts?.global?.headers?.Authorization && caller;
        return signed ? { data: { user: { id: caller } }, error: null } : { data: { user: null }, error: { message: 'no' } };
      },
      admin: {
        async createUser(a: Row) {
          if ([...users.values()].some((u) => u.email === a.email)) return { data: null, error: { message: 'User already registered' } };
          const id = `u-new-${users.size + 1}`;
          users.set(id, { id, email: a.email, password: a.password, user_metadata: a.user_metadata });
          return { data: { user: { id } }, error: null };
        },
        async getUserById(id: string) { return { data: { user: users.get(id) ?? null }, error: null }; },
        async updateUserById(id: string, a: Row) { Object.assign(users.get(id)!, a); return { data: {}, error: null }; },
        async deleteUser(id: string) { users.delete(id); return { data: {}, error: null }; },
      },
    },
    from(t: string) {
      const q = new Q(db, t);
      return {
        select: () => q.select(),
        update: (p: Row) => q.update(p),
        async insert(row: Row) {
          if (t === 'departments' && (db.departments ?? []).some((d) => d.org_id === row.org_id && d.name === row.name)) {
            return { data: null, error: { message: 'duplicate key' } };
          }
          (db[t] ??= []).push({ ts: new Date().toISOString(), ...row });
          return { data: null, error: null };
        },
      };
    },
  });
}

let counter = 0;
function deps(db: Db, users: Map<string, Row>, caller: string | null): Deps {
  return {
    env: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' } as Record<string, string>)[k],
    createClient: fakeClient(db, users, caller),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + ++counter) % 256),
  };
}

async function call(caller: string | null, body: Row, db = seed(), users = new Map<string, Row>()) {
  const req = new Request('https://x.supabase.co/functions/v1/platform-admin', {
    method: 'POST',
    headers: caller ? { authorization: 'Bearer jwt', 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await handle(req, deps(db, users, caller));
  return { res, json: await res.json(), db, users };
}

test('no session is refused', async () => {
  const { res } = await call(null, { action: 'list_hospitals' });
  assert.equal(res.status, 401);
});

test('whoami tells the console whether the caller is a super admin', async () => {
  assert.deepEqual((await call('u-owner', { action: 'whoami' })).json, { platformAdmin: true, name: 'Hiren (DigiYaan)' });
  assert.equal((await call('u-recep1', { action: 'whoami' })).json.platformAdmin, false);
});

test('ordinary staff and hospital admins cannot use super admin actions', async () => {
  for (const [who, action] of [['u-recep1', 'list_hospitals'], ['u-admin1', 'list_hospitals'], ['u-admin1', 'create_hospital'], ['u-admin1', 'update_hospital'], ['u-recep1', 'add_staff']]) {
    const { res } = await call(who, { action, orgId: 'org1' });
    assert.equal(res.status, 403, `${who} ${action}`);
  }
});

test('super admin creates a hospital with its first admin, who must change the password', async () => {
  const logs: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
  let out;
  try {
    out = await call('u-owner', { action: 'create_hospital', name: 'Sahyadri Ortho Care', city: 'Nashik', plan: 'pilot', seatLimit: 12, aiBudgetUsd: 20, adminName: 'Meera Joshi', adminEmail: 'Meera@Sahyadri.in' });
  } finally {
    console.error = orig;
  }
  const { res, json, db, users } = out;
  assert.equal(res.status, 200);
  assert.match(json.orgId, /^sahyadri-ortho-care-/);
  assert.equal(json.tempPassword.length, 12);
  const org = db.organizations.find((o) => o.id === json.orgId)!;
  assert.equal(org.seat_limit, 12);
  assert.equal(org.subscription_status, 'active');
  const pr = db.practitioners.find((p) => p.org_id === json.orgId)!;
  assert.equal(pr.role, 'admin');
  const user = users.get(pr.auth_user_id)!;
  assert.equal(user.email, 'meera@sahyadri.in');
  assert.equal(user.user_metadata.must_change_password, true);
  assert.equal(db.platform_audit.at(-1)!.action, 'create_hospital');
  assert.ok(logs.every((l) => !l.includes(json.tempPassword)), 'temp password must never be logged');
});

test('a hospital admin can add staff to their own hospital only', async () => {
  const own = await call('u-admin1', { action: 'add_staff', orgId: 'org1', name: 'Dr. Asha Rao', email: 'asha@demo.in', role: 'physio', specialty: 'Physiotherapy' });
  assert.equal(own.res.status, 200);
  assert.equal(own.db.practitioners.at(-1)!.org_id, 'org1');
  assert.equal(own.db.platform_audit.at(-1)!.actor_role, 'hospital_admin');
  const other = await call('u-admin1', { action: 'add_staff', orgId: 'org2', name: 'X', email: 'x@demo.in', role: 'receptionist' });
  assert.equal(other.res.status, 403);
  assert.equal(other.users.size, 0, 'no login created for a refused call');
});

test('the seat limit is enforced before a login is created', async () => {
  const db = seed();
  const users = new Map<string, Row>();
  assert.equal((await call('u-owner', { action: 'add_staff', orgId: 'org1', name: 'A', email: 'a@x.in', role: 'pharmacist' }, db, users)).res.status, 200);
  const full = await call('u-owner', { action: 'add_staff', orgId: 'org1', name: 'B', email: 'b@x.in', role: 'pharmacist' }, db, users);
  assert.equal(full.res.status, 409);
  assert.match(full.json.error, /seats/);
  assert.equal(users.size, 1);
});

test('doctors and physios need a specialty; departments must belong to the hospital', async () => {
  assert.equal((await call('u-owner', { action: 'add_staff', orgId: 'org2', name: 'Dr X', email: 'dx@x.in', role: 'surgeon' })).res.status, 400);
  const wrongDep = await call('u-owner', { action: 'add_staff', orgId: 'org1', name: 'Dr Y', email: 'dy@x.in', role: 'surgeon', specialty: 'Orthopedics', departmentId: 'dep-ortho2' });
  assert.equal(wrongDep.res.status, 400);
});

test('a duplicate email is refused clearly', async () => {
  const db = seed();
  const users = new Map<string, Row>([['u-exist', { id: 'u-exist', email: 'taken@x.in' }]]);
  const r = await call('u-owner', { action: 'add_staff', orgId: 'org2', name: 'T', email: 'taken@x.in', role: 'receptionist' }, db, users);
  assert.equal(r.res.status, 409);
  assert.match(r.json.error, /already exists/);
});

test('reset_password gives a new one-time password and forces a change at sign-in', async () => {
  const users = new Map<string, Row>([['u-recep1', { id: 'u-recep1', email: 'sunita@x.in', user_metadata: {} }]]);
  const r = await call('u-admin1', { action: 'reset_password', practitionerId: 'pr-recep1' }, seed(), users);
  assert.equal(r.res.status, 200);
  assert.equal(users.get('u-recep1')!.password, r.json.tempPassword);
  assert.equal(users.get('u-recep1')!.user_metadata.must_change_password, true);
  const cross = await call('u-admin2', { action: 'reset_password', practitionerId: 'pr-recep1' }, seed(), users);
  assert.equal(cross.res.status, 403);
});

test('departments: added once per name per hospital, hospital admins only for their own', async () => {
  const db = seed();
  assert.equal((await call('u-admin1', { action: 'save_department', orgId: 'org1', name: 'Physiotherapy', specialty: 'Physiotherapy' }, db)).res.status, 200);
  assert.equal((await call('u-admin1', { action: 'save_department', orgId: 'org1', name: 'Physiotherapy' }, db)).res.status, 409);
  assert.equal((await call('u-admin1', { action: 'save_department', orgId: 'org2', name: 'ICU' }, db)).res.status, 403);
});

test('super admin lists hospitals with seats, patients and AI spend', async () => {
  const { json } = await call('u-owner', { action: 'list_hospitals' });
  const org1 = json.hospitals.find((h: Row) => h.id === 'org1');
  assert.equal(org1.seats_used, 2);
  assert.equal(org1.patient_count, 1);
});

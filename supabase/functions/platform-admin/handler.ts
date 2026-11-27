// platform-admin -- every Super admin action, plus the few staff actions a
// hospital admin may take for their own hospital.
//
// Why a server function: creating logins and working across hospitals needs
// the service role, which must never reach a browser. The browser sends
// { action, ...args } with the caller's own session; this handler checks who
// the caller is before doing anything:
//   - a super admin (row in platform_admins) may do every action, for any hospital;
//   - an active hospital admin may manage staff and departments of THEIR OWN
//     hospital only (add_staff, set_staff_active, reset_password, save_department,
//     get_hospital for their org);
//   - anyone else gets 403.
// Every change is written to platform_audit. New and reset logins get a
// one-time temporary password and must choose their own at first sign-in
// (user_metadata.must_change_password). Passwords are never logged.
//
// Kept free of Deno globals so Node can test it (tests/functions).

// deno-lint-ignore no-explicit-any
export type SupabaseLike = any;

export interface Deps {
  env: (name: string) => string | undefined;
  createClient: (url: string, key: string, options?: Record<string, unknown>) => SupabaseLike;
  randomBytes: (n: number) => Uint8Array;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STAFF_ROLES = ['receptionist', 'surgeon', 'physio', 'pharmacist', 'admin'] as const;
const SPECIALTIES = ['Orthopedics', 'Physiotherapy', 'Critical Care'];
const PLANS = ['trial', 'pilot', 'basic', 'pro'];
const STATUSES = ['trialing', 'active', 'past_due', 'canceled'];
const HOSPITAL_ADMIN_ACTIONS = new Set(['get_hospital', 'add_staff', 'set_staff_active', 'reset_password', 'save_department']);

type Caller =
  | { kind: 'platform_admin'; name: string }
  | { kind: 'hospital_admin'; name: string; orgId: string };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function need(v: unknown, label: string, max = 200): string {
  const s = str(v, max);
  if (!s) throw new HttpError(400, `${label} is required.`);
  return s;
}

function email(v: unknown): string {
  const s = need(v, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'Enter a valid email address.');
  return s;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'hospital';
}

function randomId(deps: Deps, n = 6): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(deps.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
}

/** 12 characters, letters and digits, no look-alikes (0/O, 1/l). */
export function tempPassword(deps: Deps): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(deps.randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');
}

async function whoIs(admin: SupabaseLike, userId: string): Promise<Caller | null> {
  const { data: pa } = await admin.from('platform_admins').select('name').eq('auth_user_id', userId).maybeSingle();
  if (pa) return { kind: 'platform_admin', name: pa.name };
  const { data: pr } = await admin.from('practitioners').select('name, role, org_id, active').eq('auth_user_id', userId).maybeSingle();
  if (pr && pr.active && pr.role === 'admin') return { kind: 'hospital_admin', name: pr.name, orgId: pr.org_id };
  return null;
}

function assertOrgAccess(caller: Caller, orgId: string) {
  if (caller.kind === 'hospital_admin' && caller.orgId !== orgId) {
    throw new HttpError(403, 'You can only manage your own hospital.');
  }
}

async function audit(admin: SupabaseLike, caller: Caller, action: string, orgId: string | null, detail: string) {
  await admin.from('platform_audit').insert({
    ts: new Date().toISOString(), actor: caller.name, actor_role: caller.kind, action, org_id: orgId, detail,
  });
}

async function createLogin(admin: SupabaseLike, deps: Deps, mail: string, name: string) {
  const password = tempPassword(deps);
  const { data, error } = await admin.auth.admin.createUser({
    email: mail, password, email_confirm: true, user_metadata: { name, must_change_password: true },
  });
  if (error || !data?.user) {
    const msg = String(error?.message ?? '');
    throw new HttpError(409, /already|exists|registered/i.test(msg) ? 'A login with this email already exists.' : 'Could not create the login.');
  }
  return { userId: data.user.id as string, password };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = deps.env('SUPABASE_URL')!;
  const key = deps.env('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('authorization') || '';
  const userClient = deps.createClient(url, key, { global: { headers: { Authorization: authHeader } } });
  const admin = deps.createClient(url, key);

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401);
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  const action = str(body.action, 40);

  const caller = await whoIs(admin, userData.user.id);
  if (action === 'whoami') {
    return json({ platformAdmin: caller?.kind === 'platform_admin', name: caller?.name ?? null });
  }
  if (!caller) return json({ error: 'Not allowed.' }, 403);
  if (caller.kind === 'hospital_admin' && !HOSPITAL_ADMIN_ACTIONS.has(action)) {
    return json({ error: 'Only DigiYaan super admins can do this.' }, 403);
  }

  try {
    switch (action) {
      case 'list_hospitals': return json(await listHospitals(admin));
      case 'get_hospital': return json(await getHospital(admin, caller, need(body.orgId, 'Hospital')));
      case 'create_hospital': return json(await createHospital(admin, deps, caller, body));
      case 'update_hospital': return json(await updateHospital(admin, caller, body));
      case 'save_department': return json(await saveDepartment(admin, deps, caller, body));
      case 'add_staff': return json(await addStaff(admin, deps, caller, body));
      case 'set_staff_active': return json(await setStaffActive(admin, caller, body));
      case 'reset_password': return json(await resetPassword(admin, deps, caller, body));
      case 'list_audit': return json(await listAudit(admin));
      default: return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(`platform-admin: ${action} failed`);
    return json({ error: 'Something went wrong. Nothing was changed.' }, 500);
  }
}

async function listHospitals(admin: SupabaseLike) {
  const { data: orgs } = await admin.from('organizations').select('*').order('name');
  const { data: staff } = await admin.from('practitioners').select('org_id, active');
  const { data: patients } = await admin.from('patients').select('org_id');
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const { data: usage } = await admin.from('ai_usage_log').select('org_id, estimated_cost_usd').gte('ts', monthStart);
  return {
    hospitals: (orgs ?? []).map((o: Record<string, unknown>) => ({
      ...o,
      seats_used: (staff ?? []).filter((s: { org_id: string; active: boolean }) => s.org_id === o.id && s.active).length,
      patient_count: (patients ?? []).filter((p: { org_id: string }) => p.org_id === o.id).length,
      ai_spent_this_month: (usage ?? [])
        .filter((u: { org_id: string }) => u.org_id === o.id)
        .reduce((sum: number, u: { estimated_cost_usd: unknown }) => sum + Number(u.estimated_cost_usd), 0),
    })),
  };
}

async function getHospital(admin: SupabaseLike, caller: Caller, orgId: string) {
  assertOrgAccess(caller, orgId);
  const { data: org } = await admin.from('organizations').select('*').eq('id', orgId).maybeSingle();
  if (!org) throw new HttpError(404, 'Hospital not found.');
  const { data: departments } = await admin.from('departments').select('*').eq('org_id', orgId).order('name');
  const { data: staff } = await admin.from('practitioners').select('*').eq('org_id', orgId).order('name');
  const withEmail = await Promise.all((staff ?? []).map(async (s: Record<string, unknown>) => {
    if (!s.auth_user_id) return { ...s, email: null };
    const { data } = await admin.auth.admin.getUserById(s.auth_user_id);
    return { ...s, email: data?.user?.email ?? null };
  }));
  return { hospital: org, departments: departments ?? [], staff: withEmail };
}

async function createHospital(admin: SupabaseLike, deps: Deps, caller: Caller, body: Record<string, unknown>) {
  const name = need(body.name, 'Hospital name', 120);
  const city = str(body.city, 80) || null;
  const plan = PLANS.includes(str(body.plan)) ? str(body.plan) : 'trial';
  const seatLimit = Math.max(1, Math.min(500, Number(body.seatLimit) || 10));
  const budget = Math.max(0, Math.min(10000, Number(body.aiBudgetUsd) || 5));
  const adminName = need(body.adminName, 'Hospital admin name', 120);
  const adminEmail = email(body.adminEmail);

  const orgId = `${slug(name)}-${randomId(deps, 4)}`;
  const { error: orgErr } = await admin.from('organizations').insert({
    id: orgId, name, city, plan, seat_limit: seatLimit, ai_monthly_budget_usd: budget,
    subscription_status: plan === 'trial' ? 'trialing' : 'active',
    address: str(body.address, 300) || null, contact_phone: str(body.contactPhone, 30) || null,
  });
  if (orgErr) throw new HttpError(500, 'Could not create the hospital.');

  const login = await createLogin(admin, deps, adminEmail, adminName);
  const { error: prErr } = await admin.from('practitioners').insert({
    id: `pr-${randomId(deps, 8)}`, org_id: orgId, auth_user_id: login.userId, name: adminName,
    role: 'admin', title: 'Hospital Administrator', active: true, preferred_language: 'en',
  });
  if (prErr) {
    await admin.auth.admin.deleteUser(login.userId);
    throw new HttpError(500, 'Could not create the hospital admin.');
  }
  await audit(admin, caller, 'create_hospital', orgId, `${name}; first admin ${adminName} <${adminEmail}>`);
  return { orgId, adminEmail, tempPassword: login.password };
}

async function updateHospital(admin: SupabaseLike, caller: Caller, body: Record<string, unknown>) {
  const orgId = need(body.orgId, 'Hospital');
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = need(body.name, 'Hospital name', 120);
  for (const [k, col, max] of [['city', 'city', 80], ['address', 'address', 300], ['contactPhone', 'contact_phone', 30], ['billingEmail', 'billing_email', 254]] as const) {
    if (body[k] !== undefined) patch[col] = str(body[k], max) || null;
  }
  if (body.plan !== undefined) {
    if (!PLANS.includes(str(body.plan))) throw new HttpError(400, 'Unknown plan.');
    patch.plan = str(body.plan);
  }
  if (body.subscriptionStatus !== undefined) {
    if (!STATUSES.includes(str(body.subscriptionStatus))) throw new HttpError(400, 'Unknown status.');
    patch.subscription_status = str(body.subscriptionStatus);
  }
  if (body.seatLimit !== undefined) patch.seat_limit = Math.max(0, Math.min(500, Number(body.seatLimit) || 0));
  if (body.aiBudgetUsd !== undefined) patch.ai_monthly_budget_usd = Math.max(0, Math.min(10000, Number(body.aiBudgetUsd) || 0));
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change.');
  const { error } = await admin.from('organizations').update(patch).eq('id', orgId);
  if (error) throw new HttpError(500, 'Could not save the hospital.');
  await audit(admin, caller, 'update_hospital', orgId, Object.keys(patch).join(', '));
  return { ok: true };
}

async function saveDepartment(admin: SupabaseLike, deps: Deps, caller: Caller, body: Record<string, unknown>) {
  const orgId = need(body.orgId, 'Hospital');
  assertOrgAccess(caller, orgId);
  const name = need(body.name, 'Department name', 80);
  const specialty = SPECIALTIES.includes(str(body.specialty)) ? str(body.specialty) : null;
  const active = body.active === undefined ? true : Boolean(body.active);
  if (body.id) {
    const id = need(body.id, 'Department');
    const { data: dep } = await admin.from('departments').select('org_id').eq('id', id).maybeSingle();
    if (!dep || dep.org_id !== orgId) throw new HttpError(404, 'Department not found.');
    const { error } = await admin.from('departments').update({ name, specialty, active }).eq('id', id);
    if (error) throw new HttpError(409, 'A department with this name already exists.');
    await audit(admin, caller, 'update_department', orgId, name);
    return { id };
  }
  const id = `dep-${randomId(deps, 8)}`;
  const { error } = await admin.from('departments').insert({ id, org_id: orgId, name, specialty, active });
  if (error) throw new HttpError(409, 'A department with this name already exists.');
  await audit(admin, caller, 'add_department', orgId, name);
  return { id };
}

async function addStaff(admin: SupabaseLike, deps: Deps, caller: Caller, body: Record<string, unknown>) {
  const orgId = need(body.orgId, 'Hospital');
  assertOrgAccess(caller, orgId);
  const name = need(body.name, 'Name', 120);
  const mail = email(body.email);
  const role = str(body.role);
  if (!(STAFF_ROLES as readonly string[]).includes(role)) throw new HttpError(400, 'Choose a role.');
  const specialty = SPECIALTIES.includes(str(body.specialty)) ? str(body.specialty) : null;
  if ((role === 'surgeon' || role === 'physio') && !specialty) throw new HttpError(400, 'Choose a specialty for a doctor or physiotherapist.');
  const departmentId = str(body.departmentId, 40) || null;
  if (departmentId) {
    const { data: dep } = await admin.from('departments').select('org_id').eq('id', departmentId).maybeSingle();
    if (!dep || dep.org_id !== orgId) throw new HttpError(400, 'That department is not in this hospital.');
  }
  const { data: org } = await admin.from('organizations').select('seat_limit, subscription_status').eq('id', orgId).maybeSingle();
  if (!org) throw new HttpError(404, 'Hospital not found.');
  if (org.subscription_status === 'canceled') throw new HttpError(409, 'This hospital is suspended.');
  const { data: active } = await admin.from('practitioners').select('id').eq('org_id', orgId).eq('active', true);
  if ((active ?? []).length >= org.seat_limit) throw new HttpError(409, 'All user seats on this plan are in use.');

  const login = await createLogin(admin, deps, mail, name);
  const fee = body.consultFee === undefined || body.consultFee === '' ? null : Math.max(0, Number(body.consultFee) || 0);
  const { error } = await admin.from('practitioners').insert({
    id: `pr-${randomId(deps, 8)}`, org_id: orgId, auth_user_id: login.userId, name, role,
    title: str(body.title, 80) || null, specialty, department_id: departmentId,
    consult_fee: role === 'surgeon' || role === 'physio' ? fee : null, active: true, preferred_language: 'en',
  });
  if (error) {
    await admin.auth.admin.deleteUser(login.userId);
    throw new HttpError(409, /seat/i.test(String(error.message)) ? 'All user seats on this plan are in use.' : 'Could not add this staff member.');
  }
  await audit(admin, caller, 'add_staff', orgId, `${name} <${mail}> as ${role}`);
  return { email: mail, tempPassword: login.password };
}

async function staffRow(admin: SupabaseLike, caller: Caller, practitionerId: string) {
  const { data: pr } = await admin.from('practitioners').select('id, org_id, name, auth_user_id, active').eq('id', practitionerId).maybeSingle();
  if (!pr) throw new HttpError(404, 'Staff member not found.');
  assertOrgAccess(caller, pr.org_id);
  return pr;
}

async function setStaffActive(admin: SupabaseLike, caller: Caller, body: Record<string, unknown>) {
  const pr = await staffRow(admin, caller, need(body.practitionerId, 'Staff member'));
  const active = Boolean(body.active);
  const { error } = await admin.from('practitioners').update({ active }).eq('id', pr.id);
  if (error) throw new HttpError(409, /seat/i.test(String(error.message)) ? 'All user seats on this plan are in use.' : 'Could not update this staff member.');
  await audit(admin, caller, active ? 'reactivate_staff' : 'deactivate_staff', pr.org_id, pr.name);
  return { ok: true };
}

async function resetPassword(admin: SupabaseLike, deps: Deps, caller: Caller, body: Record<string, unknown>) {
  const pr = await staffRow(admin, caller, need(body.practitionerId, 'Staff member'));
  if (!pr.auth_user_id) throw new HttpError(409, 'This staff member has no login.');
  const password = tempPassword(deps);
  const { error } = await admin.auth.admin.updateUserById(pr.auth_user_id, {
    password, user_metadata: { must_change_password: true },
  });
  if (error) throw new HttpError(500, 'Could not reset the password.');
  await audit(admin, caller, 'reset_password', pr.org_id, pr.name);
  return { tempPassword: password };
}

async function listAudit(admin: SupabaseLike) {
  const { data } = await admin.from('platform_audit').select('*').order('ts', { ascending: false }).limit(200);
  return { events: data ?? [] };
}

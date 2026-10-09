// Test doubles for the transcribe-and-extract handler: an in-memory Supabase
// client (just the query-builder calls the function makes) and canned
// Deepgram / Anthropic responses. No network, no Deno.

import type { Deps } from '../../supabase/functions/transcribe-and-extract/handler.ts';

type Row = Record<string, unknown>;
export type Db = Record<string, Row[]>;

/** Two hospitals, a staff member of each role in org1, and one patient in each. */
export function seedDb(): Db {
  return {
    organizations: [
      { id: 'org1', ai_monthly_budget_usd: 45 },
      { id: 'org2', ai_monthly_budget_usd: 45 },
    ],
    practitioners: [
      { id: 'pr-recep', org_id: 'org1', auth_user_id: 'u-recep', role: 'receptionist', name: 'Asha' },
      { id: 'pr-surg', org_id: 'org1', auth_user_id: 'u-surg', role: 'surgeon', name: 'Dr. Sagar' },
      { id: 'pr-physio', org_id: 'org1', auth_user_id: 'u-physio', role: 'physio', name: 'Dr. Jayani' },
      { id: 'pr-pharm', org_id: 'org1', auth_user_id: 'u-pharm', role: 'pharmacist', name: 'Ravi' },
      { id: 'pr-admin', org_id: 'org1', auth_user_id: 'u-admin', role: 'admin', name: 'Meera' },
      { id: 'pr-surg2', org_id: 'org2', auth_user_id: 'u-surg2', role: 'surgeon', name: 'Dr. Other' },
    ],
    patients: [
      { id: 'pt-1', org_id: 'org1', auth_user_id: 'u-pt1' },
      { id: 'pt-2', org_id: 'org2', auth_user_id: null },
    ],
    encounters: [
      { id: 'enc-1', org_id: 'org1', patient_id: 'pt-1' },
      { id: 'enc-2', org_id: 'org2', patient_id: 'pt-2' },
    ],
    physiotherapy_plans: [
      { id: 'plan-1', org_id: 'org1', patient_id: 'pt-1' },
      { id: 'plan-2', org_id: 'org2', patient_id: 'pt-2' },
    ],
    ai_usage_log: [],
    transcripts: [],
  };
}

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private db: Db;
  private table: string;
  constructor(db: Db, table: string) {
    this.db = db;
    this.table = table;
  }
  select() { return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  gte(col: string, val: string) { this.filters.push((r) => String(r[col] ?? '') >= val); return this; }
  private rows() { return (this.db[this.table] ?? []).filter((r) => this.filters.every((f) => f(r))); }
  async maybeSingle() {
    const rows = this.rows();
    if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
    return { data: rows[0] ?? null, error: null };
  }
  then<T>(resolve: (v: { data: Row[]; error: null }) => T) { return Promise.resolve(resolve({ data: this.rows(), error: null })); }
}

export function fakeSupabase(db: Db, authUserId: string | null) {
  return (_url: string, _key: string, options?: Record<string, unknown>) => ({
    auth: {
      async getUser() {
        const hasAuth = !!(options as { global?: { headers?: { Authorization?: string } } } | undefined)?.global?.headers?.Authorization;
        if (!hasAuth || !authUserId) return { data: { user: null }, error: { message: 'no session' } };
        return { data: { user: { id: authUserId } }, error: null };
      },
    },
    from(table: string) {
      return {
        select: () => new Query(db, table).select(),
        async insert(row: Row) {
          (db[table] ??= []).push({ ts: new Date().toISOString(), ...row });
          return { data: null, error: null };
        },
      };
    },
  });
}

export const TRANSCRIPT_WORDS = [
  { word: 'knee', punctuated_word: 'Knee', speaker: 0 },
  { word: 'pain', punctuated_word: 'pain?', speaker: 0 },
  { word: 'yes', punctuated_word: 'Yes,', speaker: 1 },
  { word: 'two', punctuated_word: 'two', speaker: 1 },
  { word: 'weeks', punctuated_word: 'weeks.', speaker: 1 },
];

/** A tool_use input that fills every required field of the stage's tool. */
export function sampleToolInput(schema: { properties: Record<string, { type: string }>; required: string[] }) {
  const input: Record<string, unknown> = {};
  for (const key of schema.required) {
    const t = schema.properties[key].type;
    input[key] = t === 'boolean' ? false : t === 'array' ? ['Quad sets'] : `sample ${key}`;
  }
  return input;
}

export interface FetchCall { url: string; init: RequestInit }

export interface VendorOptions {
  toolInput: Record<string, unknown>;
  deepgramStatus?: number;
  deepgramBody?: string;
  anthropicStatus?: number;
  anthropicBody?: string;
  /** Anthropic answers 200 but with plain text instead of a tool_use block. */
  anthropicNoToolUse?: boolean;
}

export function fakeVendors(opts: VendorOptions) {
  const calls: FetchCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url.startsWith('https://api.deepgram.com/')) {
      if (opts.deepgramStatus && opts.deepgramStatus >= 400) return new Response(opts.deepgramBody ?? 'deepgram error', { status: opts.deepgramStatus });
      return Response.json({ metadata: { duration: 30 }, results: { channels: [{ alternatives: [{ words: TRANSCRIPT_WORDS }] }] } });
    }
    if (url.startsWith('https://api.anthropic.com/')) {
      if (opts.anthropicStatus && opts.anthropicStatus >= 400) return new Response(opts.anthropicBody ?? 'anthropic error', { status: opts.anthropicStatus });
      return Response.json({
        content: opts.anthropicNoToolUse
          ? [{ type: 'text', text: 'model prose that repeats the transcript' }]
          : [{ type: 'tool_use', name: 'tool', input: opts.toolInput }],
        usage: { input_tokens: 1200, output_tokens: 300 },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { calls, fetch: fetchFn };
}

export const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  DEEPGRAM_API_KEY: 'dg-key',
  ANTHROPIC_API_KEY: 'ant-key',
};

export function deps(db: Db, authUserId: string | null, vendors: ReturnType<typeof fakeVendors>): Deps {
  return { env: (k) => ENV[k], fetch: vendors.fetch, createClient: fakeSupabase(db, authUserId) };
}

export function request(opts: {
  stage: string;
  patientId: string;
  encounterId?: string;
  planId?: string;
  body?: string | Uint8Array;
  contentType?: string;
  auth?: boolean;
}) {
  const headers: Record<string, string> = {
    'x-stage': opts.stage,
    'x-patient-id': opts.patientId,
    'content-type': opts.contentType ?? 'audio/webm',
  };
  if (opts.auth !== false) headers.authorization = 'Bearer user-jwt';
  if (opts.encounterId) headers['x-encounter-id'] = opts.encounterId;
  if (opts.planId) headers['x-plan-id'] = opts.planId;
  return new Request('https://example.supabase.co/functions/v1/transcribe-and-extract', {
    method: 'POST',
    headers,
    body: opts.body ?? new Uint8Array([1, 2, 3, 4]),
  });
}

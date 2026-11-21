// Clinical Whisperer: only signed-in doctors (surgeon, physio) may call it,
// it respects the hospital's AI budget, logs usage, never logs patient words,
// and fails soft (HTTP 200 + fallback) on any model problem.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, DOCTOR_ROLES } from '../../supabase/functions/clinical-whisperer/handler.ts';
import { ENV, fakeSupabase, seedDb, type Db } from './fakes.ts';

const CASE = { specialty: 'Orthopedics', complaints: 'Right knee pain after a fall, Mrs Secretname' };

function vendor(reply: { status?: number; text?: string } = {}) {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    calls.push(String(input));
    if (reply.status && reply.status >= 400) return new Response('anthropic error body', { status: reply.status });
    return Response.json({
      content: [{ type: 'text', text: reply.text ?? '{"prompts":["Pain on stairs?","Locking or giving way?"]}' }],
      usage: { input_tokens: 200, output_tokens: 50 },
    });
  }) as typeof fetch;
  return { calls, fetch: fetchFn };
}

async function call(caller: string | null, opts: { db?: Db; reply?: Parameters<typeof vendor>[0]; body?: unknown; auth?: boolean } = {}) {
  const db = opts.db ?? seedDb();
  const v = vendor(opts.reply);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth !== false) headers.authorization = 'Bearer user-jwt';
  const req = new Request('https://example.supabase.co/functions/v1/clinical-whisperer', {
    method: 'POST', headers, body: JSON.stringify(opts.body ?? CASE),
  });
  const res = await handle(req, { env: (k) => ENV[k], fetch: v.fetch, createClient: fakeSupabase(db, caller) });
  return { res, json: await res.json(), db, v };
}

test('only surgeon and physio are doctor roles', () => {
  assert.deepEqual(DOCTOR_ROLES, ['surgeon', 'physio']);
});

test('a call without a signed-in user is refused before the model is called', async () => {
  const { res, v } = await call(null, { auth: false });
  assert.equal(res.status, 401);
  assert.equal(v.calls.length, 0);
});

test('non-doctor staff and patient logins are refused', async () => {
  for (const u of ['u-recep', 'u-pharm', 'u-admin', 'u-pt1']) {
    const { res, v, db } = await call(u);
    assert.equal(res.status, 403, `${u} should be refused`);
    assert.equal(v.calls.length, 0);
    assert.equal(db.ai_usage_log.length, 0);
  }
});

test('a doctor gets case prompts and the call is logged to ai_usage_log', async () => {
  const { res, json, db } = await call('u-surg');
  assert.equal(res.status, 200);
  assert.deepEqual(json, { prompts: ['Pain on stairs?', 'Locking or giving way?'], fallback: false });
  assert.equal(db.ai_usage_log.length, 1);
  assert.equal(db.ai_usage_log[0].org_id, 'org1');
  assert.equal(db.ai_usage_log[0].note, 'stage=whisperer');
});

test('over the monthly budget it falls back without calling the model', async () => {
  const db = seedDb();
  db.ai_usage_log.push({ org_id: 'org1', estimated_cost_usd: 45, ts: new Date().toISOString() });
  const { res, json, v } = await call('u-surg', { db });
  assert.equal(res.status, 200);
  assert.equal(json.fallback, true);
  assert.equal(v.calls.length, 0);
});

test('model errors and unparseable replies fail soft and log no patient words', async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    for (const reply of [{ status: 500 }, { text: 'not json, mentions Mrs Secretname' }]) {
      const { res, json } = await call('u-physio', { reply });
      assert.equal(res.status, 200);
      assert.equal(json.prompts, null);
      assert.equal(json.fallback, true);
      assert.ok(!JSON.stringify(json).includes('Secretname'));
    }
  } finally {
    console.error = orig;
  }
  assert.ok(logged.every((l) => !l.includes('Secretname') && !l.includes('anthropic error body')), logged.join('\n'));
});

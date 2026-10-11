// SEC03: the Clinical Whisperer only answers signed-in doctors, counts against
// the hospital's AI budget, logs usage, and never logs patient or model text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/clinical-whisperer/handler.ts';
import { deps, seedDb } from './fakes.ts';

const BODY = { specialty: 'Orthopaedics', complaints: 'Right knee pain', age: 54 };

function anthropicOk(text = '{"prompts":["Locking or giving way?","Swelling after activity?","Night pain?","Prior injury?"]}') {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return Response.json({ content: [{ type: 'text', text }], usage: { input_tokens: 400, output_tokens: 80 } });
  }) as typeof fetch;
  return { calls, fetch: fetchFn };
}

function req(opts: { auth?: boolean; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth !== false) headers.authorization = 'Bearer user-jwt';
  return new Request('https://example.supabase.co/functions/v1/clinical-whisperer', {
    method: 'POST', headers, body: JSON.stringify(opts.body ?? BODY),
  });
}

function setup(caller: string | null) {
  const db = seedDb();
  const vendors = anthropicOk();
  return { db, vendors, d: deps(db, caller, vendors as never) };
}

async function assertRefused(caller: string | null, status: number, auth = true) {
  const { db, vendors, d } = setup(caller);
  const res = await handle(req({ auth }), d);
  assert.equal(res.status, status);
  assert.equal(vendors.calls.length, 0, 'a refused call must not reach Anthropic');
  assert.equal(db.ai_usage_log.length, 0, 'a refused call must not log usage');
}

test('no sign-in (only the public anon key) is refused with 401', async () => {
  await assertRefused(null, 401);
  await assertRefused('u-surg', 401, false);
});

test('a patient login is refused', async () => {
  await assertRefused('u-pt1', 403);
});

test('non-doctor staff are refused', async () => {
  for (const u of ['u-recep', 'u-pharm', 'u-admin']) await assertRefused(u, 403);
});

test('a surgeon or physio gets prompts and the call is logged against their hospital', async () => {
  for (const u of ['u-surg', 'u-physio']) {
    const { db, vendors, d } = setup(u);
    const res = await handle(req(), d);
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.fallback, false);
    assert.equal(out.prompts.length, 4);
    assert.equal(vendors.calls.length, 1);
    assert.equal(db.ai_usage_log.length, 1);
    assert.equal(db.ai_usage_log[0].org_id, 'org1');
    assert.equal(db.ai_usage_log[0].note, 'stage=whisperer');
  }
});

test('the monthly budget stops the call before any money is spent', async () => {
  const { db, vendors, d } = setup('u-surg');
  db.ai_usage_log.push({ org_id: 'org1', estimated_cost_usd: 45, ts: new Date().toISOString() });
  const res = await handle(req(), d);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.fallback, true);
  assert.equal(vendors.calls.length, 0);
});

test('a case with nothing but a specialty does not call the model', async () => {
  const { vendors, d } = setup('u-surg');
  const res = await handle(req({ body: { specialty: 'Orthopaedics' } }), d);
  assert.equal((await res.json()).fallback, true);
  assert.equal(vendors.calls.length, 0);
});

test('patient words and model output never reach the logs', async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    const db = seedDb();
    const failing = (async () => new Response('SECRET vendor body with patient words', { status: 500 })) as typeof fetch;
    const res = await handle(req(), deps(db, 'u-surg', { calls: [], fetch: failing } as never));
    assert.equal((await res.json()).fallback, true);
    const garbled = anthropicOk('not json: Right knee pain 54-year-old');
    await handle(req(), deps(seedDb(), 'u-surg', garbled as never));
  } finally {
    console.error = orig;
  }
  const all = logged.join('\n');
  assert.ok(!/SECRET|knee|54/i.test(all), `logs leaked content: ${all}`);
});

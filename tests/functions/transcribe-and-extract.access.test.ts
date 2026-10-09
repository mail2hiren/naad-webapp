// A01: the recording function only works on the caller's own hospital's
// patients, encounters and plans, and only for roles that run that stage.
// A refused call must not reach Deepgram or Anthropic or write anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/transcribe-and-extract/handler.ts';
import { TOOLS } from '../../supabase/functions/transcribe-and-extract/contract.ts';
import { deps, fakeVendors, request, sampleToolInput, seedDb } from './fakes.ts';

function vendorsFor(stage: string) {
  const schema = TOOLS[stage].input_schema as { properties: Record<string, { type: string }>; required: string[] };
  return fakeVendors({ toolInput: sampleToolInput(schema) });
}

async function call(caller: string, opts: Parameters<typeof request>[0]) {
  const db = seedDb();
  const vendors = vendorsFor(opts.stage);
  const res = await handle(request(opts), deps(db, caller, vendors));
  return { res, db, vendors };
}

async function assertRefused(caller: string, opts: Parameters<typeof request>[0]) {
  const { res, db, vendors } = await call(caller, opts);
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${await res.clone().text()}`);
  assert.equal(vendors.calls.length, 0, 'a refused call must not reach Deepgram or Anthropic');
  assert.equal(db.transcripts.length, 0, 'a refused call must not store a transcript');
  assert.equal(db.ai_usage_log.length, 0, 'a refused call must not log AI usage');
}

test("another hospital's patient is refused", async () => {
  await assertRefused('u-surg', { stage: 'consult', patientId: 'pt-2' });
});

test('a patient id that does not exist is refused', async () => {
  await assertRefused('u-recep', { stage: 'reception', patientId: 'pt-nope' });
});

test("another hospital's encounter is refused, even with our own patient", async () => {
  await assertRefused('u-surg', { stage: 'consult', patientId: 'pt-1', encounterId: 'enc-2' });
});

test("another hospital's physio plan is refused", async () => {
  await assertRefused('u-physio', { stage: 'physio', patientId: 'pt-1', planId: 'plan-2' });
});

test('roles that do not run a stage are refused', async () => {
  await assertRefused('u-pharm', { stage: 'consult', patientId: 'pt-1' });
  await assertRefused('u-pharm', { stage: 'reception', patientId: 'pt-1' });
  await assertRefused('u-admin', { stage: 'consult', patientId: 'pt-1' });
  await assertRefused('u-recep', { stage: 'consult', patientId: 'pt-1' });
  await assertRefused('u-recep', { stage: 'physio', patientId: 'pt-1' });
  await assertRefused('u-surg', { stage: 'reception', patientId: 'pt-1' });
});

test('a patient login cannot record', async () => {
  await assertRefused('u-pt1', { stage: 'reception', patientId: 'pt-1' });
});

test('own-hospital calls by the right role still work', async () => {
  const allowed: Array<[string, Parameters<typeof request>[0]]> = [
    ['u-recep', { stage: 'reception', patientId: 'pt-1' }],
    ['u-surg', { stage: 'consult', patientId: 'pt-1', encounterId: 'enc-1' }],
    ['u-physio', { stage: 'consult', patientId: 'pt-1' }],
    ['u-physio', { stage: 'physio', patientId: 'pt-1', planId: 'plan-1' }],
    ['u-surg', { stage: 'physio', patientId: 'pt-1' }],
  ];
  for (const [caller, opts] of allowed) {
    const { res, db } = await call(caller, opts);
    assert.equal(res.status, 200, `${caller} ${opts.stage}: ${await res.clone().text()}`);
    assert.equal(db.transcripts.length, 1);
    assert.equal(db.transcripts[0].org_id, 'org1');
  }
});

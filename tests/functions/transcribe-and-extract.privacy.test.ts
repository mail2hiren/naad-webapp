// A03: Deepgram is told not to keep or train on our audio (mip_opt_out),
// and no patient words, model output or vendor error bodies leave the
// function through its logs or its error responses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/transcribe-and-extract/handler.ts';
import { TOOLS } from '../../supabase/functions/transcribe-and-extract/contract.ts';
import { deps, fakeVendors, request, sampleToolInput, seedDb, type VendorOptions } from './fakes.ts';

const TYPED_NOTE = 'Patient says left knee gave way on the stairs, takes metformin.';
// What a vendor might echo back in an error: request content and account details.
const VENDOR_ERROR_BODY = '{"err":"bad request","echo":"left knee gave way","account":"acct_12345"}';

const consultInput = sampleToolInput(
  TOOLS.consult.input_schema as { properties: Record<string, { type: string }>; required: string[] },
);

/** Runs one call while capturing everything written to the console. */
async function run(opts: Parameters<typeof request>[0], vendorOpts: Partial<VendorOptions> = {}) {
  const logged: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const original = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const db = seedDb();
    const vendors = fakeVendors({ toolInput: consultInput, ...vendorOpts });
    const res = await handle(request(opts), deps(db, 'u-surg', vendors));
    return { res, body: await res.text(), logged: logged.join('\n'), vendors };
  } finally {
    methods.forEach((m, i) => { console[m] = original[i]; });
  }
}

test('Deepgram requests carry the data-sharing opt-out flag', async () => {
  const { res, vendors } = await run({ stage: 'consult', patientId: 'pt-1' });
  assert.equal(res.status, 200);
  const dg = vendors.calls.find((c) => c.url.startsWith('https://api.deepgram.com/'));
  assert.ok(dg, 'Deepgram was not called');
  assert.equal(new URL(dg.url).searchParams.get('mip_opt_out'), 'true');
});

test('a Deepgram error body is not returned or logged', async () => {
  const { res, body, logged } = await run({ stage: 'consult', patientId: 'pt-1' }, { deepgramStatus: 400, deepgramBody: VENDOR_ERROR_BODY });
  assert.equal(res.status, 502);
  for (const leak of ['acct_12345', 'left knee gave way']) {
    assert.ok(!body.includes(leak), `response leaks "${leak}": ${body}`);
    assert.ok(!logged.includes(leak), `logs leak "${leak}"`);
  }
});

test('an Anthropic error returns neither its body nor the transcript', async () => {
  const { res, body, logged } = await run(
    { stage: 'consult', patientId: 'pt-1', contentType: 'text/plain', body: TYPED_NOTE },
    { anthropicStatus: 500, anthropicBody: VENDOR_ERROR_BODY },
  );
  assert.equal(res.status, 502);
  for (const leak of ['acct_12345', 'metformin', 'left knee gave way']) {
    assert.ok(!body.includes(leak), `response leaks "${leak}": ${body}`);
    assert.ok(!logged.includes(leak), `logs leak "${leak}"`);
  }
  assert.ok(!('diarizedText' in JSON.parse(body)), 'error response carries diarizedText');
});

test('a reply without structured output returns neither the transcript nor the model text', async () => {
  const { res, body, logged } = await run(
    { stage: 'consult', patientId: 'pt-1', contentType: 'text/plain', body: TYPED_NOTE },
    { anthropicNoToolUse: true },
  );
  assert.equal(res.status, 502);
  for (const leak of ['metformin', 'model prose']) {
    assert.ok(!body.includes(leak), `response leaks "${leak}": ${body}`);
    assert.ok(!logged.includes(leak), `logs leak "${leak}"`);
  }
});

test('a successful call logs no transcript or model text', async () => {
  const { res, logged } = await run({ stage: 'consult', patientId: 'pt-1', contentType: 'text/plain', body: TYPED_NOTE });
  assert.equal(res.status, 200);
  for (const leak of ['metformin', 'left knee', 'sample hpi', 'sample assessment']) {
    assert.ok(!logged.includes(leak), `logs leak "${leak}"`);
  }
});

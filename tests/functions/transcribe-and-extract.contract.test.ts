// E01 contract check for the transcribe-and-extract edge function.
//
// Runs the real handler (supabase/functions/transcribe-and-extract/handler.ts)
// against stubbed Deepgram / Anthropic / Supabase and compares what it sends
// and returns with the saved snapshot in transcribe-and-extract.contract.json:
// the pinned model, the vendor request, a hash of the system prompt, the tool
// schemas, and the response shape for every stage. Any drift fails CI.
//
// Changed one of those on purpose? Regenerate and commit the snapshot:
//   UPDATE_CONTRACT=1 npm run test:functions

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { handle } from '../../supabase/functions/transcribe-and-extract/handler.ts';
import {
  ANTHROPIC_VERSION,
  CLAUDE_MAX_TOKENS,
  CLAUDE_MODEL,
  DEEPGRAM_LISTEN_URL,
  SYSTEM_PROMPT_PREFIX,
  TOOLS,
} from '../../supabase/functions/transcribe-and-extract/contract.ts';
import { deps, fakeVendors, request, sampleToolInput, seedDb } from './fakes.ts';

const SNAPSHOT_URL = new URL('./transcribe-and-extract.contract.json', import.meta.url);
const CLIENT_HOOK = new URL('../../src/hooks/useRealAmbientCapture.ts', import.meta.url);

const STAGE_CALLER: Record<string, string> = { reception: 'u-recep', consult: 'u-surg', physio: 'u-physio' };

function keysOf(o: unknown) {
  return Object.keys(o as object).sort();
}

/** Field names of a TypeScript interface in the browser hook, so the function
 * and the app that reads its response cannot drift apart silently. */
function clientInterfaceFields(name: string) {
  const src = readFileSync(CLIENT_HOOK, 'utf8');
  const m = src.match(new RegExp(`interface ${name} \\{([^}]*)\\}`));
  assert.ok(m, `interface ${name} not found in useRealAmbientCapture.ts`);
  return [...m[1].matchAll(/^\s*(\w+)\??:/gm)].map((x) => x[1]).sort();
}

async function runStage(stage: string, contentType: string) {
  const db = seedDb();
  const schema = TOOLS[stage].input_schema as { properties: Record<string, { type: string }>; required: string[] };
  const vendors = fakeVendors({ toolInput: sampleToolInput(schema) });
  const body = contentType.startsWith('text/') ? 'Patient reports knee pain for two weeks.' : undefined;
  const res = await handle(request({ stage, patientId: 'pt-1', contentType, body }), deps(db, STAGE_CALLER[stage], vendors));
  assert.equal(res.status, 200, `${stage} ${contentType} returned ${res.status}: ${await res.clone().text()}`);
  return { json: await res.json(), vendors, db };
}

async function buildContract() {
  const response: Record<string, unknown> = {};
  let anthropicRequest: Record<string, unknown> = {};
  let deepgramRequest: Record<string, unknown> = {};

  for (const stage of Object.keys(TOOLS).sort()) {
    for (const contentType of ['audio/webm', 'text/plain']) {
      const { json, vendors } = await runStage(stage, contentType);
      response[`${stage} ${contentType}`] = {
        top: keysOf(json),
        usage: keysOf(json.usage),
        extracted: keysOf(json.extracted),
        provenance: json.extracted.provenance,
      };
      const dg = vendors.calls.find((c) => c.url.startsWith('https://api.deepgram.com/'));
      if (dg) {
        deepgramRequest = { url: dg.url, method: dg.init.method, headers: keysOf(dg.init.headers) };
      }
      const ant = vendors.calls.find((c) => c.url.startsWith('https://api.anthropic.com/'));
      assert.ok(ant, 'no Anthropic call');
      const sent = JSON.parse(String(ant.init.body));
      if (stage === 'consult') {
        anthropicRequest = {
          url: ant.url,
          headers: keysOf(ant.init.headers),
          bodyKeys: keysOf(sent),
          model: sent.model,
          max_tokens: sent.max_tokens,
          tool_choice: sent.tool_choice,
        };
      }
      assert.equal(sent.system, SYSTEM_PROMPT_PREFIX);
      assert.deepEqual(sent.tools, [TOOLS[stage]]);
    }
  }

  return {
    model: CLAUDE_MODEL,
    anthropicVersion: ANTHROPIC_VERSION,
    maxTokens: CLAUDE_MAX_TOKENS,
    deepgramListenUrl: DEEPGRAM_LISTEN_URL,
    systemPromptSha256: createHash('sha256').update(SYSTEM_PROMPT_PREFIX).digest('hex'),
    tools: TOOLS,
    deepgramRequest,
    anthropicRequest,
    response,
  };
}

test('response, prompt, model and tool schemas match the saved contract', async () => {
  const actual = JSON.parse(JSON.stringify(await buildContract()));
  if (process.env.UPDATE_CONTRACT === '1') {
    writeFileSync(SNAPSHOT_URL, JSON.stringify(actual, null, 2) + '\n');
    return;
  }
  const saved = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8'));
  assert.deepEqual(actual, saved, 'transcribe-and-extract contract changed; if intended, run UPDATE_CONTRACT=1 npm run test:functions and commit the snapshot');
});

test('response shape matches what the app reads (ExtractResult / ExtractUsage)', async () => {
  const { json } = await runStage('consult', 'audio/webm');
  assert.deepEqual(keysOf(json), clientInterfaceFields('ExtractResult'));
  assert.deepEqual(keysOf(json.usage), clientInterfaceFields('ExtractUsage'));
});

test('extracted fields are exactly the stage tool\'s required fields plus provenance', async () => {
  for (const stage of Object.keys(TOOLS)) {
    const { json } = await runStage(stage, 'text/plain');
    const required = (TOOLS[stage].input_schema as { required: string[] }).required;
    assert.deepEqual(keysOf(json.extracted), [...required, 'provenance'].sort(), stage);
    assert.equal(json.extracted.provenance, 'ai_generated');
  }
});

test('the model is pinned to an exact id, not a moving "latest" alias', () => {
  assert.match(CLAUDE_MODEL, /^claude-[a-z0-9-]+$/);
  assert.doesNotMatch(CLAUDE_MODEL, /latest/);
});

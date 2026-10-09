// ============================================================================
// transcribe-and-extract — the real ambient AI pipeline.
//
// Replaces two things at once:
//   1. The browser's Web Speech API (which silently sent every conversation's
//      raw audio to Google's servers for transcription, had no idea who was
//      speaking, and understood zero medical vocabulary).
//   2. The client-side regex/keyword mock extractor (mockExtractReception /
//      mockExtractOrthoNote / mockExtractPhysioNote in the app) — which never
//      understood a drug name or a clinical term, by design, as a free
//      stand-in until this existed.
//
// Accepts TWO kinds of request body, distinguished by Content-Type:
//   - audio/* (from the mic recorder): transcribed via Deepgram first, as
//     described in step 3 below.
//   - text/* (from the "type it yourself" fallback, added 2026-08-24 after
//     a live test session showed the client was STILL falling back to the
//     old regex mock — not this function — whenever someone typed instead of
//     recording, which is exactly why a real doctor got back a session note
//     with every field blank): Deepgram is skipped entirely and the raw text
//     is sent straight to Claude for the same structured extraction. Typing
//     now gets the same real, budget-tracked, audited result recording does.
//
// What it does, in order:
//   1. Authenticates the caller against Supabase Auth and resolves them to a
//      practitioner/patient row — this function costs real money per call,
//      so an unauthenticated stranger must never be able to trigger it.
//   2. Checks this month's running AI spend against the org's soft budget
//      ceiling (organizations.ai_monthly_budget_usd) BEFORE spending a single
//      cent — Anthropic's hard spend-limit API is Enterprise-only, so this is
//      the app's own safety net, not a vendor feature.
//   3. Sends the raw audio to Deepgram for transcription WITH speaker
//      diarization (model=nova-3, diarize_model=latest) — doctor and patient
//      finally come back as separate speakers, not one undifferentiated blob
//      of text. Also runs with language=multi (added 2026-08-24) so
//      Hindi/English code-switching within the same conversation is
//      transcribed correctly instead of forcing one language and mangling
//      the other — real-world Mumbai reception/patient conversations mix
//      the two constantly. NOTE: Deepgram's multi-language pool for
//      Nova-3 covers Hindi + English (among others) but does NOT include
//      Marathi or Gujarati — a conversation that swaps into those will
//      still transcribe poorly. See the "Multilingual support" section in
//      the project doc for the full picture and what a real fix looks like.
//   4. Persists that raw diarized transcript (the `transcripts` table) — the
//      prototype never kept the actual conversation, only fields derived
//      from it, which meant nothing was genuinely searchable later.
//   5. Sends the diarized transcript to Claude (Haiku 4.5 — fast and cheap,
//      right-sized for structured extraction) with a FORCED tool call, so
//      the response is always valid structured JSON in the exact shape the
//      app's existing UI already renders — chief complaint, HPI, pain
//      location, etc. Exam findings (ROM, strength, tenderness, stability,
//      gait, neuro) are deliberately NEVER part of what this function
//      extracts, matching the product's existing non-negotiable rule that
//      the assistant never invents a physical exam.
//   6. Logs the real cost of both calls to `ai_usage_log` so the budget
//      check above is checking against ground truth, not an estimate nobody
//      updates.
//
// Deployment: from this repo only. .github/workflows/deploy-functions.yml
// runs the contract tests and then `supabase functions deploy
// transcribe-and-extract` on every push to main that touches this folder.
// Secrets live in Supabase, never here:
//   supabase secrets set DEEPGRAM_API_KEY=... ANTHROPIC_API_KEY=...
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already provided
// automatically to every Edge Function by the Supabase platform.)
//
// Layout: contract.ts pins the model, prompt and tool schemas; handler.ts is
// the request logic (no Deno globals, so Node can test it); this file only
// wires the Deno runtime to it.
//
// 2026-08-25 update: reception's extraction tool now also pulls
// allergiesMentioned / medicationsMentioned / referringDoctor — powers the
// live "Heard / Ask" checklist reception asked for, built from the same
// structured summary that already existed rather than a new capture pass.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle } from "./handler.ts";

Deno.serve((req: Request) =>
  handle(req, {
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    createClient,
  })
);

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
// Deployment (one-time, by the user — this sandbox cannot reach Supabase):
//   supabase functions deploy transcribe-and-extract
//   supabase secrets set DEEPGRAM_API_KEY=... ANTHROPIC_API_KEY=...
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already provided
// automatically to every Edge Function by the Supabase platform.)
//
// 2026-08-25 update: reception's extraction tool now also pulls
// allergiesMentioned / medicationsMentioned / referringDoctor — powers the
// live "Heard / Ask" checklist reception asked for, built from the same
// structured summary that already existed rather than a new capture pass.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-stage, x-patient-id, x-encounter-id, x-plan-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const DEEPGRAM_USD_PER_MINUTE = 0.005;
const CLAUDE_USD_PER_MTOK_INPUT = 1.0;
const CLAUDE_USD_PER_MTOK_OUTPUT = 5.0;
const CLAUDE_MODEL = "claude-haiku-4-5";

const TOOLS: Record<string, { name: string; description: string; input_schema: Record<string, unknown> }> = {
  reception: {
    name: "extract_reception_summary",
    description: "Extract a structured pre-consultation summary from a reception conversation transcript.",
    input_schema: {
      type: "object",
      properties: {
        reasonForVisit: { type: "string", description: "Short phrase, e.g. 'Knee pain / complaint'. Never a diagnosis." },
        duration: { type: "string", description: "How long the complaint has been going on, in the patient's own terms. 'Not specified — confirm with patient' if unclear." },
        trauma: { type: "boolean", description: "True only if an injury, fall, accident, or similar was explicitly mentioned." },
        priorTreatment: { type: "string", description: "What self-care or treatment, if any, was mentioned as already tried." },
        reportsAvailable: { type: "boolean", description: "True only if the patient explicitly mentioned having a report, X-ray, MRI, or scan." },
        allergiesMentioned: { type: "string", description: "Any drug/medication allergy explicitly mentioned, verbatim in the patient's terms. Empty string if allergies were never brought up in this conversation — do not write 'none' unless the patient was actually asked and said no." },
        medicationsMentioned: { type: "string", description: "Any current medication explicitly named. Empty string if never brought up in this conversation." },
        referringDoctor: { type: "string", description: "Name of a referring doctor, if one was mentioned. Empty string if none was mentioned." },
      },
      required: ["reasonForVisit", "duration", "trauma", "priorTreatment", "reportsAvailable", "allergiesMentioned", "medicationsMentioned", "referringDoctor"],
    },
  },
  consult: {
    name: "extract_clinical_history",
    description:
      "Extract structured HISTORY fields (never examination findings — those are entered by the clinician only) from a diarized doctor-patient consultation transcript.",
    input_schema: {
      type: "object",
      properties: {
        chiefComplaint: { type: "string" },
        hpi: { type: "string", description: "History of present illness, in flowing prose, drawn from what was actually said." },
        painLocation: { type: "string" },
        painSeverity: { type: "string", description: "e.g. '6/10'. 'Not specified — ask patient to rate 0–10' if never stated." },
        painDuration: { type: "string" },
        trauma: { type: "string", description: "e.g. 'Yes — following a fall' or 'No trauma reported'." },
        aggravating: { type: "string" },
        relieving: { type: "string" },
        functionalLimitation: { type: "string" },
        priorTreatment: { type: "string" },
        assessment: {
          type: "string",
          description:
            "Tentative clinical impression phrased as a POSSIBILITY requiring clinician confirmation, e.g. 'Findings are consistent with possible X — not a confirmed diagnosis, clinical correlation required.' Never state a diagnosis as settled fact.",
        },
        plan: { type: "string", description: "Suggested next steps only — the clinician approves or rewrites this before it becomes real." },
      },
      required: [
        "chiefComplaint", "hpi", "painLocation", "painSeverity", "painDuration",
        "trauma", "aggravating", "relieving", "functionalLimitation", "priorTreatment",
        "assessment", "plan",
      ],
    },
  },
  physio: {
    name: "extract_therapy_session",
    description: "Extract structured therapy session fields from a diarized physiotherapist-patient session transcript.",
    input_schema: {
      type: "object",
      properties: {
        painScore: { type: "string", description: "The patient's CURRENT / most recently stated pain level, 0-10, if stated at all, else empty string. If the conversation mentions more than one value (e.g. worse earlier, better now), use the latest one." },
        rom: { type: "string", description: "Range of motion as described, e.g. '5–125 degrees'. Leave empty if no ROM measurement was stated (e.g. the assessment hadn't happened yet in this conversation) — do not guess." },
        strength: { type: "string", description: "e.g. '4/5'. Leave empty if no strength/MMT grade was stated — do not guess." },
        mobility: { type: "string", description: "Gait / mobility observation as described." },
        exercisesDone: {
          type: "array",
          items: { type: "string" },
          description: "Names of exercises explicitly mentioned as performed. Only include exercises actually named in the transcript.",
        },
        tolerance: { type: "string" },
        progressNote: { type: "string", description: "A SHORT clinical progress note in flowing prose (2-4 sentences), written as a clinician's own synthesis of the session — never the raw transcript copied or paraphrased line-by-line." },
      },
      required: ["painScore", "rom", "strength", "mobility", "exercisesDone", "tolerance", "progressNote"],
    },
  },
};

const SYSTEM_PROMPT_PREFIX = `You are a clinical documentation assistant for DigiYaan, an ambient-AI tool used in an Indian orthopedic and physiotherapy practice. You will usually be given a diarized transcript (speakers labeled "Speaker 0", "Speaker 1", etc — you are not told in advance which speaker is the clinician and which is the patient; infer it from context, such as who is asking questions versus describing symptoms). Sometimes, instead, you will be given plain typed notes with no speaker labels at all — a clinician typing instead of recording. Extract the same way either way: pull only what the text actually states.

Hard rules, no exceptions:
- Extract only what was actually said. Never invent, infer beyond what's stated, or fill a field with a plausible-sounding guess.
- Never state a diagnosis as confirmed fact. Any clinical impression must be phrased as tentative and explicitly marked as requiring clinician confirmation.
- If information for a field was not mentioned, say so plainly (e.g. "Not specified — confirm with patient") rather than leaving it ambiguous or inventing a default.
- You are not shown any physical examination and must never fabricate one.
- The transcript may mix Hindi, Marathi, Gujarati and English within the same conversation, or be transcribed imperfectly where the speech-to-text step didn't recognize a non-English word — this is normal for this practice's patients. Write every field in clear English regardless of which language(s) the conversation used. If a word or phrase in the transcript is garbled, untranslatable, or clearly a transcription error, do not guess at its meaning — note the gap explicitly (e.g. "patient described [unclear] — confirm with patient") rather than silently dropping or inventing content.
- Any free-text note field (progressNote, hpi, assessment, etc.) must be YOUR OWN short clinical synthesis in flowing prose — 2 to 4 sentences, written the way a clinician would write it in a chart. It must NEVER be the transcript copied or closely paraphrased verbatim, however long or unstructured the conversation was. "Extract only what was actually said" means don't add facts that weren't said — it does not mean reproduce the dialogue. If the conversation was mostly exploratory (history-taking, no findings yet), say that plainly in one short sentence rather than restating everything that was asked and answered.
- When a value changes over the course of the conversation (e.g. a pain score given as "seven, but it's down to five now"), use the patient's CURRENT/most recently stated value for that field, not an earlier one — and you may mention the earlier value in prose (e.g. in progressNote) for context if useful.
- Call the provided tool exactly once with your extraction. Do not respond in plain text.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const stage = req.headers.get("x-stage") || "";
  const patientId = req.headers.get("x-patient-id") || "";
  const encounterId = req.headers.get("x-encounter-id") || null;
  const planId = req.headers.get("x-plan-id") || null;

  if (!TOOLS[stage]) {
    return jsonResponse({ error: `Unknown or missing stage (expected reception|consult|physio, got "${stage}")` }, 400);
  }
  if (!patientId) {
    return jsonResponse({ error: "Missing x-patient-id header" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

  if (!DEEPGRAM_API_KEY || !ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "Server is missing DEEPGRAM_API_KEY or ANTHROPIC_API_KEY secrets — see setup-ai-keys.md" }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "Not signed in" }, 401);
  }

  const authUserId = userData.user.id;
  const { data: pract } = await admin.from("practitioners").select("org_id, role, name").eq("auth_user_id", authUserId).maybeSingle();
  const { data: pat } = pract ? { data: null } : await admin.from("patients").select("org_id").eq("auth_user_id", authUserId).maybeSingle();
  const orgId = pract?.org_id || pat?.org_id;

  if (!orgId) {
    return jsonResponse({ error: "This login isn't linked to a staff or patient record" }, 403);
  }
  if (!pract) {
    return jsonResponse({ error: "Only staff accounts may record a consultation" }, 403);
  }

  const { data: org } = await admin.from("organizations").select("ai_monthly_budget_usd").eq("id", orgId).maybeSingle();
  const budget = Number(org?.ai_monthly_budget_usd ?? 45);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const { data: usageRows } = await admin
    .from("ai_usage_log")
    .select("estimated_cost_usd")
    .eq("org_id", orgId)
    .gte("ts", monthStart);
  const spentSoFar = (usageRows || []).reduce((sum, r) => sum + Number(r.estimated_cost_usd), 0);
  if (spentSoFar >= budget) {
    return jsonResponse(
      {
        error: "budget_exceeded",
        message: `This month's AI budget ($${budget.toFixed(2)}) has been reached. Please type this note manually — nothing is broken, this is a deliberate spending guard.`,
        spentSoFar,
        budget,
      },
      402,
    );
  }

  const contentType = req.headers.get("content-type") || "audio/webm";
  const isTyped = contentType.toLowerCase().startsWith("text/");

  let diarizedText = "";
  let durationSeconds: number | null = null;
  let dgMinutes = 0;
  let dgCost = 0;

  if (isTyped) {
    diarizedText = (await req.text()).trim();
    if (!diarizedText) {
      return jsonResponse({ error: "no_speech", message: "No text was provided." }, 422);
    }
  } else {
    const audioBytes = await req.arrayBuffer();
    if (audioBytes.byteLength === 0) {
      return jsonResponse({ error: "No audio received" }, 400);
    }

    const dgRes = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true&punctuate=true&diarize_model=latest",
      {
        method: "POST",
        headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, "Content-Type": contentType },
        body: audioBytes,
      },
    );
    if (!dgRes.ok) {
      const errText = await dgRes.text().catch(() => "");
      return jsonResponse({ error: "Transcription failed", detail: errText }, 502);
    }
    const dgJson = await dgRes.json();
    const words: Array<{ punctuated_word?: string; word: string; speaker?: number }> =
      dgJson?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
    durationSeconds = dgJson?.metadata?.duration || 0;

    if (words.length === 0) {
      return jsonResponse({ error: "no_speech", message: "No speech was detected in the recording." }, 422);
    }

    let currentSpeaker: number | null = null;
    for (const w of words) {
      const spk = w.speaker ?? 0;
      if (spk !== currentSpeaker) {
        diarizedText += (diarizedText ? "\n" : "") + `Speaker ${spk}: `;
        currentSpeaker = spk;
      }
      diarizedText += (w.punctuated_word || w.word) + " ";
    }
    diarizedText = diarizedText.trim();

    dgMinutes = (durationSeconds || 0) / 60;
    dgCost = dgMinutes * DEEPGRAM_USD_PER_MINUTE;
    await admin.from("ai_usage_log").insert({
      org_id: orgId, vendor: "deepgram", units: dgMinutes, estimated_cost_usd: dgCost, note: `stage=${stage}`,
    });
  }

  const transcriptId = `tr-${crypto.randomUUID().slice(0, 12)}`;
  await admin.from("transcripts").insert({
    id: transcriptId, org_id: orgId, patient_id: patientId, encounter_id: encounterId, plan_id: planId,
    stage, diarized_text: diarizedText, duration_seconds: durationSeconds, source: isTyped ? "typed" : "audio",
  });

  const tool = TOOLS[stage];
  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT_PREFIX,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        { role: "user", content: `Diarized transcript:\n\n${diarizedText}` },
      ],
    }),
  });
  if (!claudeRes.ok) {
    const errText = await claudeRes.text().catch(() => "");
    return jsonResponse({ error: "Extraction failed", detail: errText, diarizedText, transcriptId }, 502);
  }
  const claudeJson = await claudeRes.json();
  const toolUse = (claudeJson?.content || []).find((c: { type: string }) => c.type === "tool_use");
  if (!toolUse) {
    return jsonResponse({ error: "Model did not return structured output", diarizedText, transcriptId }, 502);
  }

  const inTok = claudeJson?.usage?.input_tokens || 0;
  const outTok = claudeJson?.usage?.output_tokens || 0;
  const claudeCost = (inTok / 1_000_000) * CLAUDE_USD_PER_MTOK_INPUT + (outTok / 1_000_000) * CLAUDE_USD_PER_MTOK_OUTPUT;
  await admin.from("ai_usage_log").insert({
    org_id: orgId, vendor: "anthropic", units: inTok + outTok, estimated_cost_usd: claudeCost, note: `stage=${stage}`,
  });

  const extracted = { ...toolUse.input, provenance: "ai_generated" };

  return jsonResponse({
    extracted,
    diarizedText,
    transcriptId,
    usage: { deepgramMinutes: dgMinutes, claudeTokens: inTok + outTok, estimatedCostUsd: dgCost + claudeCost, spentThisMonth: spentSoFar + dgCost + claudeCost, budget },
  });
});

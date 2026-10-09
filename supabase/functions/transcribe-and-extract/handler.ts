// The request handler for transcribe-and-extract, kept free of Deno globals
// and `jsr:` imports so the same code runs under Deno (index.ts) and under
// Node's test runner (tests/functions). Everything that touches the outside
// world -- env, fetch, the Supabase client -- comes in through `Deps`.

import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  CLAUDE_MAX_TOKENS,
  CLAUDE_MODEL,
  CLAUDE_USD_PER_MTOK_INPUT,
  CLAUDE_USD_PER_MTOK_OUTPUT,
  CORS_HEADERS,
  DEEPGRAM_LISTEN_URL,
  DEEPGRAM_USD_PER_MINUTE,
  SYSTEM_PROMPT_PREFIX,
  TOOLS,
} from "./contract.ts";

// Just the slice of supabase-js this function uses.
// deno-lint-ignore no-explicit-any
export type SupabaseLike = any;

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  createClient: (url: string, key: string, options?: Record<string, unknown>) => SupabaseLike;
}

// Which staff roles may run each stage, matching the screens that call it:
// Reception (receptionist) records intake; the Doctor screen (surgeon, physio)
// records a consult or a physio session depending on the doctor's specialty.
const STAGE_ROLES: Record<string, string[]> = {
  reception: ["receptionist"],
  consult: ["surgeon", "physio"],
  physio: ["surgeon", "physio"],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
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

  const SUPABASE_URL = deps.env("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = deps.env("SUPABASE_SERVICE_ROLE_KEY")!;
  const DEEPGRAM_API_KEY = deps.env("DEEPGRAM_API_KEY");
  const ANTHROPIC_API_KEY = deps.env("ANTHROPIC_API_KEY");

  if (!DEEPGRAM_API_KEY || !ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "Server is missing DEEPGRAM_API_KEY or ANTHROPIC_API_KEY secrets — see setup-ai-keys.md" }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  const userClient = deps.createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = deps.createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

  // The admin client bypasses RLS, so this function must do the hospital and
  // role checks itself, before any money is spent or anything is stored.
  if (!STAGE_ROLES[stage].includes(String(pract.role))) {
    return jsonResponse({ error: `A ${pract.role} account cannot record the ${stage} stage.` }, 403);
  }
  const { data: patient } = await admin.from("patients").select("org_id").eq("id", patientId).maybeSingle();
  if (!patient || patient.org_id !== orgId) {
    return jsonResponse({ error: "This patient is not in your hospital." }, 403);
  }
  if (encounterId) {
    const { data: enc } = await admin.from("encounters").select("org_id, patient_id").eq("id", encounterId).maybeSingle();
    if (!enc || enc.org_id !== orgId || enc.patient_id !== patientId) {
      return jsonResponse({ error: "This encounter does not belong to this patient in your hospital." }, 403);
    }
  }
  if (planId) {
    const { data: plan } = await admin.from("physiotherapy_plans").select("org_id, patient_id").eq("id", planId).maybeSingle();
    if (!plan || plan.org_id !== orgId || plan.patient_id !== patientId) {
      return jsonResponse({ error: "This therapy plan does not belong to this patient in your hospital." }, 403);
    }
  }

  const { data: org } = await admin.from("organizations").select("ai_monthly_budget_usd").eq("id", orgId).maybeSingle();
  const budget = Number(org?.ai_monthly_budget_usd ?? 45);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const { data: usageRows } = await admin
    .from("ai_usage_log")
    .select("estimated_cost_usd")
    .eq("org_id", orgId)
    .gte("ts", monthStart);
  const spentSoFar = (usageRows || []).reduce((sum: number, r: { estimated_cost_usd: unknown }) => sum + Number(r.estimated_cost_usd), 0);
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

    const dgRes = await deps.fetch(DEEPGRAM_LISTEN_URL, {
      method: "POST",
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, "Content-Type": contentType },
      body: audioBytes,
    });
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
  const claudeRes = await deps.fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
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
}

// Clinical Whisperer -- case-specific reminder prompts for the Doctor screen.
//
// Given a short case summary it asks the model for 4-6 terse "ask / examine /
// verify" reminders for THIS consult. It never produces a diagnosis, drug or
// treatment, and it fails soft: any problem returns HTTP 200 with
// `{ prompts: null, fallback: true, reason }` so the sidebar falls back to its
// static specialty checklist.
//
// Security (backlog SEC03): the gateway's verify_jwt also accepts the public
// anon key, so this handler checks for itself that the caller is a signed-in
// doctor (surgeon or physio) of a hospital, applies the hospital's monthly AI
// budget and writes every call to ai_usage_log. Patient words and model output
// never go into logs: status codes only.
//
// Kept free of Deno globals so Node can test it (tests/functions).

export const DEFAULT_MODEL = "claude-haiku-5";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
// Conservative (Haiku 4.5) list prices; the real model is cheaper, so the
// budget guard errs on the side of stopping early.
const USD_PER_MTOK_INPUT = 1.0;
const USD_PER_MTOK_OUTPUT = 5.0;

export const DOCTOR_ROLES = ["surgeon", "physio"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
export type SupabaseLike = any;

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  createClient: (url: string, key: string, options?: Record<string, unknown>) => SupabaseLike;
}

interface WhispererRequest {
  specialty?: string;
  complaints?: string;
  triageNotes?: string;
  frontDeskNotes?: string;
  conditions?: string[];
  allergies?: string[];
  age?: number | null;
  gender?: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function fallback(reason: string) {
  return jsonResponse({ prompts: null, fallback: true, reason });
}

const clip = (v: unknown, n = 2000) => (typeof v === "string" ? v.slice(0, n) : "");
const clipList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20).map((x) => (x as string).slice(0, 100)) : [];

const SYSTEM_PROMPT = [
  "You are a clinical documentation assistant embedded in a doctor's consultation screen.",
  "Given a short case summary, produce 4 to 6 short, specific prompts that remind the doctor",
  "what to ASK, EXAMINE, or VERIFY during THIS SPECIFIC CONSULTATION, grounded in the case",
  "details given -- not generic textbook advice for the specialty in general.",
  "Each prompt must be a short phrase or question, under 90 characters, in this terse style:",
  '"Radiation of pain — does it travel down the leg?", "Oxygen saturation drops — at rest or on exertion?".',
  "Never suggest a diagnosis, medication, or treatment -- only what to ask, examine, or verify.",
  'Respond with ONLY a JSON object of the exact shape {"prompts": ["...", "..."]} and nothing else --',
  "no markdown fences, no commentary, no explanation.",
].join(" ");

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ prompts: null, fallback: true, reason: "POST only" }, 405);

  const SUPABASE_URL = deps.env("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = deps.env("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Who is calling? The anon key passes the gateway but is not a user.
  const authHeader = req.headers.get("authorization") || "";
  const userClient = deps.createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = deps.createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: "Not signed in" }, 401);

  const { data: pract } = await admin
    .from("practitioners").select("org_id, role").eq("auth_user_id", userData.user.id).maybeSingle();
  if (!pract?.org_id) return jsonResponse({ error: "This login isn't linked to a staff record" }, 403);
  if (!DOCTOR_ROLES.includes(String(pract.role))) {
    return jsonResponse({ error: `A ${pract.role} account cannot use the Clinical Whisperer.` }, 403);
  }
  const orgId = pract.org_id as string;

  // 2. Input.
  let body: WhispererRequest;
  try {
    body = await req.json();
  } catch {
    return fallback("Invalid JSON body");
  }
  const apiKey = deps.env("ANTHROPIC_API_KEY");
  if (!apiKey) return fallback("ANTHROPIC_API_KEY not configured");

  const specialty = clip(body.specialty, 60) || "General";
  const conditions = clipList(body.conditions);
  const allergies = clipList(body.allergies);
  const caseLines = [
    `Specialty: ${specialty}`,
    body.complaints ? `Chief complaints: ${clip(body.complaints)}` : null,
    body.triageNotes ? `Triage notes: ${clip(body.triageNotes)}` : null,
    body.frontDeskNotes ? `Front-desk intake notes: ${clip(body.frontDeskNotes)}` : null,
    conditions.length ? `Known conditions: ${conditions.join(", ")}` : null,
    allergies.length ? `Known allergies: ${allergies.join(", ")}` : null,
    typeof body.age === "number" ? `Age: ${body.age}` : null,
    body.gender ? `Gender: ${clip(body.gender, 20)}` : null,
  ].filter(Boolean);
  if (caseLines.length <= 1) return fallback("No case details yet");

  // 3. Budget: the same monthly ceiling as the recording function.
  const { data: org } = await admin.from("organizations").select("ai_monthly_budget_usd").eq("id", orgId).maybeSingle();
  const budget = Number(org?.ai_monthly_budget_usd ?? 45);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data: usageRows } = await admin
    .from("ai_usage_log").select("estimated_cost_usd").eq("org_id", orgId).gte("ts", monthStart);
  const spent = (usageRows || []).reduce((s: number, r: { estimated_cost_usd: unknown }) => s + Number(r.estimated_cost_usd), 0);
  if (spent >= budget) return fallback("AI budget reached");

  // 4. The model call.
  try {
    const resp = await deps.fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({
        model: deps.env("ANTHROPIC_MODEL") || DEFAULT_MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: caseLines.join("\n") }],
      }),
    });
    if (!resp.ok) {
      console.error("clinical-whisperer: Anthropic API status", resp.status);
      return fallback(`Anthropic API ${resp.status}`);
    }
    const data = await resp.json();
    const inTok = data?.usage?.input_tokens || 0;
    const outTok = data?.usage?.output_tokens || 0;
    await admin.from("ai_usage_log").insert({
      org_id: orgId, vendor: "anthropic", units: inTok + outTok,
      estimated_cost_usd: (inTok / 1e6) * USD_PER_MTOK_INPUT + (outTok / 1e6) * USD_PER_MTOK_OUTPUT,
      note: "stage=whisperer",
    });

    const text: string = data?.content?.[0]?.text ?? "";
    const cleaned = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    let prompts: string[] | null = null;
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.prompts)) {
        prompts = parsed.prompts.filter((p: unknown) => typeof p === "string" && p.trim()).slice(0, 6);
      }
    } catch {
      console.error("clinical-whisperer: response was not JSON");
    }
    if (!prompts || prompts.length === 0) return fallback("Could not parse AI response");
    return jsonResponse({ prompts, fallback: false });
  } catch {
    console.error("clinical-whisperer: unexpected error");
    return fallback("Unexpected server error");
  }
}

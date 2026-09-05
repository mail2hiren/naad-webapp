// @ts-nocheck -- Deno edge runtime; not part of the Vite/tsc build.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Clinical Whisperer -- case-specific AI prompts.
 *
 * Doctor feedback (Dr. Jayani, 2026-09-03): the Clinical Whisperer sidebar
 * showed the same fixed list of prompts for every patient of a given
 * specialty (see src/routes/doctor/ClinicalAssistantSidebar.tsx's
 * CHECKLISTS). She wanted it to actually read the patient's case. This
 * function is that: given the active patient's specialty + case summary, it
 * asks an LLM for 4-6 short, specific prompts tailored to THIS consult, in
 * the same terse checklist style the static list already used.
 *
 * Deliberately conservative about what the model is allowed to say -- these
 * are reminders of what to ask/examine/verify, never a diagnosis or
 * treatment suggestion. verify_jwt is on (see deploy call), so only a
 * signed-in staff session can call this.
 *
 * Required secret: ANTHROPIC_API_KEY (Project Settings -> Edge Functions ->
 * Secrets in the Supabase dashboard -- this function cannot be usefully
 * deployed without it). Optional: ANTHROPIC_MODEL to override the default
 * model id below if it's renamed/retired later.
 *
 * Fails soft, always: any missing key, API error, or unparseable response
 * returns HTTP 200 with `{ prompts: null, fallback: true, reason }` rather
 * than an error status, so the client can drop back to the static
 * specialty checklist without the sidebar ever breaking or showing a raw
 * error to a doctor mid-consult.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_MODEL = 'claude-haiku-5';

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
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ prompts: null, fallback: true, reason: 'POST only' }, 405);

  let body: WhispererRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ prompts: null, fallback: true, reason: 'Invalid JSON body' });
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return jsonResponse({ prompts: null, fallback: true, reason: 'ANTHROPIC_API_KEY not configured' });
  }

  const specialty = body.specialty || 'General';
  const caseLines = [
    `Specialty: ${specialty}`,
    body.complaints ? `Chief complaints: ${body.complaints}` : null,
    body.triageNotes ? `Triage notes: ${body.triageNotes}` : null,
    body.frontDeskNotes ? `Front-desk intake notes: ${body.frontDeskNotes}` : null,
    body.conditions?.length ? `Known conditions: ${body.conditions.join(', ')}` : null,
    body.allergies?.length ? `Known allergies: ${body.allergies.join(', ')}` : null,
    body.age != null ? `Age: ${body.age}` : null,
    body.gender ? `Gender: ${body.gender}` : null,
  ].filter(Boolean);

  if (caseLines.length <= 1) {
    // Nothing but a specialty to go on -- an LLM call would just reinvent
    // the static list with extra latency and cost. Let the client fall
    // back immediately.
    return jsonResponse({ prompts: null, fallback: true, reason: 'No case details yet' });
  }

  const systemPrompt = [
    'You are a clinical documentation assistant embedded in a doctor\'s consultation screen.',
    'Given a short case summary, produce 4 to 6 short, specific prompts that remind the doctor',
    'what to ASK, EXAMINE, or VERIFY during THIS SPECIFIC CONSULTATION, grounded in the case',
    'details given -- not generic textbook advice for the specialty in general.',
    'Each prompt must be a short phrase or question, under 90 characters, in this terse style:',
    '"Radiation of pain — does it travel down the leg?", "Oxygen saturation drops — at rest or on exertion?".',
    'Never suggest a diagnosis, medication, or treatment -- only what to ask, examine, or verify.',
    'Respond with ONLY a JSON object of the exact shape {"prompts": ["...", "..."]} and nothing else --',
    'no markdown fences, no commentary, no explanation.',
  ].join(' ');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: Deno.env.get('ANTHROPIC_MODEL') || DEFAULT_MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: caseLines.join('\n') }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('clinical-whisperer: Anthropic API error', resp.status, errText);
      return jsonResponse({ prompts: null, fallback: true, reason: `Anthropic API ${resp.status}` });
    }

    const data = await resp.json();
    const text: string = data?.content?.[0]?.text ?? '';
    const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();

    let prompts: string[] | null = null;
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.prompts)) {
        prompts = parsed.prompts.filter((p: unknown) => typeof p === 'string' && p.trim()).slice(0, 6);
      }
    } catch (parseErr) {
      console.error('clinical-whisperer: could not parse model response as JSON', text, parseErr);
    }

    if (!prompts || prompts.length === 0) {
      return jsonResponse({ prompts: null, fallback: true, reason: 'Could not parse AI response' });
    }

    return jsonResponse({ prompts, fallback: false });
  } catch (err) {
    console.error('clinical-whisperer: unexpected error', err);
    return jsonResponse({ prompts: null, fallback: true, reason: 'Unexpected server error' });
  }
});

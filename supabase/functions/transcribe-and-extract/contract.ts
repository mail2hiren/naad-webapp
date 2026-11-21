// Pinned contract for transcribe-and-extract: the model, vendor endpoints,
// prompt and tool schemas. Anything here changes what the AI is asked or what
// the app gets back, so tests/functions/transcribe-and-extract.contract.json
// snapshots it and CI fails until that snapshot is updated on purpose
// (UPDATE_CONTRACT=1 npm run test:functions).

export const CLAUDE_MODEL = "claude-haiku-4-5";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const CLAUDE_MAX_TOKENS = 1024;

// mip_opt_out=true keeps our audio out of Deepgram's Model Improvement
// Program: Deepgram keeps it only as long as needed to process the request.
export const DEEPGRAM_LISTEN_URL =
  "https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true&punctuate=true&diarize_model=latest&mip_opt_out=true";

export const DEEPGRAM_USD_PER_MINUTE = 0.005;
export const CLAUDE_USD_PER_MTOK_INPUT = 1.0;
export const CLAUDE_USD_PER_MTOK_OUTPUT = 5.0;

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-stage, x-patient-id, x-encounter-id, x-plan-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const TOOLS: Record<string, { name: string; description: string; input_schema: Record<string, unknown> }> = {
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

export const SYSTEM_PROMPT_PREFIX = `You are a clinical documentation assistant for DigiYaan, an ambient-AI tool used in an Indian orthopedic and physiotherapy practice. You will usually be given a diarized transcript (speakers labeled "Speaker 0", "Speaker 1", etc — you are not told in advance which speaker is the clinician and which is the patient; infer it from context, such as who is asking questions versus describing symptoms). Sometimes, instead, you will be given plain typed notes with no speaker labels at all — a clinician typing instead of recording. Extract the same way either way: pull only what the text actually states.

Hard rules, no exceptions:
- Extract only what was actually said. Never invent, infer beyond what's stated, or fill a field with a plausible-sounding guess.
- Never state a diagnosis as confirmed fact. Any clinical impression must be phrased as tentative and explicitly marked as requiring clinician confirmation.
- If information for a field was not mentioned, say so plainly (e.g. "Not specified — confirm with patient") rather than leaving it ambiguous or inventing a default.
- You are not shown any physical examination and must never fabricate one.
- The transcript may mix Hindi, Marathi, Gujarati and English within the same conversation, or be transcribed imperfectly where the speech-to-text step didn't recognize a non-English word — this is normal for this practice's patients. Write every field in clear English regardless of which language(s) the conversation used. If a word or phrase in the transcript is garbled, untranslatable, or clearly a transcription error, do not guess at its meaning — note the gap explicitly (e.g. "patient described [unclear] — confirm with patient") rather than silently dropping or inventing content.
- Any free-text note field (progressNote, hpi, assessment, etc.) must be YOUR OWN short clinical synthesis in flowing prose — 2 to 4 sentences, written the way a clinician would write it in a chart. It must NEVER be the transcript copied or closely paraphrased verbatim, however long or unstructured the conversation was. "Extract only what was actually said" means don't add facts that weren't said — it does not mean reproduce the dialogue. If the conversation was mostly exploratory (history-taking, no findings yet), say that plainly in one short sentence rather than restating everything that was asked and answered.
- When a value changes over the course of the conversation (e.g. a pain score given as "seven, but it's down to five now"), use the patient's CURRENT/most recently stated value for that field, not an earlier one — and you may mention the earlier value in prose (e.g. in progressNote) for context if useful.
- Call the provided tool exactly once with your extraction. Do not respond in plain text.`;

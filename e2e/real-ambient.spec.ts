import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * REAL ambient-AI path, end to end on the client:
 *   fake microphone -> getUserMedia -> MediaRecorder -> blob upload ->
 *   (stubbed) transcribe-and-extract edge function -> extraction mapped into
 *   the Reception intake / Doctor clinical note.
 *
 * This is the coverage that was missing when "ambient AI" turned out to be a
 * scripted simulation: the existing suite runs against the scripted path and
 * can never exercise a microphone. Here Chromium's fake audio device supplies
 * a real audio stream, and the only thing replaced is the network call to the
 * Supabase edge function (Deepgram + Claude live behind it and are verified
 * separately against the real project).
 */

const FN = /\/functions\/v1\/transcribe-and-extract/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

interface Captured { headers: Record<string, string>; bodyBytes: number }

async function stubFunction(
  page: Page,
  respond: (c: Captured) => { status: number; body: unknown },
): Promise<Captured[]> {
  const calls: Captured[] = [];
  await page.route(FN, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
    const c: Captured = { headers: req.headers(), bodyBytes: req.postDataBuffer()?.length ?? 0 };
    calls.push(c);
    const { status, body } = respond(c);
    await route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  return calls;
}

const USAGE = { deepgramMinutes: 0.1, claudeTokens: 1900, estimatedCostUsd: 0.003, spentThisMonth: 0.01, budget: 45 };

const RECEPTION_OK = {
  extracted: {
    reasonForVisit: 'Left knee pain after a fall', duration: 'Since yesterday evening', trauma: true,
    priorTreatment: 'Ice and rest', reportsAvailable: true, allergiesMentioned: 'Penicillin',
    medicationsMentioned: '', referringDoctor: 'Dr. Mehta',
  },
  diarizedText: 'Speaker 0: What brings you in? Speaker 1: I fell yesterday and my knee hurts, there is swelling.',
  transcriptId: 't-1', usage: USAGE,
};

const CONSULT_OK = {
  extracted: {
    chiefComplaint: 'Right shoulder pain', hpi: 'Three weeks of pain on overhead reaching, worse at night.',
    painLocation: 'Right shoulder', painSeverity: '6/10', painDuration: '3 weeks', trauma: 'No trauma reported',
    aggravating: 'Overhead reaching', relieving: 'Rest', functionalLimitation: 'Cannot lift above shoulder height',
    priorTreatment: 'Over-the-counter analgesics',
    assessment: 'Findings are consistent with possible rotator cuff irritation — not a confirmed diagnosis.',
    plan: 'Consider imaging and a supervised exercise program.',
  },
  diarizedText: 'Speaker 0: Where does it hurt? Speaker 1: My right shoulder.', transcriptId: 't-2', usage: USAGE,
};

const PHYSIO_OK = {
  extracted: {
    painScore: '4', rom: '10-110 degrees', strength: '4/5', mobility: 'Walks without aid',
    exercisesDone: ['Heel slides', 'Quad sets'], tolerance: 'Tolerated well',
    progressNote: 'Pain is improving and range of motion is progressing as planned.',
  },
  diarizedText: 'Speaker 0: How is the knee? Speaker 1: Better.', transcriptId: 't-3', usage: USAGE,
};

async function login(page: Page, role: string, email: string, password: string) {
  if (!page.url().endsWith('/login')) await page.goto('/login');
  await page.getByTestId('login-role').selectOption(role === 'physio' ? 'surgeon' : role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

async function recordFor(page: Page, startTestId: string, stopTestId: string, ms = 1500) {
  await page.getByTestId(startTestId).click();
  await page.waitForTimeout(ms);
  await page.getByTestId(stopTestId).click();
}

test.describe('Reception — real ambient capture', () => {
  test('records real audio, uploads it with the right contract, and folds the extraction into the intake', async ({ page }) => {
    const calls = await stubFunction(page, () => ({ status: 200, body: RECEPTION_OK }));
    await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/reception$/);
    await page.getByTestId('intake-name').fill('Real Capture Patient');

    await page.getByTestId('start-ambient-intake').click();
    await expect(page.getByTestId('start-ambient-intake')).toContainText('Recording');
    await page.waitForTimeout(1500);
    await page.getByTestId('start-ambient-intake').click(); // stop

    await expect(page.getByText('I fell yesterday and my knee hurts')).toBeVisible({ timeout: 10_000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['x-stage']).toBe('reception');
    expect(calls[0].headers['authorization']).toBe('Bearer mock-access-token');
    expect(calls[0].headers['content-type']).toMatch(/^audio\//);
    expect(calls[0].headers['x-patient-id']).toBeTruthy();
    expect(calls[0].bodyBytes).toBeGreaterThan(500); // real recorded audio, not an empty blob

    await expect(page.getByTestId('triage-notes')).toHaveValue(/Reason for visit: Left knee pain after a fall/);
    await expect(page.getByTestId('triage-notes')).toHaveValue(/Allergies mentioned: Penicillin/);
    await expect(page.getByTestId('intake-complaint')).toHaveValue('Left knee pain after a fall');
    // the scripted-simulation line must NOT appear on the real path
    await expect(page.locator('text=worse when I try to walk')).toHaveCount(0);
  });

  test('typed fallback sends text/plain and applies the same extraction', async ({ page }) => {
    const calls = await stubFunction(page, () => ({ status: 200, body: RECEPTION_OK }));
    await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
    await page.getByTestId('intake-name').fill('Typed Patient');
    await page.getByTestId('toggle-typed-intake').click();
    await page.getByTestId('typed-intake-text').fill('Patient fell yesterday and hurt the left knee.');
    await page.getByTestId('submit-typed-intake').click();
    await expect(page.getByTestId('triage-notes')).toHaveValue(/AI Extracted Summary/, { timeout: 10_000 });
    expect(calls[0].headers['content-type']).toMatch(/^text\/plain/);
    expect(calls[0].headers['x-stage']).toBe('reception');
  });

  for (const [status, body, expected] of [
    [402, { error: 'budget_exceeded', message: 'Monthly AI budget reached.' }, /budget reached/i],
    [422, { error: 'no_speech', message: 'No speech was detected.' }, /No speech/i],
    [500, { error: 'Server is missing DEEPGRAM_API_KEY or ANTHROPIC_API_KEY secrets' }, /isn't configured/i],
  ] as const) {
    test(`surfaces a clear message for HTTP ${status} and stays usable`, async ({ page }) => {
      await stubFunction(page, () => ({ status, body }));
      await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
      await page.getByTestId('intake-name').fill('Error Case');
      await recordFor(page, 'start-ambient-intake', 'start-ambient-intake');
      await expect(page.getByText(expected).first()).toBeVisible({ timeout: 10_000 });
      // not stuck: the mic button is enabled again so the user can retry or type
      await expect(page.getByTestId('start-ambient-intake')).toBeEnabled();
      await expect(page.getByTestId('start-ambient-intake')).toContainText('Start Ambient AI Registration');
    });
  }
});

async function registerFreshPatient(page: Page, name: string, complaint: string) {
  await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/reception$/);
  await page.getByTestId('intake-name').fill(name);
  await page.getByTestId('intake-age').fill('47');
  await page.getByTestId('intake-phone').fill('90099011224');
  await page.getByTestId('intake-complaint').fill(complaint);
  await page.getByTestId('register-patient').click();
  await expect(page.getByText('Patient registered and sent to queue')).toBeVisible();
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe('Doctor — real ambient capture', () => {
  test('Orthopedics consult: extraction fills History/Assessment/Plan, leaves Examination to the clinician, opens the quality gate', async ({ page }) => {
    const calls = await stubFunction(page, () => ({ status: 200, body: CONSULT_OK }));
    await registerFreshPatient(page, 'Consult Capture Patient', 'Twisted knee after a fall');
    await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/doctor$/);
    const row = page.locator('div', { hasText: 'Consult Capture Patient' }).filter({ has: page.getByTestId('open-chart') }).last();
    await row.getByTestId('open-chart').click();

    await recordFor(page, 'start-dictation', 'stop-dictation');
    await expect(page.getByText('Ambient AI extraction complete')).toBeVisible({ timeout: 10_000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['x-stage']).toBe('consult');
    expect(calls[0].headers['content-type']).toMatch(/^audio\//);
    expect(calls[0].bodyBytes).toBeGreaterThan(500);

    const soap = page.getByTestId('soap-section');
    await expect(soap.locator('textarea').first()).toHaveValue(/Three weeks of pain on overhead reaching/);
    await expect(soap.locator('textarea').first()).toHaveValue(/Pain severity: 6\/10/);
    await expect(soap.getByTestId('bullet-input').first()).toHaveValue(/possible rotator cuff irritation/);
    await expect(soap.locator('textarea').last()).toHaveValue(/Consider imaging/);
    await expect(soap).toContainText('No examination findings added yet.'); // exam stays clinician-only
  });

  test('Physiotherapy session: progress note, exam bullets and named exercises are mapped', async ({ page }) => {
    const calls = await stubFunction(page, () => ({ status: 200, body: PHYSIO_OK }));
    await login(page, 'physio', 'jayani@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/doctor$/);
    // Kavita Deshmukh is a seeded Physiotherapy patient with an in-progress encounter
    const prow = page.locator('div', { hasText: 'Kavita Deshmukh' }).filter({ has: page.getByTestId('open-chart') }).last();
    await prow.getByTestId('open-chart').click();
    // Kavita's visit is already in progress, so the mic is started from the
    // in-chart "Start Recording" control rather than "Start Dictation".
    await recordFor(page, 'resume-recording', 'stop-dictation');
    await expect(page.getByText('Ambient AI extraction complete')).toBeVisible({ timeout: 10_000 });
    expect(calls[0].headers['x-stage']).toBe('physio');
    expect(calls[0].headers['x-encounter-id']).toBeTruthy();

    const soap = page.getByTestId('soap-section');
    await expect(soap.locator('textarea').first()).toHaveValue(/range of motion is progressing/);
    await expect.poll(async () => (await soap.getByTestId('bullet-input').evaluateAll(
      (els) => els.map((e) => (e as HTMLInputElement).value),
    )).join(' | ')).toMatch(/ROM: 10-110 degrees/);
    await expect.poll(async () => (await page.getByTestId('rehab-section').locator('input').evaluateAll(
      (els) => els.map((e) => (e as HTMLInputElement).value),
    )).join(' | ')).toMatch(/Heel slides[\s\S]*Quad sets|Quad sets[\s\S]*Heel slides/);
  });

  test('typed dictation works as a fallback and releases the live mic', async ({ page }) => {
    const calls = await stubFunction(page, () => ({ status: 200, body: CONSULT_OK }));
    await registerFreshPatient(page, 'Fallback Patient', 'Twisted knee after a fall');
    await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
    const row = page.locator('div', { hasText: 'Fallback Patient' }).filter({ has: page.getByTestId('open-chart') }).last();
    await row.getByTestId('open-chart').click();

    await page.getByTestId('start-dictation').click();
    await page.getByTestId('toggle-typed-dictation').click();
    await page.getByTestId('typed-dictation-text').fill('Right shoulder pain for three weeks.');
    await page.getByTestId('submit-typed-dictation').click();
    await expect(page.getByText('Ambient AI extraction complete')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('soap-section').locator('textarea').first()).toHaveValue(/Three weeks of pain/);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['content-type']).toMatch(/^text\/plain/);

    // stopping afterwards must open the gate without uploading stale audio
    await page.getByTestId('stop-dictation').click();
    await expect(page.getByTestId('signoff-overlay')).toBeVisible();
    expect(calls).toHaveLength(1);
  });

  test('a failed AI call on a recording shows the reason and never blocks the sign-off gate', async ({ page }) => {
    await stubFunction(page, () => ({ status: 422, body: { error: 'no_speech', message: 'No speech was detected.' } }));
    await registerFreshPatient(page, 'Failure Patient', 'Twisted knee after a fall');
    await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
    const row = page.locator('div', { hasText: 'Failure Patient' }).filter({ has: page.getByTestId('open-chart') }).last();
    await row.getByTestId('open-chart').click();

    await recordFor(page, 'start-dictation', 'stop-dictation');
    await expect(page.getByText(/No speech/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('signoff-overlay')).toBeVisible();
  });
});

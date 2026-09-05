import { test, expect } from '@playwright/test';

/**
 * Module 2 (Specialist Doctor Consoles & SOAP Framework) coverage --
 * Clinical_User_Stories rows 3.1.A (Skeletal Assessment Log), 3.1.B
 * (Progression Matrix, mirrored read-only on the Patient Portal), 3.1.C
 * (Comorbidity Risk Scan + Vitals Trend), and 3.3/3.4/3.5 (the full-screen
 * Human-in-the-Loop Sign-Off overlay that replaced the old small centered
 * Quality Gate modal).
 */

async function login(page: import('@playwright/test').Page, role: string, email: string, password: string) {
  // Only hard-navigate if we're not already on the login gate -- a `goto`
  // is a full page reload, which would wipe the mock backend's in-memory
  // tables (module-level state) and defeat any registration that happened
  // earlier in the same test (see registerFreshOrthoPatient below), exactly
  // as noted in e2e/pipeline.spec.ts's own login helper.
  if (!page.url().endsWith('/login')) {
    await page.goto('/login');
  }
  // The login dropdown only exposes a single "Doctor" option (value=surgeon)
  // -- Jayani (role='physio' in the DB) signs in through that same option,
  // exactly like e2e/login.spec.ts's "routes Doctor (physio)..." case.
  const selectValue = role === 'physio' ? 'surgeon' : role;
  await page.getByTestId('login-role').selectOption(selectValue);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

/** Registers a brand-new, encounter-less patient through Reception and
 * routes them to Dr. Sagar's Orthopedics queue -- "Twisted knee after a
 * fall" is the same complaint e2e/pipeline.spec.ts uses to get an automatic
 * Orthopedics queue assignment. A fresh patient (as opposed to seeded ones
 * like Meera Nair, who already carries an in_progress encounter) is what's
 * needed to exercise the real "Start Dictation" -> encounter-created path.
 * Stays on client-side navigation throughout (sign-out never `goto`s) so
 * the mock backend's in-memory tables carry the new patient into the
 * doctor login that follows in the same test. */
async function registerFreshOrthoPatient(page: import('@playwright/test').Page, name: string) {
  await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/reception$/);

  await page.getByTestId('intake-name').fill(name);
  await page.getByTestId('intake-age').fill('47');
  await page.getByTestId('intake-phone').fill('90099011223');
  await page.getByTestId('intake-complaint').fill('Twisted knee after a fall');

  await page.getByTestId('start-ambient-intake').click();
  await expect(page.locator('text=worse when I try to walk')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('start-ambient-intake')).toHaveText(/Start Ambient AI Registration/, { timeout: 5000 });
  await expect(page.getByText('Automated Queue Assignment:')).toContainText('Orthopedics');

  await page.getByTestId('register-patient').click();
  await expect(page.getByText('Patient registered and sent to queue')).toBeVisible();

  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe('Doctor Portal — specialty consoles (Module 2)', () => {
  test('Orthopedics: Skeletal Assessment Log tracks joint alignment on the sidebar', async ({ page }) => {
    const patientName = 'Ortho Skeletal Test Patient';
    await registerFreshOrthoPatient(page, patientName);

    await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/doctor$/);

    const queueRow = page.locator('div', { hasText: patientName }).filter({ has: page.getByTestId('open-chart') }).last();
    await queueRow.getByTestId('open-chart').click();
    await page.getByTestId('start-dictation').click();

    await expect(page.getByTestId('skeletal-assessment-log')).toBeVisible();
    await page.getByTestId('add-joint').click();
    const row = page.getByTestId('joint-row').first();
    await row.locator('input').fill('Left Knee');
    await row.getByTestId('joint-alignment').selectOption('Bone-on-bone');
    await expect(row.locator('input')).toHaveValue('Left Knee');
    await expect(row.getByTestId('joint-alignment')).toHaveValue('Bone-on-bone');
  });

  test('Physiotherapy: Progression Matrix week entry mirrors read-only on the Patient Portal after the visit completes', async ({ page }) => {
    await login(page, 'physio', 'jayani@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/doctor$/);

    // Kavita Deshmukh already has an in-progress encounter with one rehab
    // exercise seeded, so the Progression Matrix has a primary exercise to
    // attach weeks to without any typing first.
    const queueRow = page.locator('div', { hasText: 'Kavita Deshmukh' }).filter({ has: page.getByTestId('open-chart') }).last();
    await queueRow.getByTestId('open-chart').click();

    await expect(page.getByTestId('progression-matrix')).toBeVisible();
    await page.getByTestId('add-week').click();
    const weekRow = page.getByTestId('progression-week-row').first();
    await weekRow.getByTestId('week-pain').fill('4');
    await weekRow.locator('input[placeholder="Reps done"]').fill('12');
    await weekRow.locator('input[placeholder="Note"]').fill('Good range of motion this week');
    // The note autosaves through a 400ms debounce (see persistNote in
    // DoctorView.tsx) -- give it a beat to land before moving on, so
    // Authorize & Route doesn't race ahead of the write.
    await page.waitForTimeout(600);

    // Complete the visit so the note becomes readable from the patient side.
    await page.getByTestId('tab-prescription').click();
    if (await page.getByText('+ Add Medicine').count() > 0 && (await page.locator('input[placeholder="Name"]').count()) === 0) {
      await page.getByText('+ Add Medicine').click();
      await page.locator('input[placeholder="Name"]').first().fill('Paracetamol');
    }
    await page.getByTestId('authorize-route').click();
    await expect(page.getByText('Authorized & routed')).toBeVisible();
    await page.getByTestId('sign-out').click();

    // Patient Portal is a separate, non-staff login (/patient) -- no role
    // dropdown, its own testids, exactly like e2e/patient-portal.spec.ts.
    // Navigate there via the SPA's client-side router (pushState + a
    // synthetic popstate) rather than page.goto(), which would hard-reload
    // the page and wipe the mock backend's in-memory tables -- losing the
    // weekly-progress edit just made -- before the portal ever loads.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/patient');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.getByTestId('patient-login-email').fill('kavita@digiyaan.demo');
    await page.getByTestId('patient-login-password').fill('pass1234');
    await page.getByTestId('patient-login-submit').click();
    await expect(page.getByRole('heading', { name: 'Kavita Deshmukh' })).toBeVisible();
    const visitToggle = page.locator('button', { hasText: /Physiotherapy/ }).first();
    await visitToggle.click();
    await expect(page.getByTestId('portal-progression-matrix')).toBeVisible();
    await expect(page.getByTestId('portal-progression-week')).toContainText('pain 4/10, 12 reps completed — Good range of motion this week');
  });

  test('Critical Care: Comorbidity Risk Scan flags known conditions/allergies, Vitals Trend logs a reading', async ({ page }) => {
    await login(page, 'surgeon', 'namrata@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/doctor$/);

    // Farah Sheikh: Type 2 Diabetes + Penicillin allergy -- both should
    // surface as amber risk flags purely from her existing patient record,
    // with no typing required.
    const queueRow = page.locator('div', { hasText: 'Farah Sheikh' }).filter({ has: page.getByTestId('open-chart') }).last();
    await queueRow.getByTestId('open-chart').click();

    await expect(page.getByTestId('comorbidity-risk-scan')).toBeVisible();
    const flags = page.getByTestId('comorbidity-flag');
    await expect(flags).toHaveCount(2);
    await expect(flags.filter({ hasText: /Glycemic/ })).toBeVisible();
    await expect(flags.filter({ hasText: /Penicillin/ })).toBeVisible();

    await expect(page.getByTestId('vitals-trend')).toBeVisible();
    await page.getByTestId('log-vitals').click();
    const vitalsRow = page.getByTestId('vitals-row').first();
    await vitalsRow.getByTestId('vitals-spo2').fill('91');
    await expect(vitalsRow.getByTestId('vitals-spo2')).toHaveValue('91');
  });

  test('Human-in-the-Loop Sign-Off renders as a full-screen overlay with 4 editable SOAP quadrants', async ({ page }) => {
    const patientName = 'Sign-Off Overlay Test Patient';
    await registerFreshOrthoPatient(page, patientName);

    await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/doctor$/);

    const queueRow = page.locator('div', { hasText: patientName }).filter({ has: page.getByTestId('open-chart') }).last();
    await queueRow.getByTestId('open-chart').click();
    await page.getByTestId('start-dictation').click();
    await page.getByTestId('stop-dictation').click();

    const overlay = page.getByTestId('signoff-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.getByText('Human-in-the-Loop Sign-Off')).toBeVisible();

    // All 4 quadrants present and editable, and edits here land in the same
    // note the Session & Note tab uses (shared onUpdateNote). History/Plan
    // are still free-text; Examination/Assessment are bullet lists (doctor
    // feedback, 2026-09-03) -- add a point, then fill the new row's input.
    await page.getByTestId('signoff-history').fill('Patient reports worsening knee pain over 2 weeks.');
    await page.getByTestId('signoff-examination').getByTestId('bullet-add').click();
    await page.getByTestId('signoff-examination').getByTestId('bullet-input').fill('Tenderness over medial joint line.');
    await page.getByTestId('signoff-assessment').getByTestId('bullet-add').click();
    await page.getByTestId('signoff-assessment').getByTestId('bullet-input').fill('Likely medial meniscus involvement.');
    await page.getByTestId('signoff-plan').fill('MRI knee, ortho follow-up in 1 week.');

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(overlay).toHaveCount(0);
    await page.getByTestId('tab-session').click();
    // Assessment is a bullet-list input now, not plain text -- its value
    // lives in an <input>'s value, not the DOM's text content, so check
    // the Assessment field's bullet input directly rather than getByText.
    const assessmentField = page.locator('label', { hasText: 'Assessment' });
    await expect(assessmentField.getByTestId('bullet-input').first()).toHaveValue('Likely medial meniscus involvement.');
  });
});

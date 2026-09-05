import { test, expect, type Page } from '@playwright/test';

/**
 * Full cross-role clinical pipeline, driven in ONE browser page so the
 * mock backend's in-memory tables (module-level state, see
 * src/mock/mockSupabase.ts) persist across role switches exactly the way
 * the real Supabase project's rows persist across real staff logging in
 * and out from different devices. Signing out only replaces the route
 * (client-side React Router navigation) -- it never reloads the page, so
 * this is a faithful stand-in for "zero-refresh cross-device sync" without
 * ever touching the live production database.
 */

async function login(page: Page, role: string, email: string, password: string) {
  // Only hard-navigate if we're not already on the login gate -- a `goto`
  // here is a full page reload, which would wipe the mock backend's
  // in-memory tables (module-level state) and defeat the entire point of
  // running this pipeline in one page. After signOut() we're already on
  // /login via client-side React Router navigation, so no goto is needed
  // (or wanted) for a role switch.
  if (!page.url().endsWith('/login')) {
    await page.goto('/login');
  }
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

async function signOut(page: Page) {
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
}

test('reception -> doctor -> pharmacy -> admin: one patient all the way through', async ({ page }) => {
  // ---- 1. Reception: walk-in AI Guided Intake + Register & Send to Queue
  await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/reception$/);

  const patientName = 'Pipeline Patient';
  await page.getByTestId('intake-name').fill(patientName);
  await page.getByTestId('intake-age').fill('40');
  await page.getByTestId('intake-phone').fill('90011122233');
  await page.getByTestId('intake-complaint').fill('Twisted knee after a fall');

  await page.getByTestId('start-ambient-intake').click();
  // The hook streams 3 canned lines over ~2.1s then stops recording --
  // wait for the transcript to actually contain the last line rather than
  // a fixed sleep, so this isn't flaky under load.
  await expect(page.locator('text=worse when I try to walk')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('start-ambient-intake')).toHaveText(/Start Ambient AI Registration/, { timeout: 5000 });

  // Non-medical completeness tracker should have lit up Identity/Complaint/Timeline.
  await expect(page.getByText('Automated Queue Assignment:')).toContainText('Orthopedics');

  await page.getByTestId('register-patient').click();
  await expect(page.getByText('Patient registered and sent to queue')).toBeVisible();

  await signOut(page);

  // ---- 2. Doctor: the patient should appear in Dr. Sagar's queue immediately
  await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/doctor$/);

  const queueRow = page.locator('div', { hasText: patientName }).filter({ has: page.getByTestId('open-chart') }).last();
  await expect(queueRow).toBeVisible();
  await queueRow.getByTestId('open-chart').click();

  await expect(page.getByText('3-Second Briefing', { exact: true })).toBeVisible();
  await page.getByTestId('start-dictation').click();
  await expect(page.getByTestId('stop-dictation')).toBeVisible();

  // Quality gate: Orthopedics with an empty note/prescription raises two
  // administrative flags (food-timing, follow-up imaging) -- apply the AI
  // fix to each until the gate reports all clear.
  await page.getByTestId('stop-dictation').click();
  await expect(page.getByText('Before you route this consult')).toBeVisible();
  while (await page.getByTestId('apply-ai-fix').count() > 0) {
    await page.getByTestId('apply-ai-fix').first().click();
  }
  await expect(page.getByText('No missing-data flags detected for this draft.')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  // Human-in-the-loop prescription: add a medicine the pharmacy inventory
  // is deliberately seeded low on, so the Pharmacy step below has a real
  // substitution to flag. Prescription now lives on its own tab (the
  // Doctor Portal consult view was split into tabs to stop everything
  // stacking in one long scroll) -- switch to it first.
  await page.getByTestId('tab-prescription').click();
  await page.getByText('+ Add Medicine').click();
  await page.locator('input[placeholder="Name"]').fill('Salbutamol');
  await page.locator('input[placeholder="Dosage"]').fill('2.5mg');
  await page.locator('input[placeholder="Frequency"]').fill('BD');
  await page.locator('input[placeholder="Duration"]').fill('5 days');
  await page.locator('input[placeholder="Food instruction"]').fill('After meals');

  await page.getByTestId('authorize-route').click();
  await expect(page.getByText('Authorized & routed')).toBeVisible();
  // Authorizing returns to the queue list.
  await expect(page.getByText('My Queue')).toBeVisible();

  await signOut(page);

  // ---- 3. Pharmacy: the authorized order should already be sitting in
  // Pending Orders, with zero manual refresh.
  await login(page, 'pharmacist', 'vikram@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/pharmacy$/);

  const pendingCard = page.locator('.bg-surface-2', { hasText: patientName }).first();
  await expect(pendingCard).toBeVisible();
  await expect(pendingCard.getByText('Low stock')).toBeVisible();

  // Flag the low-stock item for a molecular substitute rather than dispensing blind.
  await pendingCard.getByTestId('flag-alternate').click();
  await expect(page.getByText('Flagged for doctor review')).toBeVisible();
  // Flagging moves the order out of the Pending column entirely into a
  // separate "Needs Doctor Clearance" exceptions section (a different Card,
  // not an update to pendingCard in place) -- scope to that card by its
  // distinctive border-danger class + patient name, since the seed data now
  // includes a second, pre-existing pharmacy exception (Lata Kulkarni's
  // low-stock substitution) that a page-wide getByText would also match.
  const exceptionCard = page.locator('.border-danger', { hasText: patientName }).first();
  await expect(exceptionCard).toBeVisible();
  await expect(exceptionCard.getByText(/molecular equivalents: Levosalbutamol/)).toBeVisible();

  // Pharmacist resumes once the substitution is (deemed) approved. Scoped
  // to this test's own exception card -- the seed data's Lata Kulkarni
  // exception also has a "resume-from-exception" button.
  await exceptionCard.getByTestId('resume-from-exception').click();
  await expect(page.getByText('Resumed to Pending Orders')).toBeVisible();

  const resumedCard = page.locator('.bg-surface-2', { hasText: patientName }).first();
  await resumedCard.getByTestId('start-preparing').click();
  // Scoped to this test's own card -- the seed data's Suresh Pillai order
  // is already 'preparing', so a page-wide getByTestId('order-elapsed')
  // would match both.
  await expect(resumedCard.getByTestId('order-elapsed')).toBeVisible();

  const preparingCard = page.locator('.bg-surface-2', { hasText: patientName }).first();
  await preparingCard.getByTestId('mark-ready').click();

  const readyCard = page.locator('.bg-surface-2', { hasText: patientName }).first();
  await readyCard.getByTestId('dispense').click();
  await expect(page.getByText('Dispensed', { exact: true })).toBeVisible();

  await signOut(page);

  // ---- 4. Admin: fee editor + password recovery tools work over the same
  // shared clinic pool the pipeline just exercised.
  await login(page, 'admin', 'raj@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/admin$/);

  const feeInput = page.getByTestId('fee-input').first();
  await feeInput.fill('950');
  await feeInput.press('Tab');
  await expect(page.getByText('Consult fee updated')).toBeVisible();

  await page.getByTestId('reset-password').first().click();
  await expect(page.getByText(/Temp password:/)).toBeVisible();
});

test('RED ALERT critical bypass routes straight to Dr. Namrata\'s queue', async ({ page }) => {
  await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/reception$/);

  const criticalName = 'Critical Bypass Patient';
  await page.getByTestId('red-alert-btn').click();
  await expect(page.getByText('Critical Bypass Triage')).toBeVisible();
  await page.getByTestId('red-alert-name').fill(criticalName);
  await page.getByTestId('red-alert-complaint').fill('Sudden chest pain, breathless, low oxygen');
  await page.getByTestId('red-alert-confirm').click();
  await expect(page.getByText('Critical bypass routed')).toBeVisible();

  await signOut(page);

  // Dr. Namrata Rao is the seeded Critical Care doctor -- the bypass must
  // land directly in her queue, pre-flagged Critical, with zero refresh.
  await login(page, 'surgeon', 'namrata@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/doctor$/);
  const row = page.locator('div', { hasText: criticalName }).filter({ has: page.getByTestId('open-chart') }).last();
  await expect(row).toBeVisible();
  await expect(row.getByText('Critical', { exact: true })).toBeVisible();
});

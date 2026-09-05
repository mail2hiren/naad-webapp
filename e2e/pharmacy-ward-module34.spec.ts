import { test, expect, type Page } from '@playwright/test';

/**
 * Module 3 (Pharmacy Automation Tickers, Clinical_User_Stories rows 4.0-4.3)
 * and Module 4 (Inpatient Ward Console locks, rows 5.0-5.2) gap-fill.
 *
 * Rows 4.1-4.3 and 5.1-5.2 were already covered by pipeline.spec.ts and
 * ward-discharge.spec.ts before this pass (Kanban stopwatches, substitution
 * flagging, dispense; rounds dictation, stage advance, the Discharge Ledger
 * Sync Gate lock). This file covers the two genuine gaps found on a literal
 * re-read of the sheet: row 4.0's "Card flashes neon border glow on
 * incoming updates" (the toast+chime half already existed globally via
 * ClinicContext) and row 5.0's "Blue indicates stable, Red signifies
 * unstable" bed-matrix coloring (the bed grid previously only showed
 * journey-stage progress, never a clinical stability read).
 */

async function login(page: Page, role: string, email: string, password: string) {
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

test('Pharmacy: a freshly-authorized order gets the neon-flash glow, and low-stock items show generic-equivalent tags', async ({ page }) => {
  // ---- Reception + Doctor: get a fresh order into Pending Orders --------
  await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/reception$/);

  const patientName = 'Ticker Flash Patient';
  await page.getByTestId('intake-name').fill(patientName);
  await page.getByTestId('intake-age').fill('47');
  await page.getByTestId('intake-phone').fill('90055512399');
  await page.getByTestId('intake-complaint').fill('Twisted knee after a fall');
  await page.getByTestId('start-ambient-intake').click();
  await page.getByText('worse when I try to walk').waitFor({ timeout: 5000 });
  await page.getByTestId('register-patient').click();
  await page.getByText('Patient registered and sent to queue').waitFor();
  await signOut(page);

  await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/doctor$/);
  const row = page.locator('div', { hasText: patientName }).filter({ has: page.getByTestId('open-chart') }).last();
  await row.getByTestId('open-chart').click();
  await page.getByTestId('start-dictation').click();
  await page.getByTestId('stop-dictation').click();
  while (await page.getByTestId('apply-ai-fix').count() > 0) {
    await page.getByTestId('apply-ai-fix').first().click();
  }
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('tab-prescription').click();
  await page.getByText('+ Add Medicine').click();
  await page.locator('input[placeholder="Name"]').fill('Salbutamol'); // deliberately low-stock in seed inventory
  await page.locator('input[placeholder="Dosage"]').fill('2.5mg');
  await page.locator('input[placeholder="Frequency"]').fill('BD');
  await page.locator('input[placeholder="Duration"]').fill('5 days');
  await page.locator('input[placeholder="Food instruction"]').fill('After meals');
  await page.getByTestId('authorize-route').click();
  await page.getByText('Authorized & routed').waitFor();
  await signOut(page);

  // ---- Pharmacy: the new order should arrive glowing -- row 4.0 ---------
  await login(page, 'pharmacist', 'vikram@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/pharmacy$/);

  const pendingCard = page.locator('.bg-surface-2', { hasText: patientName }).first();
  await expect(pendingCard).toBeVisible();
  // The card that just arrived carries the flash testid/ring; the board's
  // other (seeded, already-present-on-load) cards must not.
  await expect(pendingCard).toHaveAttribute('data-testid', 'new-order-flash');

  // Row 4.2 -- generic-equivalent tags render on the low-stock item itself,
  // not just inside the eventual exception note.
  await expect(pendingCard.getByTestId('generic-equivalent-tags')).toBeVisible();
  await expect(pendingCard.getByTestId('generic-equivalent-tags').getByText('Levosalbutamol')).toBeVisible();

  // The existing one-click flag flow (row 4.2's core action) is untouched.
  await pendingCard.getByTestId('flag-alternate').click();
  await expect(page.getByText('Flagged for doctor review')).toBeVisible();
});

test('Ward: bed-side stability toggle drives the Blue-stable / Red-unstable bed-matrix indicator', async ({ page }) => {
  await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/doctor$/);
  await page.getByTestId('nav-inpatient').click();
  await expect(page).toHaveURL(/\/inpatient$/);

  // Seeded states: Ramesh Iyer = stable (blue), Suresh Pillai = unstable
  // (red), Lata Kulkarni = not yet assessed (neutral) -- confirms the
  // bed-matrix reads real per-patient data, not one hardcoded default.
  // Scoped by the card's own open-ward-chart button (the established
  // pattern from ward-discharge.spec.ts) -- a `div` scoped only by
  // hasText+bed-stability-pill also matches the inner header row (name +
  // pill stack are siblings there), and .last() resolves to that narrower
  // inner div instead of the whole card.
  const rameshCard = page.locator('div', { hasText: 'Ramesh Iyer' }).filter({ has: page.getByTestId('open-ward-chart') }).last();
  await expect(rameshCard.getByTestId('bed-stability-pill')).toContainText('Stable');

  const sureshCard = page.locator('div', { hasText: 'Suresh Pillai' }).filter({ has: page.getByTestId('open-ward-chart') }).last();
  await expect(sureshCard.getByTestId('bed-stability-pill')).toContainText('Unstable');

  const lataCard = page.locator('div', { hasText: 'Lata Kulkarni' }).filter({ has: page.getByTestId('open-ward-chart') }).last();
  await expect(lataCard.getByTestId('bed-stability-pill')).toContainText('Not yet assessed');

  // Ward staff can flip a bed's status from the chart, and it's reflected
  // both in the detail header and back on the list-view bed card.
  await sureshCard.getByTestId('open-ward-chart').click();
  await expect(page.getByText('Operation').first()).toBeVisible();
  await page.getByTestId('mark-stable').click();
  await expect(page.getByText('Marked Stable')).toBeVisible();

  await page.getByRole('button', { name: /Back to ward list/ }).click();
  const sureshCardAfter = page.locator('div', { hasText: 'Suresh Pillai' }).filter({ has: page.getByTestId('open-ward-chart') }).last();
  await expect(sureshCardAfter.getByTestId('bed-stability-pill')).toContainText('Stable');
});

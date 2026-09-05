import { test, expect, type Page } from '@playwright/test';

/**
 * Inpatient Ward journey (bed grid -> daily rounds -> stage advance ->
 * Discharge Ledger Sync Gate) followed by the Admin Discharge Balance
 * Settlement it hands off to -- one page, one mock backend instance, same
 * cross-role sync story as pipeline.spec.ts. Ramesh Iyer (seeded admitted,
 * journey_stage: 'physiotherapy', Dr. Sagar as his doctor) is the fixture.
 */

async function login(page: Page, role: string, email: string, password: string) {
  // See pipeline.spec.ts's login() for why this guard matters: a `goto`
  // here would be a full page reload, wiping the mock backend's in-memory
  // tables and breaking the cross-role state this test relies on.
  if (!page.url().endsWith('/login')) {
    await page.goto('/login');
  }
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

test('advance stage -> mark for discharge -> Admin settles the balance', async ({ page }) => {
  await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/doctor$/);

  // A surgeon has two reachable workspaces -- use the workspace nav to reach Ward.
  await page.getByTestId('nav-inpatient').click();
  await expect(page).toHaveURL(/\/inpatient$/);

  // exact: true -- the seed data includes a "Prescription authorized for
  // Ramesh Iyer" notification that toasts on a fresh session (unseen
  // notifications toast immediately on load), which also contains this text.
  await expect(page.getByText('Ramesh Iyer', { exact: true })).toBeVisible();
  // Scoped to Ramesh's own card -- the seed data now includes two more
  // admitted/pending-discharge patients (Suresh Pillai, Lata Kulkarni), so
  // a page-wide getByTestId('open-ward-chart') matches three buttons.
  const rameshCard = page.locator('div', { hasText: 'Ramesh Iyer' }).filter({ has: page.getByTestId('open-ward-chart') }).last();
  await rameshCard.getByTestId('open-ward-chart').click();
  await expect(page.getByText('Physiotherapy').first()).toBeVisible();

  // Daily Rounds Voice Dictation accrues a ward ledger charge (seeded at
  // ₹3,500 + ₹1,200 for Ramesh; this note adds ₹1,500 more).
  await page.getByTestId('rounds-note-input').fill('Ambulating independently, wound clean and dry, tolerating physiotherapy well.');
  await page.getByTestId('save-rounds-note').click();
  await expect(page.getByText('Rounds note saved')).toBeVisible();
  await expect(page.getByText('₹6,200')).toBeVisible();

  // Advance Physiotherapy -> Progress Review.
  await page.getByTestId('advance-stage').click();
  await page.locator('textarea[placeholder="Clinical note for this stage change…"]').fill('Meeting rehab milestones, ready for progress review.');
  await page.getByTestId('advance-stage').click();
  await expect(page.getByText('Moved to Progress Review')).toBeVisible();
  await expect(page.getByText('Progress Review', { exact: true }).first()).toBeVisible();

  // Discharge Ledger Sync Gate: locks clinical editing, hands off to Admin.
  await page.getByTestId('mark-for-discharge').click();
  await page.locator('textarea[placeholder="Discharge summary for the clinical record…"]').fill(
    'Right hip replacement recovery uneventful. Discharged home with outpatient physiotherapy follow-up.',
  );
  await page.getByTestId('confirm-discharge').click();
  await expect(page.getByText('Routed to Admin', { exact: true })).toBeVisible();
  await expect(page.getByText('Awaiting Admin discharge clearance')).toBeVisible();

  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);

  // Admin: the same patient should be sitting in Discharge Balance Settlement.
  await login(page, 'admin', 'raj@digiyaan.demo', 'pass1234');
  await expect(page).toHaveURL(/\/admin$/);

  // Note: AdminView's settlement card uses the Tailwind "important" class
  // `!bg-surface-2` -- a literal `!`-prefixed class token that a plain CSS
  // class selector like `.bg-surface-2` will never match. Anchor on the
  // clear-payment button (unique to this card) instead of a class name.
  const settlementCard = page.locator('div', { hasText: 'Ramesh Iyer' }).filter({ has: page.getByTestId('clear-payment') }).last();
  await expect(settlementCard).toBeVisible();
  await expect(settlementCard.getByText('Pending discharge clearance')).toBeVisible();
  // Room charges (3500) + Physio session (1200) + today's new rounds charge (1500).
  await expect(settlementCard.getByText('₹6,200')).toBeVisible();

  await settlementCard.getByTestId('clear-payment').click();
  await expect(page.getByText('Balance cleared')).toBeVisible();
});

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 5 (part 1): the hospital admin's working day, in mock mode. The test
 * build freezes the demo on Saturday 2026-08-29; times are written for India.
 * Role switches sign out without reloading so the in-memory backend keeps rows.
 */
test.use({ timezoneId: 'Asia/Kolkata' });

async function login(page: Page, role: string, email: string) {
  if (!page.url().endsWith('/login')) await page.goto('/login');
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
}
const admin = async (page: Page) => { await login(page, 'admin', 'raj@digiyaan.demo'); await expect(page).toHaveURL(/\/admin$/); };
async function signOut(page: Page) {
  await page.getByTestId('sign-out').filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('overview shows today\'s visits, money, beds and pharmacy', async ({ page }) => {
  await admin(page);
  const o = page.getByTestId('admin-overview');
  await expect(o).toContainText('Visits booked today');
  await expect(o).toContainText('₹800');
  await expect(o).toContainText('₹2,400');
  await expect(o).toContainText('3 of 17');
});

test('working hours: a day off is checked, saved and closes the reception calendar', async ({ page }) => {
  await admin(page);
  await page.getByTestId('nav-admin-hours').click();
  const row = page.locator('li').filter({ hasText: 'Dr. Namrata Rao' });
  await row.getByTestId('edit-hours').click();
  const editor = page.getByTestId('hours-editor');
  await editor.getByLabel('Monday session 1 to').fill('09:00');
  await expect(page.getByTestId('hours-summary')).toContainText('Monday: a session must end after it starts');
  await expect(page.getByTestId('save-hours')).toBeDisabled();
  await editor.getByLabel('Monday session 1 to').fill('14:00');
  await editor.getByTestId('day-sat').uncheck();
  await page.getByTestId('slot-length').selectOption('20');
  await expect(page.getByTestId('hours-summary')).toHaveText('60 bookable slots a week.');
  await page.getByTestId('save-hours').click();
  await expect(row).toContainText('Mon, Tue, Wed, Thu, Fri · 20-min slots');

  await signOut(page);
  await login(page, 'receptionist', 'sunita@digiyaan.demo');
  await page.getByTestId('nav-reception-calendar').click();
  const col = page.getByTestId('doctor-column').filter({ hasText: 'Dr. Namrata Rao' });
  await expect(col).toContainText('20-min slots');
  // Saturday is now a day off: her checked-in patients still show, but no free slots.
  await expect(col.getByTestId('free-slot')).toHaveCount(0);
  await expect(col.getByTestId('appt-card')).toHaveCount(2);
});

test('price list: add, reprice and retire charges, and reception bills from it', async ({ page }) => {
  await admin(page);
  await page.getByTestId('nav-admin-fees').click();
  await page.getByTestId('rate-name').fill('Suture removal');
  await page.getByTestId('rate-category').selectOption('procedure');
  await page.getByTestId('rate-new-amount').fill('300');
  await page.getByTestId('rate-add').click();
  await expect(page.getByTestId('rate-row').filter({ hasText: 'Suture removal' })).toBeVisible();
  await page.getByTestId('rate-name').fill('suture removal');
  await expect(page.getByText('There is already a charge with this name.')).toBeVisible();
  await page.getByTestId('rate-name').fill('');

  const xray = page.getByTestId('rate-row').filter({ hasText: 'X-ray (2 views)' });
  await xray.getByTestId('rate-amount').fill('500');
  await xray.getByTestId('rate-amount').blur();
  await expect(page.getByText('X-ray (2 views): ₹450 to ₹500')).toBeVisible();
  await page.getByTestId('rate-row').filter({ hasText: 'Dressing' }).getByTestId('rate-toggle').click();
  await expect(page.getByTestId('rate-row').filter({ hasText: 'Dressing' })).toHaveCount(0);

  await signOut(page);
  await login(page, 'receptionist', 'sunita@digiyaan.demo');
  await page.getByTestId('nav-reception-billing').click();
  await page.getByTestId('new-bill').click();
  const options = page.getByTestId('add-rate-item').locator('option');
  await expect(options.filter({ hasText: 'Suture removal · ₹300' })).toHaveCount(1);
  await expect(options.filter({ hasText: 'X-ray (2 views) · ₹500' })).toHaveCount(1);
  await expect(options.filter({ hasText: 'Dressing' })).toHaveCount(0);
});

test('wards and beds: add a bed, reprice one, and an occupied bed cannot be closed', async ({ page }) => {
  await admin(page);
  await page.getByTestId('nav-admin-beds').click();
  await page.getByTestId('bed-ward').selectOption('General Ward');
  await page.getByTestId('bed-label').fill('G-9');
  await page.getByTestId('bed-rate').fill('1500');
  await page.getByTestId('bed-add').click();
  const general = page.getByTestId('ward-card').filter({ hasText: 'General Ward' });
  await expect(general.getByTestId('bed-tile')).toHaveCount(9);
  await expect(general).toContainText('2 of 9 occupied');
  await page.getByTestId('bed-label').fill('g-9');
  await expect(page.getByText('General Ward already has a bed called g-9.')).toBeVisible();

  await general.getByTestId('bed-tile').filter({ hasText: 'G-2' }).click();
  await expect(page.getByTestId('bed-modal')).toContainText('Occupied by Ramesh Iyer');
  await expect(page.getByTestId('bed-close')).toBeDisabled();
  await page.getByTestId('bed-edit-rate').fill('1700');
  await page.getByTestId('bed-save').click();
  await expect(general.getByTestId('bed-tile').filter({ hasText: 'G-2' })).toContainText('₹1,700/day');

  await page.getByTestId('ward-card').filter({ hasText: 'ICU' }).getByTestId('bed-tile').filter({ hasText: 'ICU-3' }).click();
  await page.getByTestId('bed-close').click();
  await expect(page.getByTestId('ward-card').filter({ hasText: 'ICU' }).getByTestId('bed-tile').filter({ hasText: 'ICU-3' })).toContainText('Closed');
});

test('reports: today\'s numbers by doctor and money, downloadable as CSV', async ({ page }) => {
  await admin(page);
  await page.getByTestId('nav-admin-reports').click();
  await page.getByTestId('period-today').click();
  await expect(page.getByTestId('report-range')).toHaveText('Saturday, 29 August 2026');
  const sagar = page.getByTestId('visits-table').locator('tr').filter({ hasText: 'Dr. Sagar Karvir' });
  await expect(sagar).toContainText('₹800');
  await expect(page.getByText('Collected', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('owing-list')).toContainText('Kavita Deshmukh');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv-visits').click()]);
  expect(dl.suggestedFilename()).toBe('naad-visits-2026-08-29-to-2026-08-29.csv');
});

test('audit log: actions are recorded, searchable and the chain checks out', async ({ page }) => {
  await admin(page);
  await page.getByTestId('nav-admin-fees').click();
  await page.getByTestId('rate-name').fill('Audit test charge');
  await page.getByTestId('rate-new-amount').fill('10');
  await page.getByTestId('rate-add').click();
  await expect(page.getByTestId('rate-row').filter({ hasText: 'Audit test charge' })).toBeVisible();
  await page.getByTestId('nav-admin-audit').click();
  await expect(page.getByTestId('audit-row').first()).toContainText('admin-rate-added');
  await page.getByTestId('audit-search').fill('Audit test charge');
  await expect(page.getByTestId('audit-row')).toHaveCount(1);
  await page.getByTestId('audit-role').selectOption('surgeon');
  await expect(page.getByTestId('audit-row')).toHaveCount(0);
  await page.getByTestId('audit-check').click();
  await expect(page.getByTestId('audit-check-result')).toContainText('The log has not been changed.');
});

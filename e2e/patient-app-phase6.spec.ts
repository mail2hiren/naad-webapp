import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 6: the patient app on a phone, in mock mode. The test build freezes
 * the demo on Saturday 2026-08-29 at 11:05; times are written for India.
 */
test.use({ timezoneId: 'Asia/Kolkata', viewport: { width: 390, height: 844 } });

async function patientLogin(page: Page, email: string) {
  await page.goto('/patient');
  await page.getByTestId('patient-login-email').fill(email);
  await page.getByTestId('patient-login-password').fill('pass1234');
  await page.getByTestId('patient-login-submit').click();
}
const tab = (page: Page, t: string) => page.getByTestId(`pt-tab-${t}-m`).click();

test('home shows what needs attention; medicines, reports and vitals are the patient\'s own', async ({ page }) => {
  await patientLogin(page, 'ramesh@digiyaan.demo');
  await expect(page.getByRole('heading', { name: 'Ramesh Iyer' })).toBeVisible();
  const alerts = page.getByTestId('home-alerts');
  await expect(alerts).toContainText('Your medicines are ready to collect');
  await expect(alerts).toContainText('Complete blood count');
  await expect(page.getByTestId('my-exercises')).toBeVisible();

  await tab(page, 'medicines');
  await expect(page.getByTestId('rx-card').first()).toContainText('Ready to collect');
  await expect(page.getByTestId('rx-card').first()).toContainText('Etoricoxib 90mg');

  await tab(page, 'reports');
  await expect(page.getByTestId('pt-lab')).toHaveCount(3);
  await expect(page.getByTestId('pt-lab').filter({ hasText: 'Blood sugar' })).toContainText('Awaiting result');
  await expect(page.getByTestId('pt-lab').filter({ hasText: 'Complete blood count' })).toContainText('Doctor noted');
  await expect(page.getByTestId('pt-vitals')).toContainText('BP 128/80');
  await expect(page.getByTestId('pt-doc')).toHaveCount(2);
  // Nobody else's data: Kavita's MRI is not here.
  await expect(page.getByText('MRI, lower back')).toHaveCount(0);
});

test('book from a doctor\'s real free times, then cancel it', async ({ page }) => {
  await patientLogin(page, 'kavita@digiyaan.demo');
  await expect(page.getByRole('heading', { name: 'Kavita Deshmukh' })).toBeVisible();
  await page.getByTestId('home-book').click();
  await expect(page.getByTestId('pt-book-doctor')).toHaveValue('pr-physio');
  await page.getByTestId('pt-book-day').fill('2026-08-30');
  await expect(page.getByTestId('pt-book-none')).toContainText('No free time on Sunday');
  await page.getByTestId('pt-book-day').fill('2026-08-31');
  const times = page.getByTestId('pt-book-times');
  await expect(times).toContainText('9:30 am');
  await expect(times.getByText('11:00 am', { exact: true })).toHaveCount(0); // already taken by another patient
  await times.getByText('9:30 am', { exact: true }).click();
  await page.getByTestId('pt-book-reason').fill('Back stiff in the mornings');
  await page.getByTestId('pt-book-save').click();
  const mine = page.getByTestId('upcoming-appt').filter({ hasText: 'Mon, 31 Aug, 9:30 am' });
  await expect(mine).toContainText('Requested. The front desk will confirm.');

  await mine.getByTestId('cancel-mine').click();
  await page.getByTestId('cancel-mine-confirm').click();
  await expect(page.getByTestId('upcoming-appt').filter({ hasText: '9:30 am' })).toHaveCount(0);
  await expect(page.getByText('Cancelled').first()).toBeVisible();
});

test('a patient request lands on the reception calendar', async ({ page }) => {
  await patientLogin(page, 'kavita@digiyaan.demo');
  await page.getByTestId('home-book').click();
  await page.getByTestId('pt-book-day').fill('2026-08-31');
  await page.getByTestId('pt-book-times').getByText('9:30 am', { exact: true }).click();
  await page.getByTestId('pt-book-save').click();
  await expect(page.getByTestId('upcoming-appt').filter({ hasText: 'Mon, 31 Aug, 9:30 am' })).toContainText('Requested');
  // Switch to the front desk without reloading, so the demo backend keeps the row.
  await page.getByTestId('patient-sign-out').click();
  await page.evaluate(() => { history.pushState({}, '', '/login'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByTestId('login-role').selectOption('receptionist');
  await page.getByTestId('login-email').fill('sunita@digiyaan.demo');
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/reception$/);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('nav-reception-calendar').filter({ visible: true }).click();
  await page.getByTestId('cal-date').fill('2026-08-31');
  const card = page.getByTestId('doctor-column').filter({ hasText: 'Dr. Jayani Bhatt' }).getByTestId('appt-card').filter({ hasText: 'Kavita Deshmukh' });
  await expect(card).toHaveAttribute('data-status', 'requested');
  await expect(card).toContainText('9:30');
});

test('a checked-in patient sees their token and how many are ahead, live', async ({ page }) => {
  await patientLogin(page, 'kavita@digiyaan.demo');
  const live = page.getByTestId('live-queue');
  await expect(live).toContainText('Dr. Jayani Bhatt');
  await expect(live).toContainText('2');
  await expect(live.getByTestId('live-queue-ahead')).toContainText('1 patient ahead of you');
  await expect(live.getByTestId('live-queue-ahead')).toContainText('About 30 min');
});

test('bills show what is owed, with a receipt; a signed-in patient stays signed in after a reload', async ({ page }) => {
  await patientLogin(page, 'kavita@digiyaan.demo');
  await expect(page.getByTestId('home-alerts')).toContainText('₹2,400 to pay');
  await tab(page, 'bills');
  const bill = page.getByTestId('pt-bill').filter({ hasText: 'R-01002' });
  await expect(bill).toContainText('₹2,400 to pay');
  await bill.getByTestId('pt-bill-open').click();
  await expect(page.getByTestId('pt-receipt')).toContainText('Physiotherapy package, 8 sessions');
  await expect(page.getByTestId('pt-receipt')).toContainText('Naad Demo Hospital');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Kavita Deshmukh' })).toBeVisible();
  await expect(page).toHaveURL(/tab=bills/);
});

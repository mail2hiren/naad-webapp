import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 4 front desk, in mock mode. The test build freezes the demo on
 * Saturday 2026-08-29 at 11:05 (src/lib/schedule.ts clinicNow), and the
 * seeded times are written for India, so the browser runs in IST.
 * Each test is one page load; role switches sign out without reloading so
 * the in-memory backend keeps its rows.
 */
test.use({ timezoneId: 'Asia/Kolkata' });

async function login(page: Page, role: string, email: string) {
  if (!page.url().endsWith('/login')) await page.goto('/login');
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
}

async function signOut(page: Page) {
  await page.getByTestId('sign-out').filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function reception(page: Page, section: 'calendar' | 'patients' | 'billing' | 'queue') {
  await login(page, 'receptionist', 'sunita@digiyaan.demo');
  await expect(page).toHaveURL(/\/reception$/);
  await page.getByTestId(`nav-reception-${section}`).click();
}

const column = (page: Page, doctor: string) => page.getByTestId('doctor-column').filter({ hasText: doctor });
const card = (page: Page, doctor: string, patient: string) => column(page, doctor).getByTestId('appt-card').filter({ hasText: patient });

test('the calendar shows a full clinic day for every doctor', async ({ page }) => {
  await reception(page, 'calendar');
  await expect(page.getByTestId('cal-day-label')).toHaveText('Saturday, 29 August 2026');
  await expect(page.getByTestId('doctor-column')).toHaveCount(3);
  await expect(card(page, 'Dr. Sagar Karvir', 'Anil Gokhale')).toContainText('Token 1');
  await expect(card(page, 'Dr. Sagar Karvir', 'Anil Gokhale')).toContainText('Billed');
  await expect(card(page, 'Dr. Sagar Karvir', 'Sunanda Patil')).toContainText('To bill');
  await expect(card(page, 'Dr. Sagar Karvir', 'Imran Shaikh')).toHaveAttribute('data-status', 'no_show');
  await expect(card(page, 'Dr. Sagar Karvir', 'Lata Kulkarni')).toHaveAttribute('data-status', 'requested');
  await expect(column(page, 'Dr. Jayani Bhatt')).toContainText('30-min slots');
  // It is 11:05: morning slots before now are not offered; the first free slot is after it.
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('free-slot').first()).toContainText('11:15');
  // Sunday is a day off; Monday has the follow-ups.
  await page.getByTestId('cal-next').click();
  await expect(page.getByText('Not working on this day.').first()).toBeVisible();
  await page.getByTestId('cal-next').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Suresh Pillai')).toBeVisible();
});

test('book a new patient into a free slot, move it, then cancel it', async ({ page }) => {
  await reception(page, 'calendar');
  await column(page, 'Dr. Sagar Karvir').getByTestId('free-slot').filter({ hasText: '4:15' }).click();
  await page.getByTestId('new-patient').click();
  await page.getByTestId('np-name').fill('Rekha Joshi');
  await page.getByTestId('np-phone').fill('98111 22334');
  await page.getByTestId('np-age').fill('44');
  await page.getByTestId('np-save').click();
  await expect(page.getByTestId('picked-patient')).toContainText('DGY-1015');
  await expect(page.getByTestId('bk-time')).toHaveValue(/\d+/);
  await page.getByTestId('bk-reason').fill('Neck pain');
  await page.getByTestId('bk-save').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Rekha Joshi')).toContainText('4:15');

  await card(page, 'Dr. Sagar Karvir', 'Rekha Joshi').click();
  await page.getByTestId('reschedule').click();
  await page.getByTestId('rs-time').selectOption({ label: '5:30 pm' });
  await page.getByTestId('rs-save').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Rekha Joshi')).toContainText('5:30');
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('free-slot').filter({ hasText: '4:15' })).toBeVisible();

  await card(page, 'Dr. Sagar Karvir', 'Rekha Joshi').click();
  await expect(page.getByTestId('appt-modal')).toContainText('Moved from');
  await page.getByTestId('cancel-appt').click();
  await page.getByTestId('cancel-reason').fill('Patient travelling');
  await page.getByTestId('cancel-confirm').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Rekha Joshi')).toHaveAttribute('data-status', 'cancelled');
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('free-slot').filter({ hasText: '5:30' })).toBeVisible();
});

test('check-in gives the next token and puts the patient in the queue', async ({ page }) => {
  await reception(page, 'calendar');
  await card(page, 'Dr. Sagar Karvir', 'Deepak Rane').click();
  await page.getByTestId('check-in').click();
  await expect(page.getByText('Checked in · Token 5')).toBeVisible();
  await expect(card(page, 'Dr. Sagar Karvir', 'Deepak Rane')).toContainText('Token 5');
  await page.getByTestId('nav-reception-queue').click();
  const row = page.getByTestId('queue-name').filter({ hasText: 'Deepak Rane' });
  await expect(row.getByTestId('queue-token')).toHaveText('Token 5');

  await signOut(page);
  await login(page, 'surgeon', 'sagar@digiyaan.demo');
  await expect(page).toHaveURL(/\/doctor$/);
  await expect(page.getByText('Deepak Rane').first()).toBeVisible();
});

test('a patient request is confirmed; a no-show is booked again', async ({ page }) => {
  await reception(page, 'calendar');
  await card(page, 'Dr. Sagar Karvir', 'Lata Kulkarni').click();
  await page.getByTestId('confirm-request').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Lata Kulkarni')).toHaveAttribute('data-status', 'scheduled');

  await card(page, 'Dr. Sagar Karvir', 'Imran Shaikh').click();
  await page.getByTestId('rebook').click();
  await expect(page.getByTestId('picked-patient')).toContainText('Imran Shaikh');
  await page.getByTestId('bk-time').selectOption({ index: 1 });
  await page.getByTestId('bk-save').click();
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('appt-card').filter({ hasText: 'Imran Shaikh' })).toHaveCount(2);
});

test('billing: bill a seen visit with a discount and part payment, take the rest, void a bill', async ({ page }) => {
  await reception(page, 'billing');
  await expect(page.getByTestId('to-bill').first()).toContainText('Sunanda Patil');
  await page.getByTestId('to-bill').filter({ hasText: 'Sunanda Patil' }).getByTestId('bill-visit').click();
  await expect(page.getByTestId('item-desc').first()).toHaveValue('Follow-up, Dr. Sagar Karvir');
  await page.getByTestId('add-rate-item').selectOption({ label: 'X-ray (2 views) · ₹450' });
  await page.getByTestId('bill-discount').fill('50');
  await expect(page.getByTestId('bill-total')).toHaveText('₹1,200');
  await page.getByTestId('bill-paid').fill('500');
  await page.getByTestId('pay-upi').check();
  await page.getByTestId('bill-save').click();

  const receipt = page.getByTestId('receipt');
  await expect(receipt.getByTestId('receipt-number')).toHaveText('R-01004');
  await expect(receipt).toContainText('Naad Demo Hospital');
  await expect(receipt).toContainText('Balance due');
  await expect(receipt).toContainText('₹700');
  await page.getByTestId('close-receipt').click();
  await expect(page.getByTestId('to-bill').filter({ hasText: 'Sunanda Patil' })).toHaveCount(0);

  const row = page.getByTestId('bill-row').filter({ hasText: 'R-01004' });
  await expect(row).toContainText('Part paid');
  await row.getByTestId('take-payment').click();
  await expect(page.getByTestId('pay-amount')).toHaveValue('700');
  await page.getByTestId('pay-save').click();
  await expect(row).toContainText('Paid');
  await expect(row.getByTestId('take-payment')).toHaveCount(0);

  await page.getByTestId('bills-all').click();
  const old = page.getByTestId('bill-row').filter({ hasText: 'R-01001' });
  await old.getByTestId('void-bill').click();
  await page.getByTestId('void-reason').fill('Duplicate of an insurance bill');
  await page.getByTestId('void-confirm').click();
  await expect(old).toContainText('Void');
});

test('a physio session marks the visit seen, and the patient card shows the package balance', async ({ page }) => {
  await login(page, 'physio', 'jayani@digiyaan.demo');
  await expect(page).toHaveURL(/\/doctor$/);
  await page.getByTestId('nav-physio-caseload').click();
  await page.getByTestId('plan-card').filter({ hasText: 'Rohan Joshi' }).click();
  await page.getByTestId('session-pain').fill('3');
  await page.getByTestId('save-session').click();
  await expect(page.getByText(/Session \d+ saved/)).toBeVisible();
  await signOut(page);

  await reception(page, 'billing');
  await expect(page.getByTestId('to-bill').filter({ hasText: 'Rohan Joshi' })).toContainText('Seen');

  await page.getByTestId('nav-reception-patients').click();
  await page.getByTestId('patients-search').fill('Kavita');
  await page.getByTestId('patient-row').first().click();
  await expect(page.getByTestId('pt-bills')).toContainText('R-01002');
  await expect(page.getByTestId('pt-bills')).toContainText('Due ₹2,400');
});

test('a walk-in gets a token in the doctor\'s day', async ({ page }) => {
  await login(page, 'receptionist', 'sunita@digiyaan.demo');
  await page.getByTestId('nav-reception-walk-in').click();
  await page.getByTestId('intake-name').fill('Walk-in Token Test');
  await page.getByTestId('intake-complaint').fill('Knee pain after a fall');
  await page.getByTestId('register-patient').click();
  await expect(page.getByText('Token 5')).toBeVisible();
  await page.getByTestId('nav-reception-queue').click();
  await expect(page.getByTestId('queue-name').filter({ hasText: 'Walk-in Token Test' }).getByTestId('queue-token')).toHaveText('Token 5');
});

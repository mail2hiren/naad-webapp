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
const drawer = (page: Page) => page.getByTestId('appt-drawer');
const closeDrawer = (page: Page) => page.getByTestId('drawer-close').click();

test('day view: every doctor, every step of the patient flow, blocked time and the now-line', async ({ page }) => {
  await reception(page, 'calendar');
  await expect(page.getByTestId('cal-day-label')).toHaveText('Saturday, 29 August 2026');
  await expect(page.getByTestId('doctor-column')).toHaveCount(3);
  await expect(page.getByTestId('now-line').first()).toBeAttached();
  await expect(card(page, 'Dr. Sagar Karvir', 'Anil Gokhale')).toContainText('Billed');
  await expect(card(page, 'Dr. Sagar Karvir', 'Sunanda Patil')).toContainText('To bill');
  await expect(card(page, 'Dr. Sagar Karvir', 'Meera Nair')).toHaveAttribute('data-status', 'in_consultation');
  await expect(card(page, 'Dr. Sagar Karvir', 'Neha Kelkar')).toHaveAttribute('data-status', 'checked_in');
  await expect(card(page, 'Dr. Sagar Karvir', 'Imran Shaikh')).toHaveAttribute('data-status', 'no_show');
  await expect(card(page, 'Dr. Sagar Karvir', 'Lata Kulkarni')).toHaveAttribute('data-status', 'requested');
  // Cancelled visits are hidden until the filter is ticked.
  await expect(card(page, 'Dr. Sagar Karvir', 'Ramesh Iyer')).toHaveCount(0);
  await page.getByTestId('filter-cancelled').check({ force: true });
  await expect(card(page, 'Dr. Sagar Karvir', 'Ramesh Iyer')).toHaveAttribute('data-status', 'cancelled');
  await expect(column(page, 'Dr. Jayani Bhatt')).toContainText('30-min slots');
  await expect(column(page, 'Dr. Namrata Rao').getByTestId('cal-block')).toContainText('Hospital CME talk');
  // It is 11:05: the first free time offered is after now.
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('free-slot').first()).toContainText('11:15');
  // The live flow panel.
  await expect(page.getByTestId('flow-with')).toContainText('Meera Nair');
  await expect(page.getByTestId('flow-waiting').getByTestId('flow-row')).toHaveCount(5);
  // Sunday is a day off; Monday has the follow-ups and Dr. Karvir's operating list.
  await page.getByTestId('cal-next').click();
  await expect(page.getByText('Not working on this day.').first()).toBeVisible();
  await page.getByTestId('cal-next').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Suresh Pillai')).toBeVisible();
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('cal-block')).toContainText('Operating list');
});

test('the left panel: pick a day on the month, show one doctor, all again', async ({ page }) => {
  await reception(page, 'calendar');
  await page.getByTestId('mini-2026-08-31').click();
  await expect(page.getByTestId('cal-day-label')).toHaveText('Monday, 31 August 2026');
  await page.getByTestId('doctor-only').nth(2).click({ force: true });
  await expect(page.getByTestId('doctor-column')).toHaveCount(1);
  await expect(page.getByTestId('doctor-column')).toContainText('Dr. Sagar Karvir');
  await page.getByTestId('doctors-all').click();
  await expect(page.getByTestId('doctor-column')).toHaveCount(3);
});

test('more room: hide the left panel, the patient flow, or both; doctors stay one tap away', async ({ page }) => {
  await reception(page, 'calendar');
  await expect(page.getByTestId('cal-left')).toBeVisible();
  await page.getByTestId('toggle-left').click();
  await expect(page.getByTestId('cal-left')).toHaveCount(0);
  // With the panel hidden, doctors are picked from chips above the calendar.
  await page.getByTestId('doctor-chip').filter({ hasText: 'Dr. Namrata Rao' }).click();
  await expect(page.getByTestId('doctor-column')).toHaveCount(2);
  await page.getByTestId('toggle-flow').click();
  await expect(page.getByTestId('flow-panel')).toHaveCount(0);
  await expect(page.getByTestId('toggle-focus')).toHaveText('Exit full calendar');
  await page.getByTestId('toggle-focus').click();
  await expect(page.getByTestId('cal-left')).toBeVisible();
  await expect(page.getByTestId('flow-panel')).toBeVisible();
  // The app menu shrinks to icons and stays usable.
  await page.getByTestId('nav-collapse').click();
  await expect(page.getByTestId('nav-reception-patients')).toHaveAttribute('title', 'Patients');
  await page.getByTestId('nav-reception-patients').click();
  await expect(page.getByTestId('patients-search')).toBeVisible();
});

test('week and month views, and search jumps to a booking', async ({ page }) => {
  await reception(page, 'calendar');
  await page.getByTestId('view-week').click();
  await expect(page.getByTestId('cal-day-label')).toHaveText('24 Aug to 30 Aug 2026');
  await expect(page.getByTestId('doctor-column')).toHaveCount(7);
  await expect(page.locator('[data-testid="doctor-column"][data-day="2026-08-29"]').getByTestId('appt-card').filter({ hasText: 'Deepak Rane' })).toBeVisible();
  await page.getByTestId('view-month').click();
  const sat = page.locator('[data-testid="month-day"][data-day="2026-08-29"]');
  await expect(sat).toContainText('booked');
  await page.locator('[data-testid="month-day"][data-day="2026-08-31"]').click();
  await expect(page.getByTestId('cal-day-label')).toHaveText('Monday, 31 August 2026');

  await page.getByTestId('cal-today').click();
  await page.getByTestId('cal-search').fill('Suresh');
  await page.getByTestId('cal-search-result').first().click();
  await expect(drawer(page)).toContainText('Suresh Pillai');
  await expect(drawer(page).getByTestId('drawer-when')).toContainText('Monday, 31 August 2026');
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
  await expect(page.getByTestId('bk-time').getByRole('radio', { checked: true })).toHaveText('4:15p');
  await page.getByTestId('bk-reason').fill('Neck pain');
  await page.getByTestId('bk-save').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Rekha Joshi')).toContainText('4:15');

  await card(page, 'Dr. Sagar Karvir', 'Rekha Joshi').click();
  await page.getByTestId('reschedule').click();
  await page.getByTestId('rs-times').getByRole('radio', { name: '5:30p' }).click();
  await page.getByTestId('rs-save').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Rekha Joshi')).toContainText('5:30');
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('free-slot').filter({ hasText: '4:15' })).toBeVisible();

  await card(page, 'Dr. Sagar Karvir', 'Rekha Joshi').click();
  await expect(drawer(page)).toContainText('Moved from');
  await page.getByTestId('cancel-appt').click();
  await page.getByRole('button', { name: 'Travelling' }).click();
  await page.getByTestId('cancel-confirm').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Rekha Joshi')).toHaveCount(0);
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('free-slot').filter({ hasText: '5:30' })).toBeVisible();
});

test('drag an appointment to another time', async ({ page }) => {
  await reception(page, 'calendar');
  const from = card(page, 'Dr. Sagar Karvir', 'Deepak Rane');
  const col = column(page, 'Dr. Sagar Karvir');
  // The grid starts at 9:00 and is 2.4 px a minute: 12:30 is 210 minutes down.
  await from.dragTo(col, { targetPosition: { x: 40, y: 210 * 2.4 + 2 } });
  await expect(card(page, 'Dr. Sagar Karvir', 'Deepak Rane')).toContainText('12:30');
  await expect(page.getByText('Appointment moved')).toBeVisible();
});

test('patient flow: check in, call in, check out, then bill; the queue and the doctor see it', async ({ page }) => {
  await reception(page, 'calendar');
  await card(page, 'Dr. Sagar Karvir', 'Deepak Rane').click();
  await page.getByTestId('check-in').click();
  await expect(page.getByText('Checked in · Token 5')).toBeVisible();
  await expect(drawer(page).getByTestId('appt-token')).toHaveText('Token 5');
  await page.getByTestId('call-in').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Deepak Rane')).toHaveAttribute('data-status', 'in_consultation');
  await expect(drawer(page).getByTestId('drawer-timeline')).toContainText('With doctor · 11:05');
  await page.getByTestId('check-out').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Deepak Rane')).toHaveAttribute('data-status', 'completed');
  await page.getByTestId('bill-appt').click();
  await expect(page.getByTestId('bill-modal')).toBeVisible();
  await expect(page.getByTestId('item-desc').first()).toHaveValue(/Dr. Sagar Karvir/);
  await page.getByTestId('bill-modal').getByRole('button', { name: 'Cancel' }).click();

  // From the flow panel: Neha (waiting) is called in with one tap.
  await page.getByTestId('flow-waiting').getByTestId('flow-row').filter({ hasText: 'Neha Kelkar' }).getByTestId('flow-call-in').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Neha Kelkar')).toHaveAttribute('data-status', 'in_consultation');
});

test('a doctor opening the chart moves the patient to "With doctor" on the calendar', async ({ page }) => {
  await login(page, 'surgeon', 'sagar@digiyaan.demo');
  await expect(page).toHaveURL(/\/doctor$/);
  await page.locator('div.rounded-lg').filter({ hasText: 'Neha Kelkar' }).getByTestId('open-chart').click();
  await page.getByText('Back to queue').click();
  await signOut(page);
  await reception(page, 'calendar');
  await expect(card(page, 'Dr. Sagar Karvir', 'Neha Kelkar')).toHaveAttribute('data-status', 'in_consultation');
});

test('open the patient record straight from a booking', async ({ page }) => {
  await reception(page, 'calendar');
  await card(page, 'Dr. Jayani Bhatt', 'Kavita Deshmukh').click();
  await expect(page.getByTestId('drawer-patient')).toContainText('Owes ₹2,400');
  await page.getByTestId('open-record').click();
  await expect(page).toHaveURL(/section=patients&patient=p-kavita/);
  const record = page.getByTestId('patient-record');
  await expect(record.getByTestId('record-name')).toHaveText('Kavita Deshmukh');
  await expect(record.getByTestId('record-alerts')).toContainText('Owes ₹2,400');
  await expect(record.getByTestId('record-today')).toContainText('Dr. Jayani Bhatt');
  await page.getByTestId('tab-bills').click();
  await expect(page.getByTestId('pt-bills')).toContainText('R-01002');
  await page.getByTestId('record-back').click();
  await expect(page.getByTestId('doctor-column')).toHaveCount(3);
});

test('patient list: today\'s patients with one-tap check-in; the full record; edit details', async ({ page }) => {
  await reception(page, 'patients');
  await expect(page.getByTestId('pt-filter-today')).toHaveAttribute('aria-pressed', 'true');
  const deepak = page.getByTestId('patient-item').filter({ hasText: 'Deepak Rane' });
  await expect(deepak).toContainText('11:30 am');
  await deepak.getByTestId('list-check-in').click();
  await expect(page.getByText('Checked in · Token 5')).toBeVisible();
  await expect(deepak).toContainText('Token 5');
  await expect(deepak.getByTestId('list-check-in')).toHaveCount(0);

  await page.getByTestId('pt-filter-owes').click();
  await expect(page.getByTestId('patient-item').filter({ hasText: 'Kavita Deshmukh' })).toContainText('Due ₹2,400');

  await page.getByTestId('patients-search').fill('Ramesh');
  await page.getByTestId('patient-row').first().click();
  await expect(page).toHaveURL(/patient=/);
  await page.getByTestId('tab-tests').click();
  await expect(page.getByTestId('record-tests')).toContainText('Complete blood count');
  await expect(page.getByTestId('record-docs')).not.toBeEmpty();
  await page.getByTestId('tab-medicines').click();
  await page.getByTestId('tab-visits').click();
  await expect(page.getByTestId('record-visits')).toContainText('Hip review');

  await page.getByTestId('record-edit').click();
  await page.getByTestId('ed-allergies').fill('Penicillin, Sulfa');
  await page.getByTestId('ed-save').click();
  await expect(page.getByTestId('record-alerts')).toContainText('Allergies: Penicillin, Sulfa');
  await page.getByTestId('record-back').click();
  await expect(page.getByTestId('patients-search')).toBeVisible();
});

test('overbook on purpose, and book a physio course that repeats', async ({ page }) => {
  await reception(page, 'calendar');
  await page.getByTestId('book-new').click();
  await page.getByTestId('patient-search').fill('Anil');
  await page.getByTestId('patient-result').first().click();
  await page.getByTestId('bk-doctor').selectOption('pr-surgeon');
  await page.getByTestId('bk-overbook').check();
  await page.getByTestId('bk-custom-time').fill('11:30');
  await expect(page.getByTestId('bk-problem')).toHaveCount(0);
  await page.getByTestId('bk-save').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Anil Gokhale').filter({ hasText: 'Overbooked' })).toBeVisible();

  await column(page, 'Dr. Jayani Bhatt').getByTestId('free-slot').filter({ hasText: '4:00' }).click();
  await page.getByTestId('patient-search').fill('Rohan');
  await page.getByTestId('patient-result').first().click();
  await page.getByTestId('bk-repeat').check();
  await page.getByTestId('bk-every').selectOption('2');
  await page.getByTestId('bk-count').fill('4');
  await expect(page.getByTestId('bk-plan').locator('li')).toHaveCount(4);
  await page.getByTestId('bk-save').click();
  await expect(page.getByText('4 visits booked')).toBeVisible();
  await card(page, 'Dr. Jayani Bhatt', 'Rohan Joshi').filter({ hasText: '4:00' }).click();
  await expect(page.getByTestId('drawer-series')).toHaveText('Visit 1 of 4');
});

test('block time for a doctor; a cancellation is offered to the waitlist', async ({ page }) => {
  await reception(page, 'calendar');
  await page.getByTestId('block-time').click();
  await page.getByTestId('blk-who').selectOption('pr-physio');
  await page.getByTestId('blk-kind').selectOption('meeting');
  await page.getByTestId('blk-all-day').uncheck();
  await page.getByTestId('blk-from').fill('17:00');
  await page.getByTestId('blk-to').fill('18:00');
  await page.getByTestId('blk-reason').fill('Case review');
  await page.getByTestId('blk-save').click();
  await expect(column(page, 'Dr. Jayani Bhatt').getByTestId('cal-block')).toContainText('Case review');
  await expect(column(page, 'Dr. Jayani Bhatt').getByTestId('free-slot').filter({ hasText: '5:00' })).toHaveCount(0);

  await expect(page.getByTestId('open-waitlist')).toContainText('(1)');
  await card(page, 'Dr. Sagar Karvir', 'Deepak Rane').click();
  await page.getByTestId('cancel-appt').click();
  await page.getByTestId('cancel-reason').fill('Patient called');
  await page.getByTestId('cancel-confirm').click();
  await expect(page.getByTestId('waitlist-offer')).toContainText('Imran Shaikh');
  await page.getByTestId('offer-book').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Imran Shaikh').filter({ hasText: '11:30' })).toHaveAttribute('data-status', 'scheduled');
  await expect(page.getByTestId('open-waitlist')).not.toContainText('(1)');
});

test('a patient request is confirmed; a no-show is booked again', async ({ page }) => {
  await reception(page, 'calendar');
  await card(page, 'Dr. Sagar Karvir', 'Lata Kulkarni').click();
  await page.getByTestId('confirm-request').click();
  await expect(card(page, 'Dr. Sagar Karvir', 'Lata Kulkarni')).toHaveAttribute('data-status', 'scheduled');
  await closeDrawer(page);

  await card(page, 'Dr. Sagar Karvir', 'Imran Shaikh').click();
  await expect(drawer(page)).toContainText('No-show risk');
  await page.getByTestId('rebook').click();
  await expect(page.getByTestId('picked-patient')).toContainText('Imran Shaikh');
  await expect(page.getByTestId('bk-risk')).toBeVisible();
  await page.getByTestId('bk-slot').first().click();
  await page.getByTestId('bk-save').click();
  await expect(column(page, 'Dr. Sagar Karvir').getByTestId('appt-card').filter({ hasText: 'Imran Shaikh' })).toHaveCount(2);
});

test('day sheet lists each doctor\'s day and tomorrow\'s reminders; the token screen shows who is in', async ({ page }) => {
  await reception(page, 'calendar');
  await page.getByTestId('cal-prev').click();
  await page.getByTestId('cal-prev').click();
  await page.getByTestId('day-sheet-open').click();
  await expect(page.getByTestId('day-sheet')).toContainText('Thursday, 27 August 2026');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('cal-today').click();
  await page.getByTestId('cal-next').click();
  await page.getByTestId('day-sheet-open').click();
  await expect(page.getByTestId('sheet-reminders')).toHaveValue(/Suresh Pillai/);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.evaluate(() => { history.pushState({}, '', '/reception?section=display'); dispatchEvent(new PopStateEvent('popstate')); });
  const sagar = page.getByTestId('token-board').filter({ hasText: 'Dr. Sagar Karvir' });
  await expect(sagar.getByTestId('token-now')).toHaveText('3');
  await expect(sagar.getByTestId('token-next')).toContainText('4');
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
  await page.getByTestId('tab-bills').click();
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

import { test, expect, type Page } from '@playwright/test';

/**
 * Front-desk modules (migration 0020) in mock mode, frozen on Saturday
 * 2026-08-29 at 11:05 IST: follow-ups and calls, enquiries, admissions,
 * tests and reports, insurance, packages and day-end cash.
 */
test.use({ timezoneId: 'Asia/Kolkata' });

async function desk(page: Page, section: string) {
  await page.goto('/login');
  await page.getByTestId('login-role').selectOption('receptionist');
  await page.getByTestId('login-email').fill('sunita@digiyaan.demo');
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/reception$/);
  await page.getByTestId(`nav-reception-${section}`).click();
}

test('the sidebar has every front-desk job', async ({ page }) => {
  await desk(page, 'follow-ups');
  for (const s of ['queue', 'calendar', 'patients', 'walk-in', 'follow-ups', 'enquiries', 'admissions', 'tests', 'billing', 'packages', 'insurance', 'cash']) {
    await expect(page.getByTestId(`nav-reception-${s}`)).toBeVisible();
  }
});

test('follow-ups: due groups, log a call, book from a follow-up', async ({ page }) => {
  await desk(page, 'follow-ups');
  const rows = page.getByTestId('fu-row');
  await expect(rows.filter({ hasText: 'Priya Sharma' })).toContainText('last call: No answer');
  const arjun = rows.filter({ hasText: 'Arjun Mehta' });
  await arjun.getByTestId('fu-log').click();
  await arjun.getByTestId('outcome-call_later').click();
  await expect(page.getByText('Call saved: Call later')).toBeVisible();

  const neha = rows.filter({ hasText: 'Neha Kelkar' });
  await neha.getByTestId('fu-book').click();
  await expect(page.getByTestId('picked-patient')).toContainText('Neha Kelkar');
  await page.getByTestId('bk-slot').first().click();
  await page.getByTestId('bk-save').click();
  await expect(rows.filter({ hasText: 'Neha Kelkar' })).toHaveCount(0);
  await page.getByTestId('desk-tab-log').click();
  await expect(page.getByTestId('call-log')).toContainText('Neha Kelkar · Booked');
  await expect(page.getByTestId('call-log')).toContainText('Arjun Mehta · Call later');
});

test('enquiries: note a caller, then turn an enquiry into a booked patient', async ({ page }) => {
  await desk(page, 'enquiries');
  await page.getByTestId('enq-new').click();
  await page.getByTestId('enq-name').fill('Asha Rane');
  await page.getByTestId('enq-phone').fill('98000 12345');
  await page.getByTestId('enq-interest').fill('Back pain, physio fees');
  await page.getByTestId('enq-save').click();
  await expect(page.getByTestId('enq-row').filter({ hasText: 'Asha Rane' })).toBeVisible();

  await page.getByTestId('enq-row').filter({ hasText: 'Mahesh Kale' }).getByTestId('enq-book').click();
  await expect(page.getByTestId('picked-patient')).toContainText('Mahesh Kale');
  await page.getByTestId('bk-slot').first().click();
  await page.getByTestId('bk-save').click();
  await expect(page.getByTestId('enq-row').filter({ hasText: 'Mahesh Kale' })).toHaveCount(0);
  await page.getByTestId('desk-tab-booked').click();
  await expect(page.getByTestId('enq-row').filter({ hasText: 'Mahesh Kale' })).toBeVisible();
});

test('admissions: bed board, admit with a deposit receipt, the running bill', async ({ page }) => {
  await desk(page, 'admissions');
  await expect(page.getByTestId('bed').filter({ hasText: 'Ramesh Iyer' })).toContainText('G-2');
  await page.getByTestId('bed').filter({ hasText: 'G-1' }).getByTestId('bed-admit').click();
  await page.getByTestId('patient-search').fill('Priya');
  await page.getByTestId('patient-result').first().click();
  await page.getByTestId('admit-reason').fill('Shoulder arthroscopy');
  await page.getByTestId('admit-deposit').fill('5000');
  await page.getByTestId('admit-save').click();
  await expect(page.getByTestId('receipt')).toContainText('Admission deposit');
  await page.getByTestId('close-receipt').click();
  await expect(page.getByTestId('bed').filter({ hasText: 'G-1' })).toContainText('Priya Sharma');
  await page.getByTestId('desk-tab-in').click();
  const row = page.getByTestId('admitted-row').filter({ hasText: 'Priya Sharma' });
  await expect(row).toContainText('deposit ₹5,000');
  await expect(row).toContainText('Ward charges ₹1,500');
  await expect(page.getByTestId('admitted-row').filter({ hasText: 'Ramesh Iyer' })).toContainText('Insurance');
});

test('tests and reports: collect, enter the result, hand it over', async ({ page }) => {
  await desk(page, 'tests');
  const sugar = page.getByTestId('lab-row').filter({ hasText: 'Blood sugar, fasting' });
  await sugar.getByTestId('lab-collected').click();
  await page.getByTestId('desk-tab-awaited').click();
  await page.getByTestId('lab-row').filter({ hasText: 'Blood sugar, fasting' }).getByTestId('lab-enter').click();
  await page.getByTestId('lab-result').fill('Fasting glucose 96 mg/dL');
  await page.getByTestId('lab-result-save').click();
  await page.getByTestId('desk-tab-handover').click();
  const done = page.getByTestId('lab-row').filter({ hasText: 'Blood sugar, fasting' });
  await expect(done).toContainText('Fasting glucose 96 mg/dL');
  await done.getByTestId('lab-tell').click();
  await done.getByTestId('outcome-informed').click();
  await expect(page.getByTestId('lab-row').filter({ hasText: 'Blood sugar, fasting' })).toHaveCount(0);
});

test('insurance: the next step on each claim, update a query, start a new claim', async ({ page }) => {
  await desk(page, 'insurance');
  const lata = page.getByTestId('claim-row').filter({ hasText: 'Lata Kulkarni' });
  await expect(lata).toContainText('Insurer has a query');
  await expect(lata).toContainText('Next: Send Investigation reports');
  await lata.getByTestId('claim-update').click();
  await page.getByTestId('claim-status-submitted').click();
  await page.getByTestId('claim-update-save').click();
  await expect(lata).toContainText('Submitted');
  await expect(page.getByTestId('claim-row').filter({ hasText: 'Ramesh Iyer' })).toContainText('approved ₹2,10,000');

  await page.getByTestId('claim-new').click();
  await page.getByTestId('patient-search').fill('Suresh');
  await page.getByTestId('patient-result').first().click();
  await page.getByTestId('claim-insurer').fill('Niva Bupa');
  await page.getByTestId('claim-amount').fill('40000');
  await page.getByTestId('claim-save').click();
  await expect(page.getByTestId('claim-row').filter({ hasText: 'Suresh Pillai' })).toContainText('Draft');
});

test('packages: sessions used and left, book the next session on it, sell one', async ({ page }) => {
  await desk(page, 'packages');
  const kavita = page.getByTestId('pkg-row').filter({ hasText: 'Kavita Deshmukh' });
  await expect(kavita.getByTestId('pkg-used')).toHaveText('0 of 8 used · 8 left · 1 booked');
  await kavita.getByTestId('pkg-book').click();
  await page.getByTestId('bk-date').fill('2026-08-31');
  await page.getByTestId('bk-slot').first().click();
  await page.getByTestId('bk-save').click();
  await expect(kavita.getByTestId('pkg-used')).toHaveText('0 of 8 used · 8 left · 2 booked');

  await page.getByTestId('pkg-sell').click();
  await page.getByTestId('patient-search').fill('Rohan');
  await page.getByTestId('patient-result').first().click();
  await page.getByTestId('pkg-type').selectOption('pkg-physio12');
  await page.getByTestId('pkg-sell-save').click();
  await expect(page.getByTestId('receipt')).toContainText('Physiotherapy, 12 sessions');
  await page.getByTestId('close-receipt').click();
  await expect(page.getByTestId('pkg-row').filter({ hasText: 'Rohan Joshi' })).toContainText('0 of 12 used');
});

test('day-end cash: by payment method, a refund, count the notes, close the day', async ({ page }) => {
  await desk(page, 'cash');
  // The morning's bill (R-01003, Anil) was paid by UPI: no cash taken yet.
  await expect(page.getByTestId('cash-by-method')).toContainText('₹800');
  await page.getByTestId('refund-bill').fill('R-01003');
  await page.getByTestId('refund-amount').fill('100');
  await page.getByTestId('refund-reason').fill('X-ray not done');
  await page.getByTestId('refund-save').click();
  await expect(page.getByText('Refund recorded')).toBeVisible();
  await expect(page.getByTestId('cash-expected')).toHaveText('-₹100');
  await page.getByTestId('cash-float').fill('600');
  await expect(page.getByTestId('cash-expected')).toHaveText('₹500');
  await page.getByTestId('note-200').fill('2');
  await expect(page.getByTestId('cash-diff')).toHaveText('Short ₹100');
  await expect(page.getByTestId('cash-close')).toBeDisabled();
  await page.getByTestId('note-100').fill('1');
  await expect(page.getByTestId('cash-diff')).toHaveText('Matches');
  await page.getByTestId('cash-close').click();
  await expect(page.getByTestId('cash-closed')).toContainText('counted ₹500');
  await expect(page.getByTestId('cash-history')).toContainText('Sunita Kulkarni');
});

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 5 (part 2): the pharmacist's and the ward's working day, in mock
 * mode. The test build freezes the demo on 2026-08-29. Role switches sign
 * out without reloading so the in-memory backend keeps its rows.
 */
test.use({ timezoneId: 'Asia/Kolkata' });

async function login(page: Page, role: string, email: string) {
  if (!page.url().endsWith('/login')) await page.goto('/login');
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
}
const stockRow = (page: Page, drug: string) => page.getByTestId('stock-row').filter({ hasText: drug });

test('stock: reorder and expiry filters, write off an expired batch, receive stock', async ({ page }) => {
  await login(page, 'pharmacist', 'vikram@digiyaan.demo');
  await page.getByTestId('nav-pharmacy-stock').click();
  await page.getByTestId('stock-reorder').click();
  await expect(page.getByTestId('stock-row')).toHaveCount(3);
  await expect(stockRow(page, 'Pantoprazole 40mg')).toContainText('25 tablets usable');

  await page.getByTestId('stock-expired').click();
  await expect(page.getByTestId('stock-row')).toHaveCount(1);
  await stockRow(page, 'Paracetamol 650mg').getByRole('button', { name: /Paracetamol/ }).click();
  await page.getByTestId('batch-row').filter({ hasText: 'PCM-2608' }).getByTestId('write-off').click();
  await expect(page.getByTestId('wo-reason')).toHaveValue('Expired');
  await page.getByTestId('wo-confirm').click();
  await expect(page.getByText('Nothing here.')).toBeVisible();

  await page.getByTestId('stock-all').click();
  await stockRow(page, 'Pantoprazole 40mg').getByTestId('receive-item').click();
  await page.getByTestId('rcv-batch').fill('PAN-2703');
  await expect(page.getByText('This batch number is already in stock for this medicine.')).toBeVisible();
  await page.getByTestId('rcv-batch').fill('PAN-2812');
  await page.getByTestId('rcv-expiry').fill('2028-12-31');
  await page.getByTestId('rcv-qty').fill('100');
  await page.getByTestId('rcv-mrp').fill('8');
  await page.getByTestId('rcv-save').click();
  await expect(stockRow(page, 'Pantoprazole 40mg')).toContainText('125 tablets usable');
  await expect(stockRow(page, 'Pantoprazole 40mg')).not.toContainText('Reorder');

  await page.getByTestId('receive-new').click();
  await page.getByTestId('rcv-drug').fill('Cefixime 200mg');
  await page.getByTestId('rcv-batch').fill('CFX-2801');
  await page.getByTestId('rcv-expiry').fill('2028-01-31');
  await page.getByTestId('rcv-qty').fill('60');
  await page.getByTestId('rcv-mrp').fill('14');
  await page.getByTestId('rcv-save').click();
  await expect(stockRow(page, 'Cefixime 200mg')).toContainText('60 tablets usable');
});

test('dispense: earliest expiry first, short stock shown, stock goes down, sale billed', async ({ page }) => {
  await login(page, 'pharmacist', 'vikram@digiyaan.demo');
  const ready = page.locator('.bg-surface-2', { hasText: 'Ramesh Iyer' }).filter({ has: page.getByTestId('dispense') }).first();
  await ready.getByTestId('dispense').click();
  const lines = page.getByTestId('dispense-line');
  await expect(lines.filter({ hasText: 'Etoricoxib' }).getByTestId('dispense-plan')).toContainText('7 from ETO-2610');
  await lines.filter({ hasText: 'Rabeprazole' }).getByTestId('dispense-qty').fill('60');
  await expect(lines.filter({ hasText: 'Rabeprazole' })).toContainText('Short by 10');
  await lines.filter({ hasText: 'Rabeprazole' }).getByTestId('dispense-qty').fill('7');
  await expect(page.getByTestId('dispense-total')).toHaveText('₹147');
  await page.getByTestId('dispense-save').click();
  await expect(page.getByTestId('receipt').getByTestId('receipt-number')).toHaveText('R-01004');
  await page.getByTestId('close-receipt').click();

  await page.getByTestId('nav-pharmacy-stock').click();
  await expect(stockRow(page, 'Etoricoxib 90mg')).toContainText('133 tablets usable');
  await page.getByTestId('nav-pharmacy-sales').click();
  await expect(page.getByTestId('sale-row').first()).toContainText('R-01004');
  await expect(page.getByTestId('sale-row').first()).toContainText('7 x Etoricoxib 90mg');
});

test('ward: admit to a free bed, record vitals with warnings, move bed', async ({ page }) => {
  await login(page, 'surgeon', 'sagar@digiyaan.demo');
  await page.getByTestId('nav-inpatient').click();
  await page.getByTestId('admit-open').click();
  await page.getByTestId('patient-search').fill('Imran');
  await page.getByTestId('patient-result').first().click();
  await page.getByTestId('admit-bed').selectOption({ label: 'G-1 · General · ₹1,500/day' });
  await page.getByTestId('admit-reason').fill('Ankle fracture, for fixation');
  await page.getByTestId('admit-save').click();
  const card = page.locator('div', { hasText: 'Imran Shaikh' }).filter({ has: page.getByTestId('open-ward-chart') }).last();
  await expect(card.getByTestId('card-bed')).toHaveText('General Ward G-1');
  await expect(page.getByText('13 of 17')).toBeVisible();

  const ramesh = page.locator('div', { hasText: 'Ramesh Iyer' }).filter({ has: page.getByTestId('open-ward-chart') }).last();
  await ramesh.getByTestId('open-ward-chart').click();
  await expect(page.getByTestId('vitals-latest-flags')).toContainText('Latest within range');
  await page.getByTestId('vt-spo2').fill('120');
  await expect(page.getByText('SpO2 must be 50 to 100.')).toBeVisible();
  await expect(page.getByTestId('vt-save')).toBeDisabled();
  await page.getByTestId('vt-spo2').fill('97');
  await page.getByTestId('vt-sys').fill('172');
  await page.getByTestId('vt-dia').fill('100');
  await page.getByTestId('vt-pulse').fill('118');
  await expect(page.getByTestId('vt-warning')).toHaveText('Needs attention: High BP, Fast pulse.');
  await page.getByTestId('vt-save').click();
  await expect(page.getByTestId('vitals-latest-flags')).toContainText('High BP');

  await page.getByTestId('move-bed').click();
  await page.getByTestId('move-bed-to').selectOption({ label: 'G-3 · General · ₹1,500/day' });
  await page.getByTestId('move-bed-save').click();
  await expect(page.getByTestId('bed-current')).toContainText('General Ward · G-3');
});

test('admin clearing a discharge frees the patient\'s bed', async ({ page }) => {
  await login(page, 'admin', 'raj@digiyaan.demo');
  await page.getByTestId('nav-admin-beds').click();
  const p1 = page.getByTestId('bed-tile').filter({ hasText: 'P-1' });
  await expect(p1).toContainText('Lata Kulkarni');
  await page.getByTestId('nav-admin-billing').click();
  await page.locator('div', { hasText: 'Lata Kulkarni' }).filter({ has: page.getByTestId('clear-payment') }).last().getByTestId('clear-payment').click();
  await expect(page.getByText('Balance cleared')).toBeVisible();
  await page.getByTestId('nav-admin-beds').click();
  await expect(p1).toContainText('Free');
});

import { test, expect, type Page } from '@playwright/test';

/**
 * Super admin console (/platform) and hospital admin staff management,
 * end to end in mock mode. The mock backend runs the real platform-admin
 * handler, so these exercise the same permission checks as production.
 * Everything stays inside one page load (the mock data is in memory).
 */

async function setValue(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).fill(value);
}

async function spaGoto(page: Page, path: string) {
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);
}

async function platformSignIn(page: Page, email: string) {
  await page.goto('/platform');
  await setValue(page, 'platform-email', email);
  await setValue(page, 'platform-password', 'pass1234');
  await page.getByTestId('platform-submit').click();
}

test('a hospital staff login cannot open the super admin console', async ({ page }) => {
  await platformSignIn(page, 'raj@digiyaan.demo');
  await expect(page.getByText('Not a super admin login')).toBeVisible();
});

test('super admin adds a hospital, a department and a physio, who then sets her own password', async ({ page }) => {
  await platformSignIn(page, 'owner@digiyaan.demo');
  await expect(page.getByRole('heading', { name: 'Hospitals' })).toBeVisible();
  await expect(page.getByTestId('hospital-row')).toHaveCount(2);

  await page.getByTestId('add-hospital').click();
  await setValue(page, 'hospital-name', 'Lotus Physio Centre');
  await setValue(page, 'hospital-admin-name', 'Priya Desai');
  await setValue(page, 'hospital-admin-email', 'priya@lotus.demo');
  await page.getByTestId('save-hospital').click();
  await expect(page.getByTestId('temp-password-notice')).toContainText('priya@lotus.demo');
  await expect(page.getByTestId('hospital-row')).toHaveCount(3);

  await page.getByRole('link', { name: 'Open the new hospital →' }).click();
  await expect(page.getByTestId('hospital-title')).toHaveText('Lotus Physio Centre');

  await setValue(page, 'department-name', 'Physiotherapy');
  await page.getByTestId('add-department').click();
  await expect(page.getByTestId('department-row')).toHaveCount(1);

  await page.getByTestId('add-staff').click();
  await setValue(page, 'staff-name', 'Dr. Asha Rao');
  await setValue(page, 'staff-email', 'asha@lotus.demo');
  await page.getByTestId('staff-role').selectOption('physio');
  await page.getByTestId('staff-specialty').selectOption('Physiotherapy');
  await page.getByTestId('save-staff').click();
  const tempPassword = (await page.getByTestId('temp-password').textContent())!.trim();
  expect(tempPassword).toHaveLength(12);
  await expect(page.getByTestId('staff-row')).toHaveCount(2);

  await page.getByTestId('platform-nav-activity').click();
  await expect(page.getByTestId('audit-row').first()).toContainText('Added staff');

  // The new physio signs in with the one-time password and must choose her own.
  await page.getByTestId('platform-sign-out').click();
  await spaGoto(page, '/login');
  await page.getByTestId('login-role').selectOption('physio');
  await page.getByTestId('login-email').fill('asha@lotus.demo');
  await page.getByTestId('login-password').fill(tempPassword);
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await page.getByTestId('new-password').fill('Physio-2026!');
  await page.getByTestId('new-password-again').fill('Physio-2026!');
  await page.getByTestId('save-new-password').click();
  await expect(page.getByRole('heading', { name: 'My patients' })).toBeVisible();
  await expect(page.getByText('Lotus Physio Centre')).toBeVisible();
});

test('a hospital admin adds their own staff and departments', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-role').selectOption('admin');
  await page.getByTestId('login-email').fill('raj@digiyaan.demo');
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('nav-admin-departments').click();
  await expect(page.getByTestId('department-row')).toHaveCount(3);
  await page.getByTestId('nav-admin-staff').click();
  await expect(page.getByText('6 of 25 user seats in use')).toBeVisible();
  await page.getByTestId('add-staff').click();
  await setValue(page, 'staff-name', 'Anil Kumar');
  await setValue(page, 'staff-email', 'anil@digiyaan.demo');
  await page.getByTestId('staff-role').selectOption('receptionist');
  await page.getByTestId('save-staff').click();
  await expect(page.getByTestId('temp-password-notice')).toContainText('anil@digiyaan.demo');
  await expect(page.getByText('7 of 25 user seats in use')).toBeVisible();
});

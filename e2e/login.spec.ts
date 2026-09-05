import { test, expect } from '@playwright/test';

/**
 * Secure Authentication Gateway coverage: role dropdown + wrong-role
 * rejection + correct-role routing, for Receptionist, Doctor (surgeon),
 * Pharmacist and Admin. Runs against VITE_USE_MOCK=1 (see playwright.config.ts)
 * so this never touches the live Supabase project.
 */

async function login(page: import('@playwright/test').Page, role: string, email: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

test.describe('Secure Authentication Gateway', () => {
  test('rejects a login when the selected role does not match the account', async ({ page }) => {
    // Sunita is provisioned as Receptionist, not Doctor.
    await login(page, 'surgeon', 'sunita@digiyaan.demo', 'pass1234');
    await expect(page.getByTestId('login-error')).toContainText('provisioned as Receptionist');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('rejects an unknown email/password combination', async ({ page }) => {
    await login(page, 'receptionist', 'nobody@digiyaan.demo', 'wrongpass');
    await expect(page.getByTestId('login-error')).toContainText('Invalid login credentials');
  });

  test('routes Receptionist to /reception on correct credentials', async ({ page }) => {
    await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/reception$/);
    await expect(page.getByTestId('red-alert-btn')).toBeVisible();
  });

  test('routes Doctor (surgeon) to /doctor on correct credentials', async ({ page }) => {
    await login(page, 'surgeon', 'sagar@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/doctor$/);
    await expect(page.getByText('Welcome, Dr. Sagar Karvir')).toBeVisible();
  });

  test('routes Doctor (physio) to /doctor via the same Doctor dropdown option', async ({ page }) => {
    // Jayani is role='physio' in the DB but the login form only exposes a
    // single "Doctor" option (value=surgeon) -- AuthContext accepts this
    // because both roles share the "Doctor" label.
    await login(page, 'surgeon', 'jayani@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/doctor$/);
    await expect(page.getByText('Welcome, Dr. Jayani Bhatt')).toBeVisible();
  });

  test('routes Pharmacist to /pharmacy on correct credentials', async ({ page }) => {
    await login(page, 'pharmacist', 'vikram@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/pharmacy$/);
  });

  test('routes Admin to /admin on correct credentials', async ({ page }) => {
    await login(page, 'admin', 'raj@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText('Admin Control Panel')).toBeVisible();
  });

  test('a route guard sends an unauthenticated visitor back to /login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('sign-out returns to the login gate', async ({ page }) => {
    await login(page, 'admin', 'raj@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

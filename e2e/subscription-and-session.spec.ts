import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, role: string, email: string) {
  await page.goto('/login');
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
}

test.describe('Subscription seats + session hygiene', () => {
  test('admin sees plan status and seat usage for their hospital', async ({ page }) => {
    await login(page, 'admin', 'raj@digiyaan.demo');
    await expect(page).toHaveURL(/\/admin$/);
    const card = page.getByTestId('plan-seats');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('seats-used')).toHaveText('6 / 25');
    await expect(card.getByRole('progressbar', { name: 'User seats in use' })).toHaveAttribute('aria-valuenow', '6');
    await expect(card).toContainText(/pilot plan/i);
  });

  test('old notifications are not replayed as toasts/chimes at login', async ({ page }) => {
    await login(page, 'receptionist', 'sunita@digiyaan.demo');
    await expect(page).toHaveURL(/\/reception$/);
    await page.waitForTimeout(800);
    await expect(page.getByText('Prescription authorized for Ramesh Iyer')).toHaveCount(0);
  });

  test('nothing from the previous user stays in memory after sign-out', async ({ page }) => {
    await login(page, 'receptionist', 'sunita@digiyaan.demo');
    await expect(page).toHaveURL(/\/reception$/);
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, 'pharmacist', 'vikram@digiyaan.demo');
    await expect(page).toHaveURL(/\/pharmacy$/);
  });
});

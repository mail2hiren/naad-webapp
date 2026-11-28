import { test, expect, type Page } from '@playwright/test';

/** Phase 3 physiotherapy module, end to end in mock mode (one page load). */

async function loginPhysio(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-role').selectOption('physio');
  await page.getByTestId('login-email').fill('jayani@digiyaan.demo');
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/doctor$/);
  await page.getByTestId('nav-physio-caseload').click();
}

test('caseload shows active plans, progress and the pending referral', async ({ page }) => {
  await loginPhysio(page);
  await expect(page.getByTestId('plan-card')).toHaveCount(4);
  await expect(page.getByTestId('referral-row')).toContainText('Meera Nair');
  await page.getByTestId('plan-card').filter({ hasText: 'Kavita Deshmukh' }).click();
  await expect(page.getByTestId('plan-patient-name')).toHaveText('Kavita Deshmukh');
  await expect(page.getByTestId('pain-chart')).toBeVisible();
  await expect(page.getByTestId('session-row')).toHaveCount(5);
});

test('recording a session adds it to the record and the progress', async ({ page }) => {
  await loginPhysio(page);
  await page.getByTestId('plan-card').filter({ hasText: 'Rohan Joshi' }).click();
  await page.getByTestId('session-pain').fill('3');
  await page.getByTestId('session-rom').fill('Knee flexion 0-118 deg');
  await page.getByRole('button', { name: 'Mini squats', exact: true }).click();
  await page.getByTestId('session-note').fill('Balance work started.');
  await page.getByTestId('save-session').click();
  await expect(page.getByText('Session 4 saved')).toBeVisible();
  await expect(page.getByTestId('session-row')).toHaveCount(4);
  await expect(page.getByTestId('session-row').first()).toContainText('Pain 3/10');
});

test('accepting a referral starts a therapy plan', async ({ page }) => {
  await loginPhysio(page);
  await page.getByTestId('accept-referral').click();
  await expect(page.getByTestId('plan-condition')).toHaveValue(/Pre-hab/);
  await page.getByTestId('save-plan').click();
  await expect(page.getByText('Therapy plan started')).toBeVisible();
  await expect(page.getByTestId('referral-row')).toHaveCount(0);
  await expect(page.getByTestId('plan-card').filter({ hasText: 'Meera Nair' })).toBeVisible();
});

test('a home exercise added by the physio shows in the patient app', async ({ page }) => {
  await loginPhysio(page);
  await page.getByTestId('plan-card').filter({ hasText: 'Kavita Deshmukh' }).click();
  await expect(page.getByTestId('programme-item')).toHaveCount(4);
  await page.getByTestId('programme-pick').selectOption({ label: 'Cat-camel' });
  await page.getByTestId('programme-add').click();
  await page.getByTestId('programme-save').click();
  await expect(page.getByText('Home programme saved')).toBeVisible();
  await expect(page.getByTestId('programme-item')).toHaveCount(5);

  await page.getByTestId('sign-out').click();
  await page.evaluate(() => { history.pushState({}, '', '/patient'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByTestId('patient-login-email').fill('kavita@digiyaan.demo');
  await page.getByTestId('patient-login-password').fill('pass1234');
  await page.getByTestId('patient-login-submit').click();
  await expect(page.getByTestId('my-exercises')).toContainText('Cat-camel');
  await expect(page.getByTestId('my-progress')).toBeVisible();
});

test('the exercise library can be searched and extended', async ({ page }) => {
  await loginPhysio(page);
  await page.getByTestId('nav-physio-library').click();
  await page.getByTestId('library-search').fill('squat');
  await expect(page.getByTestId('exercise-card')).toHaveCount(1);
  await page.getByTestId('library-search').fill('');
  await page.getByTestId('add-exercise').click();
  await page.getByTestId('exercise-name').fill('Wall sit');
  await page.getByTestId('save-exercise').click();
  await expect(page.getByText('Exercise added')).toBeVisible();
  await expect(page.getByTestId('exercise-card').filter({ hasText: 'Wall sit' })).toBeVisible();
});

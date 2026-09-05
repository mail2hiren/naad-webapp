import { test, expect } from '@playwright/test';

/**
 * Patient Portal (/patient) -- a separate, non-staff login. Ramesh Iyer
 * (p-ramesh) is the only seeded patient with a linked auth_user_id, mirroring
 * the real schema's convention that not every patient has portal access yet.
 */

test('patient signs in, reviews their history, and requests a rebook', async ({ page }) => {
  await page.goto('/patient');
  await expect(page.getByText('Your care history')).toBeVisible();

  // Wrong credentials are rejected the same way staff logins are.
  await page.getByTestId('patient-login-email').fill('ramesh@digiyaan.demo');
  await page.getByTestId('patient-login-password').fill('wrongpassword');
  await page.getByTestId('patient-login-submit').click();
  await expect(page.getByTestId('patient-login-error')).toBeVisible();

  await page.getByTestId('patient-login-password').fill('pass1234');
  await page.getByTestId('patient-login-submit').click();

  await expect(page.getByRole('heading', { name: 'Ramesh Iyer' })).toBeVisible();
  await expect(page.getByText('MRN DGY-1002')).toBeVisible();

  // Longitudinal timeline accordion -- his journey stage history is seeded.
  const firstEntry = page.getByTestId('visit-accordion-header').first();
  await expect(firstEntry).toBeVisible();
  await firstEntry.click();

  // One-Click Rebook Follow-up pipes straight back into the reception booking pool.
  await page.getByTestId('rebook-followup').click();
  await expect(page.getByText(/Requested|Requesting/)).toBeVisible();

  await page.getByTestId('patient-sign-out').click();
  await expect(page.getByText('Your care history')).toBeVisible();
});

test('a staff account cannot use the patient login', async ({ page }) => {
  // Sunita is a real Supabase Auth user, but has no `patients` row linked to
  // her auth_user_id -- the portal must refuse her, not silently show
  // someone else's (or nobody's) chart.
  await page.goto('/patient');
  await page.getByTestId('patient-login-email').fill('sunita@digiyaan.demo');
  await page.getByTestId('patient-login-password').fill('pass1234');
  await page.getByTestId('patient-login-submit').click();
  await expect(page.getByTestId('patient-login-error')).toContainText('No patient record is linked');
});

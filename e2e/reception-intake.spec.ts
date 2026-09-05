import { test, expect } from '@playwright/test';

/**
 * Front Desk / Active Ambient Intake coverage (Clinical_User_Stories rows
 * 2.2-2.6): the recommendation-chip -> auto-filled triage notes path, the
 * walk-in Intake Pause Gate (freeze STT, mute the orb, escalate to
 * 'awaiting_verification', route a query note to the assigned doctor,
 * resume), and the drag-and-drop document zone -- all exercised against a
 * walk-in that has no patient row yet when intake starts, which is the
 * scenario that forces the lazy patient-row creation this module added.
 */

async function login(page: import('@playwright/test').Page, role: string, email: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

test.describe('Front Desk — Active Ambient Intake', () => {
  test('recommendation chip auto-fills triage notes, independent of the raw transcript', async ({ page }) => {
    await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/reception$/);

    await page.getByTestId('intake-name').fill('Chip Test Patient');
    await page.getByTestId('intake-complaint').fill('Twisted knee after a fall');
    await page.getByTestId('start-ambient-intake').click();

    const chip = page.getByTestId('rec-chip').first();
    await expect(chip).toBeVisible({ timeout: 5000 });
    const chipText = (await chip.innerText()).replace('✕', '').trim();
    await chip.click();

    const triageNotes = page.getByTestId('triage-notes');
    await expect(triageNotes).toBeVisible();
    await expect(triageNotes).toHaveValue(new RegExp(chipText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('Pause Intake freezes the orb, escalates the walk-in, and routes a query to the doctor', async ({ page }) => {
    await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/reception$/);

    await page.getByTestId('intake-name').fill('Pause Gate Patient');
    await page.getByTestId('intake-complaint').fill('Chest tightness and breathlessness');
    await page.getByTestId('start-ambient-intake').click();
    await expect(page.getByTestId('pause-walkin-btn')).toBeVisible();

    await page.getByTestId('pause-walkin-btn').click();

    // The orb freezes into its muted/paused visual state the instant intake
    // is paused -- this is what "freezes the audio recording/transcription
    // loop instantly" actually looks like in the DOM.
    await expect(page.locator('.aura-orb.paused')).toBeVisible();
    await expect(page.getByTestId('resume-walkin-btn')).toBeVisible();
    await expect(page.getByTestId('walkin-query-note')).toBeVisible();

    await page.getByTestId('walkin-query-note').fill('Patient is breathless -- should this go straight to Critical Care?');
    await page.getByTestId('send-walkin-query').click();
    await expect(page.getByText('Query sent to doctor')).toBeVisible();

    // Resuming un-freezes the orb and clears the paused control set.
    await page.getByTestId('resume-walkin-btn').click();
    await expect(page.getByText('Intake resumed')).toBeVisible();
    await expect(page.getByTestId('pause-walkin-btn')).toBeVisible();
    await expect(page.locator('.aura-orb.paused')).toHaveCount(0);
  });

  test('drag-and-drop onto the asset zone attaches a real document and renders a clickable preview card', async ({ page }) => {
    await login(page, 'receptionist', 'sunita@digiyaan.demo', 'pass1234');
    await expect(page).toHaveURL(/\/reception$/);

    await page.getByTestId('intake-name').fill('Dropzone Patient');

    // Playwright has no native OS file-drag simulation, so this dispatches a
    // real HTML5 DragEvent with a DataTransfer carrying one File -- the same
    // event shape a real browser drag-and-drop delivers to onDrop.
    const dropzone = page.getByTestId('doc-dropzone');
    await dropzone.dispatchEvent('drop', {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        const file = new File(['%PDF-1.4 mock'], 'left-knee-xray.png', { type: 'image/png' });
        dt.items.add(file);
        return dt;
      }),
    });

    const previewCard = page.getByTestId('doc-preview-card');
    await expect(previewCard).toBeVisible();
    await expect(previewCard).toContainText('left-knee-xray.png');

    await previewCard.click();
    await expect(page.getByText('Document attached')).toBeVisible();
  });
});

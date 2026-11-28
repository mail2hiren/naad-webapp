import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility + mobile-fit gate. Every role's main screen is scanned with
 * axe-core (WCAG 2.1 A/AA) at phone and desktop widths; the page must not
 * scroll sideways and primary controls must be tappable. Serious/critical
 * violations fail the build.
 */
const ROLES: { name: string; role: string; email: string; url: RegExp }[] = [
  { name: 'reception', role: 'receptionist', email: 'sunita@digiyaan.demo', url: /\/reception$/ },
  { name: 'doctor', role: 'surgeon', email: 'sagar@digiyaan.demo', url: /\/doctor$/ },
  { name: 'pharmacy', role: 'pharmacist', email: 'vikram@digiyaan.demo', url: /\/pharmacy$/ },
  { name: 'admin', role: 'admin', email: 'raj@digiyaan.demo', url: /\/admin$/ },
];

async function login(page: Page, role: string, email: string) {
  await page.goto('/login');
  await page.getByTestId('login-role').selectOption(role);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('pass1234');
  await page.getByTestId('login-submit').click();
}

async function scan(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of res.violations) console.log(`AXE [${label}] ${v.impact} ${v.id} x${v.nodes.length} :: ${v.help} :: ${v.nodes[0]?.target?.join(' ')}`);
  return res.violations;
}

for (const vp of [{ n: 'phone', w: 390, h: 844 }, { n: 'desktop', w: 1280, h: 800 }]) {
  test(`login screen ${vp.n}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/login');
    await page.waitForTimeout(600); // let entrance animations settle before measuring contrast
    const v = await scan(page, `login-${vp.n}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`OVERFLOW [login-${vp.n}] ${overflow}`);
    expect(v.filter((x) => x.impact === 'serious' || x.impact === 'critical')).toEqual([]);
  });
}

for (const vp of [{ n: 'phone', w: 390, h: 844 }, { n: 'desktop', w: 1280, h: 800 }]) {
  for (const r of ROLES) {
    test(`${r.name} screen ${vp.n}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await login(page, r.role, r.email);
      await expect(page).toHaveURL(r.url);
      await page.waitForTimeout(500);
      const v = await scan(page, `${r.name}-${vp.n}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      console.log(`OVERFLOW [${r.name}-${vp.n}] ${overflow}`);
      const small = await page.evaluate(() => Array.from(document.querySelectorAll('button, a, select, input, textarea')).filter((el) => {
        const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.height < 36 || b.width < 36);
      }).length);
      console.log(`SMALLTARGETS [${r.name}-${vp.n}] ${small}`);
      expect(v.filter((x) => x.impact === 'serious' || x.impact === 'critical')).toEqual([]);
    });
  }
}

test('doctor open chart phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'surgeon', 'sagar@digiyaan.demo');
  await page.getByTestId('open-chart').first().click();
  await page.waitForTimeout(600);
  const v = await scan(page, 'chart-phone');
  console.log(`OVERFLOW [chart-phone] ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}`);
  expect(v.filter((x) => x.impact === 'serious' || x.impact === 'critical')).toEqual([]);
});

test('patient portal phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/patient');
  await page.getByTestId('patient-login-email').fill('kavita@digiyaan.demo');
  await page.getByTestId('patient-login-password').fill('pass1234');
  await page.getByTestId('patient-login-submit').click();
  await page.waitForTimeout(800);
  const v = await scan(page, 'portal-phone');
  console.log(`OVERFLOW [portal-phone] ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}`);
  expect(v.filter((x) => x.impact === 'serious' || x.impact === 'critical')).toEqual([]);
});

// ---- Touch targets, keyboard and screen-reader affordances -----------------

/** Visible interactive controls smaller than 44x44 CSS px (Apple HIG / WCAG 2.5.5). */
async function undersized(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll(
    'button, a[href], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, [role=tab]',
  )).filter((el) => {
    if (el.closest('.sr-only')) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && (b.height < 43.5 || b.width < 43.5) && getComputedStyle(el).visibility !== 'hidden';
  }).map((el) => `${el.tagName.toLowerCase()}[${(el.getAttribute('data-testid') || el.textContent || '').trim().slice(0, 24)}] ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
}

test('phone: every primary control is at least 44px tall on each screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const failures: string[] = [];
  const screens: [string, string, string][] = [
    ['receptionist', 'sunita@digiyaan.demo', 'reception'], ['surgeon', 'sagar@digiyaan.demo', 'doctor'],
    ['pharmacist', 'vikram@digiyaan.demo', 'pharmacy'], ['admin', 'raj@digiyaan.demo', 'admin'],
  ];
  await page.goto('/login');
  failures.push(...(await undersized(page)).map((f) => `login ${f}`));
  for (const [role, email, name] of screens) {
    await login(page, role, email);
    await page.waitForTimeout(500);
    failures.push(...(await undersized(page)).map((f) => `${name} ${f}`));
    if (name === 'doctor') {
      await page.getByTestId('open-chart').first().click();
      await page.waitForTimeout(500);
      failures.push(...(await undersized(page)).map((f) => `chart ${f}`));
    }
    // On a phone, Sign out lives in the slide-in menu.
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByTestId('sign-out').filter({ visible: true }).click();
  }
  expect(failures).toEqual([]);
});

test('keyboard: a skip link is the first tab stop and jumps to main content', async ({ page }) => {
  await login(page, 'receptionist', 'sunita@digiyaan.demo');
  await expect(page).toHaveURL(/\/reception$/);
  // The title is set in the same effect that resets focus to the page top,
  // so it marks the moment the workspace is ready for keyboard input.
  await expect(page).toHaveTitle("Today's queue — Naad");
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});

test('every workspace has its own page title', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle('Staff sign-in — Naad');
  await login(page, 'receptionist', 'sunita@digiyaan.demo');
  await expect(page).toHaveTitle("Today's queue — Naad");
});

test('screen readers: notifications are announced through a persistent live region', async ({ page }) => {
  await login(page, 'receptionist', 'sunita@digiyaan.demo');
  await expect(page.locator('[role=status][aria-live=polite]')).toHaveCount(1);
});

test('physio caseload, therapy plan and exercise library pass the accessibility scan', async ({ page }) => {
  await login(page, 'physio', 'jayani@digiyaan.demo');
  await page.getByTestId('nav-physio-caseload').click();
  await expect(page.getByTestId('plan-card').first()).toBeVisible();
  const caseload = await scan(page, 'physio-caseload');
  await page.getByTestId('plan-card').first().click();
  await expect(page.getByTestId('record-session')).toBeVisible();
  const planPage = await scan(page, 'physio-plan');
  await page.getByTestId('nav-physio-library').click();
  await expect(page.getByTestId('exercise-card').first()).toBeVisible();
  const library = await scan(page, 'physio-library');
  const serious = [...caseload, ...planPage, ...library].filter((x) => x.impact === 'serious' || x.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
});

for (const vp of [{ n: 'phone', w: 390, h: 844 }, { n: 'desktop', w: 1280, h: 800 }]) {
  test(`reception calendar, booking, billing, receipt and patients pass the scan (${vp.n})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await login(page, 'receptionist', 'sunita@digiyaan.demo');
    await expect(page).toHaveURL(/\/reception$/);
    const nav = async (s: string) => {
      if (vp.n === 'phone') await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByTestId(`nav-reception-${s}`).filter({ visible: true }).click();
    };
    const found: Awaited<ReturnType<typeof scan>> = [];
    const overflow = async (label: string) => {
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(o, `${label} scrolls sideways`).toBeLessThanOrEqual(0);
    };
    await nav('calendar');
    await expect(page.getByTestId('doctor-column').first()).toBeVisible();
    found.push(...await scan(page, `calendar-${vp.n}`)); await overflow('calendar');
    await page.getByTestId('book-new').click();
    await expect(page.getByTestId('booking-modal')).toBeVisible();
    found.push(...await scan(page, `booking-${vp.n}`));
    await page.getByTestId('booking-modal').getByRole('button', { name: 'Cancel' }).click();
    await nav('billing');
    await expect(page.getByTestId('bill-row').first()).toBeVisible();
    found.push(...await scan(page, `billing-${vp.n}`)); await overflow('billing');
    await page.getByTestId('bill-visit').first().click();
    await expect(page.getByTestId('bill-modal')).toBeVisible();
    found.push(...await scan(page, `bill-${vp.n}`));
    await page.getByTestId('bill-save').click();
    await expect(page.getByTestId('receipt')).toBeVisible();
    await page.waitForTimeout(600); // let the "bill saved" notification finish fading in before measuring contrast
    found.push(...await scan(page, `receipt-${vp.n}`));
    await page.getByTestId('close-receipt').click();
    await nav('patients');
    await page.getByTestId('patient-row').first().click();
    await expect(page.getByTestId('patient-detail')).toBeVisible();
    found.push(...await scan(page, `patients-${vp.n}`)); await overflow('patients');
    const serious = found.filter((x) => x.impact === 'serious' || x.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

for (const vp of [{ n: 'phone', w: 390, h: 844 }, { n: 'desktop', w: 1280, h: 800 }]) {
  test(`admin hours, price list, beds, reports and audit log pass the scan (${vp.n})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await login(page, 'admin', 'raj@digiyaan.demo');
    await expect(page).toHaveURL(/\/admin$/);
    const found: Awaited<ReturnType<typeof scan>> = [];
    for (const s of ['hours', 'fees', 'beds', 'reports', 'audit']) {
      if (vp.n === 'phone') await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByTestId(`nav-admin-${s}`).filter({ visible: true }).click();
      if (s === 'hours') await page.getByTestId('edit-hours').first().click();
      await page.waitForTimeout(400);
      found.push(...await scan(page, `admin-${s}-${vp.n}`));
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(o, `admin ${s} scrolls sideways`).toBeLessThanOrEqual(0);
    }
    const serious = found.filter((x) => x.impact === 'serious' || x.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

for (const vp of [{ n: 'phone', w: 390, h: 844 }, { n: 'desktop', w: 1280, h: 800 }]) {
  test(`pharmacy stock, dispense, sales and the ward chart pass the scan (${vp.n})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const found: Awaited<ReturnType<typeof scan>> = [];
    const nav = async (id: string) => {
      if (vp.n === 'phone') await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByTestId(id).filter({ visible: true }).click();
    };
    const fits = async (label: string) => {
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(o, `${label} scrolls sideways`).toBeLessThanOrEqual(0);
    };
    await login(page, 'pharmacist', 'vikram@digiyaan.demo');
    await expect(page).toHaveURL(/\/pharmacy$/);
    await page.getByTestId('dispense').first().click();
    await expect(page.getByTestId('dispense-modal')).toBeVisible();
    found.push(...await scan(page, `dispense-${vp.n}`));
    await page.getByTestId('dispense-modal').getByRole('button', { name: 'Cancel' }).click();
    await nav('nav-pharmacy-stock');
    await page.getByTestId('stock-row').first().getByRole('button').first().click();
    await page.waitForTimeout(300);
    found.push(...await scan(page, `stock-${vp.n}`)); await fits('stock');
    await nav('nav-pharmacy-sales');
    found.push(...await scan(page, `sales-${vp.n}`)); await fits('sales');

    await page.evaluate(() => sessionStorage.clear()); // sign out before switching user
    await login(page, 'surgeon', 'sagar@digiyaan.demo');
    await expect(page).toHaveURL(/\/doctor$/);
    await nav('nav-inpatient');
    await page.getByTestId('open-ward-chart').first().click();
    await expect(page.getByTestId('vitals-panel')).toBeVisible();
    await page.waitForTimeout(400);
    found.push(...await scan(page, `ward-chart-${vp.n}`)); await fits('ward chart');
    const serious = found.filter((x) => x.impact === 'serious' || x.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

for (const vp of [{ n: 'phone', w: 390, h: 844 }, { n: 'desktop', w: 1280, h: 800 }]) {
  test(`patient app: every tab and the booking form pass the scan (${vp.n})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/patient');
    await page.getByTestId('patient-login-email').fill('kavita@digiyaan.demo');
    await page.getByTestId('patient-login-password').fill('pass1234');
    await page.getByTestId('patient-login-submit').click();
    await expect(page.getByRole('heading', { name: 'Kavita Deshmukh' })).toBeVisible();
    const found: Awaited<ReturnType<typeof scan>> = [];
    for (const t of ['home', 'visits', 'medicines', 'bills', 'reports']) {
      await page.getByTestId(vp.n === 'phone' ? `pt-tab-${t}-m` : `pt-tab-${t}`).click();
      if (t === 'visits') { await page.getByTestId('visits-book').click(); await page.getByTestId('pt-book-day').fill('2026-08-31'); }
      await page.waitForTimeout(400);
      found.push(...await scan(page, `patient-${t}-${vp.n}`));
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(o, `patient ${t} scrolls sideways`).toBeLessThanOrEqual(0);
    }
    const serious = found.filter((x) => x.impact === 'serious' || x.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

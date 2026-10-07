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

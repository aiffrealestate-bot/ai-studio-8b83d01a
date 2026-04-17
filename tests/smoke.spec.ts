import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Landing Page Smoke Tests', () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });
  });

  test('1. Page loads with HTTP 200', async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
  });

  test('2. Hero section is visible', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const hero = page.locator(
      'section[data-testid="hero"], #hero, [class*="hero"], header'
    ).first();
    await expect(hero).toBeVisible();
    // Also verify there is meaningful heading text in the hero area
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();
    const headingText = await heading.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  test('3. Primary CTA button is present and clickable', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const cta = page.locator(
      'button[data-testid="cta"], a[data-testid="cta"], ' +
      '[class*="cta"], ' +
      'button:has-text("Get Started"), a:has-text("Get Started"), ' +
      'button:has-text("Sign Up"), a:has-text("Sign Up"), ' +
      'button:has-text("Start"), a:has-text("Start"), ' +
      'button:has-text("Join"), a:has-text("Join"), ' +
      'button:has-text("Try"), a:has-text("Try"), ' +
      'button:has-text("Contact"), a:has-text("Contact")'
    ).first();
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
    // Verify it is clickable without throwing
    await cta.click({ force: false });
  });

  test('4. No console errors on load', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    // Allow known non-critical third-party noise but fail on JS errors
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('favicon') &&
        !err.includes('net::ERR_BLOCKED_BY_CLIENT') &&
        !err.includes('analytics') &&
        !err.includes('gtag')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('5. Mobile viewport renders without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const bodyScrollWidth = await page.evaluate(
      () => document.body.scrollWidth
    );
    const viewportWidth = await page.evaluate(
      () => window.innerWidth
    );
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test('6. All internal links resolve without 404', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const internalLinks: string[] = await page.evaluate((base) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => {
          try {
            const url = new URL(href);
            const baseUrl = new URL(base);
            return (
              url.hostname === baseUrl.hostname &&
              !href.startsWith('mailto:') &&
              !href.startsWith('tel:') &&
              url.hash === ''
            );
          } catch {
            return false;
          }
        });
    }, BASE_URL);

    const uniqueLinks = [...new Set(internalLinks)];

    if (uniqueLinks.length === 0) {
      test.info().annotations.push({
        type: 'warning',
        description: 'No internal links found to validate.'
      });
      return;
    }

    for (const link of uniqueLinks) {
      const response = await page.request.get(link);
      expect(
        response.status(),
        `Expected ${link} to not return 404, got ${response.status()}`
      ).not.toBe(404);
    }
  });

  test('7. Health API endpoint returns 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/health`);
    expect(response.status()).toBe(200);
  });
});

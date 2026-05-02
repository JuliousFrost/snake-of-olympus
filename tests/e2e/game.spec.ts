import { expect, test } from '@playwright/test';

test('boots game, starts match, pauses, and restarts without page reload', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(100);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  await expect(page.locator('canvas')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

import { expect, test } from '@playwright/test';

test('a guest can connect and reach character creation', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Вход в аккаунт' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить без регистрации' })).toBeVisible();

  await page.getByRole('button', { name: 'Продолжить без регистрации' }).click();

  await expect(page.locator('[data-race="Кот"]')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('[data-race="Собака"]')).toBeVisible();
  await expect(page.locator('[data-race="Птица"]')).toBeVisible();
  await expect(page.locator('[data-race="Грызун"]')).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath('character-creation.png'),
    fullPage: true
  });

  expect(pageErrors, 'The game page should not throw JavaScript errors').toEqual([]);
});

test('the login screen fits a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Вход в аккаунт' })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

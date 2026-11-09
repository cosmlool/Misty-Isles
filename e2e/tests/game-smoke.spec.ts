import { expect, test } from '@playwright/test';

test('a guest can create a character, enter the world, and keep the save after reconnecting', async ({ page }, testInfo) => {
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

  // Use the real UI action. The server assigns the deterministic guest name.
  await page.locator('[data-race="Кот"]').click();

  await expect(page.locator('.sidebar-identity strong')).toHaveText('Путник-Кот', { timeout: 15_000 });
  await expect(page.locator('.sidebar-identity')).toContainText('Кот');
  await expect(page.locator('.sidebar-identity')).toContainText('Уровень 1');
  await expect(page.locator('.top-location')).toContainText('Сумеречный приют');
  await expect(page.locator('.resources')).toContainText('250');

  await page.screenshot({
    path: testInfo.outputPath('new-character-in-world.png'),
    fullPage: true
  });

  // Verify that the starter inventory is present, not just that the UI changed.
  await page.locator('[data-tab="inventory"]').first().click();
  await expect(page.getByRole('heading', { name: 'Инвентарь' })).toBeVisible();
  await expect(page.getByText(/предметов всего:\s*2/i)).toBeVisible();

  // Reload closes the old room connection; the isolated server saves on leave.
  // Re-authentication must restore the same synthetic character and inventory.
  await page.reload();
  await expect(page.locator('.sidebar-identity strong')).toHaveText('Путник-Кот', { timeout: 20_000 });
  await expect(page.locator('.sidebar-identity')).toContainText('Кот');
  await expect(page.locator('.top-location')).toContainText('Сумеречный приют');

  await page.locator('[data-tab="inventory"]').first().click();
  await expect(page.getByRole('heading', { name: 'Инвентарь' })).toBeVisible();
  await expect(page.getByText(/предметов всего:\s*2/i)).toBeVisible();

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

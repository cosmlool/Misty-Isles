import { expect, test } from '@playwright/test';

test('a guest can create a character, hunt, and keep progress after reconnecting', async ({ page }, testInfo) => {
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

  // Start an expedition through the visible game UI. The isolated test server
  // shortens only its disposable copy of the search timer to one second.
  await page.locator('.quick-nav [data-tab="farm"]').click();
  await expect(page.getByRole('heading', { name: 'Экспедиции и охота' })).toBeVisible();

  const goldBeforeText = await page.locator('.resources').innerText();
  const goldBefore = Number((goldBeforeText.match(/🪙\s*([\d\s\u00a0]+)/)?.[1] || '').replace(/\D/g, ''));
  expect(Number.isFinite(goldBefore)).toBeTruthy();

  await page.locator('[data-action="expeditionSearchStart"]').click();
  await expect(page.locator('.expedition-timer')).toBeVisible();

  // Let the short test-only search finish, then reconnect to prove its state
  // was persisted before claiming the encounter.
  await page.waitForTimeout(1_300);
  await page.reload();
  await expect(page.locator('.sidebar-identity strong')).toHaveText('Путник-Кот', { timeout: 20_000 });
  await page.locator('.quick-nav [data-tab="farm"]').click();
  const claimButton = page.getByRole('button', { name: 'Завершить поиск и вступить в бой', exact: true });
  await expect(claimButton).toBeVisible({ timeout: 10_000 });
  await claimButton.click();

  await expect(page.locator('.combat-journal-head')).toContainText('Победа', { timeout: 15_000 });
  await page.screenshot({
    path: testInfo.outputPath('hunt-victory.png'),
    fullPage: true
  });

  const goldAfterText = await page.locator('.resources').innerText();
  const goldAfter = Number((goldAfterText.match(/🪙\s*([\d\s\u00a0]+)/)?.[1] || '').replace(/\D/g, ''));
  expect(goldAfter).toBeGreaterThan(goldBefore);

  // Record the post-hunt inventory because monster drops are intentionally random.
  await page.locator('.quick-nav [data-tab="inventory"]').click();
  const prePurchaseSummary = page.getByText(/предметов всего:/i);
  const prePurchaseMatch = (await prePurchaseSummary.innerText()).match(/(\d+)/);
  expect(prePurchaseMatch).not.toBeNull();
  const inventoryCountBeforePurchase = Number(prePurchaseMatch![1]);

  // Exercise the real shop transaction: currency is charged exactly once,
  // the purchased item enters inventory, and equipping it updates the character.
  await page.locator('.quick-nav [data-tab="shop"]').click();
  await expect(page.getByRole('heading', { name: 'Магазины и расовые товары' })).toBeVisible();
  await page.locator('[data-action="buyItem"][data-id="WPN-C-001"]').click();
  await expect.poll(async () => {
    const text = await page.locator('.resources').innerText();
    return Number((text.match(/🪙\s*([\d\s\u00a0]+)/)?.[1] || '').replace(/\D/g, ''));
  }).toBe(goldAfter - 100);
  const goldAfterPurchaseText = await page.locator('.resources').innerText();
  const goldAfterPurchase = Number((goldAfterPurchaseText.match(/🪙\s*([\d\s\u00a0]+)/)?.[1] || '').replace(/\D/g, ''));

  await page.locator('.quick-nav [data-tab="inventory"]').click();
  await expect(page.getByRole('heading', { name: 'Инвентарь' })).toBeVisible();
  const inventorySummary = page.getByText(/предметов всего:/i);
  const inventoryMatch = (await inventorySummary.innerText()).match(/(\d+)/);
  expect(inventoryMatch).not.toBeNull();
  const inventoryCount = Number(inventoryMatch![1]);
  expect(inventoryCount).toBe(inventoryCountBeforePurchase + 1);
  await page.locator('[data-action="equipItem"][data-id="WPN-C-001"]').click();
  await page.locator('.sidebar [data-tab="character"]').click();
  await expect(page.locator('.gear-slot-button[title="Оружие: Клинок первого прилива"]')).toBeVisible();

  // The earned currency and post-hunt inventory must survive another reconnect.
  await page.reload();
  await expect(page.locator('.sidebar-identity strong')).toHaveText('Путник-Кот', { timeout: 20_000 });
  const restoredGoldText = await page.locator('.resources').innerText();
  const restoredGold = Number((restoredGoldText.match(/🪙\s*([\d\s\u00a0]+)/)?.[1] || '').replace(/\D/g, ''));
  expect(restoredGold).toBe(goldAfterPurchase);

  await page.locator('[data-tab="inventory"]').first().click();
  await expect(page.getByRole('heading', { name: 'Инвентарь' })).toBeVisible();
  const restoredInventoryMatch = (await page.getByText(/предметов всего:/i).innerText()).match(/(\d+)/);
  expect(restoredInventoryMatch).not.toBeNull();
  expect(Number(restoredInventoryMatch![1])).toBe(inventoryCount);
  await page.locator('.sidebar [data-tab="character"]').click();
  await expect(page.locator('.gear-slot-button[title="Оружие: Клинок первого прилива"]')).toBeVisible();

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

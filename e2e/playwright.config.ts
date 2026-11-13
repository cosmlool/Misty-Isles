import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(e2eDir, '..');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1365, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'node scripts/start-server.mjs',
      cwd: e2eDir,
      port: 2567,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { MISTY_PORT: '2567' }
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      cwd: resolve(projectRoot, 'client'),
      url: 'http://127.0.0.1:5173',
      timeout: 120_000,
      reuseExistingServer: false
    }
  ]
});

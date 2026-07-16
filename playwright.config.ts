import { defineConfig, devices } from '@playwright/test';

const nodePath = 'C:\\Program Files\\nodejs';
const inheritedPath = process.env.Path ?? process.env.PATH ?? '';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev:client -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      Path: `${nodePath};${inheritedPath}`,
      PATH: `${nodePath};${inheritedPath}`,
    },
  },
});

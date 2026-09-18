import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const previewURL = `http://127.0.0.1:${Number(process.env.PORT || 4173)}`;
export default defineConfig({
  testDir: './tests', testMatch: '*.ui.spec.js', fullyParallel: false, workers: 1,
  forbidOnly: Boolean(process.env.CI), retries: 0,
  timeout: 30000, use: { baseURL: previewURL, viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true,
    launchOptions: existsSync(edge) ? { executablePath: edge } : {}, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['list']], webServer: { command: 'node tools/serve.mjs', url: previewURL, reuseExistingServer: !process.env.CI }
});

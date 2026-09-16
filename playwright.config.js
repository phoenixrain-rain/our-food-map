import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export default defineConfig({
  testDir: './tests', testMatch: '*.ui.spec.js', fullyParallel: false, workers: 1,
  timeout: 30000, use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true,
    launchOptions: existsSync(edge) ? { executablePath: edge } : {}, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['list']], webServer: { command: 'node tools/serve.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: true }
});

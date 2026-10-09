import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const photo = { name: 'startup.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64') };

async function snapshot(page) {
  return page.evaluate(async () => {
    async function values(name, store) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    }
    const records = await values('our-food-map', 'snapshots'), drafts = await values('our-food-map-drafts', 'drafts');
    return { records, drafts: await Promise.all(drafts.map(async draft => ({ ...draft, payload: { ...draft.payload, added: await Promise.all(draft.payload.added.map(async item => ({ ...item, file: { type: item.file.type, bytes: Array.from(new Uint8Array(await item.file.arrayBuffer())) } }))) } }))), authMarker: localStorage.getItem('sb-startup-test-auth-token') };
  });
}

test('failed module and stylesheet still show an independently styled recovery entry on a small screen', async ({ page }) => {
  await page.clock.install(); await page.route('**/app.js*', route => route.abort()); await page.route('**/styles.css*', route => route.abort());
  await page.goto('/'); await expect(page.locator('#startupRecovery')).toBeHidden();
  await page.clock.fastForward(15001); await expect(page.locator('#startupRecovery')).toBeVisible();
  await expect(page.locator('#startupRecovery')).toContainText('不清除登录、本机记录或已暂存草稿');
  await expect(page.locator('#retryStartup')).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 600 });
  expect(await page.locator('#startupRecovery').evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && el.scrollWidth <= el.clientWidth; })).toBe(true);
});

test('explicit startup recovery preserves the exact stored record, photo draft and unrelated auth storage', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案');
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('重新打开仍在的记录'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('重新打开仍在的照片草稿'); await page.locator('#photoInput').setInputFiles(photo); await expect(page.locator('#photoStatus')).toContainText('已就绪'); await page.locator('#stashDraft').click(); await expect(page.locator('#draftBanner')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('sb-startup-test-auth-token', 'synthetic-preservation-marker'));
  const before = await snapshot(page);
  await page.clock.install(); await page.route('**/app.js*', route => route.abort()); await page.reload(); await page.clock.fastForward(15001);
  await expect(page.locator('#startupRecovery')).toBeVisible(); expect(await snapshot(page)).toEqual(before);
  await page.unroute('**/app.js*'); await page.locator('#retryStartup').click();
  await expect(page.locator('#helloLine')).toContainText('本机档案'); await expect(page.locator('#startupRecovery')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before); await expect(page.locator('#homeCards')).toContainText('重新打开仍在的记录');
  await expect(page.locator('#draftName')).toHaveText('重新打开仍在的照片草稿');
  await page.locator('#resumeDraft').click(); await expect.poll(() => page.locator('#photoPreviews img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
});

test('a failed SDK never starts a half-functional app and offers the independent recovery entry', async ({ page }) => {
  await page.clock.install(); await page.route('**/vendor/supabase.js*', route => route.abort());
  await page.goto('/'); await page.clock.fastForward(15001); await expect(page.locator('#startupRecovery')).toBeVisible();
  await page.locator('#mainAdd').click({ force: true }); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.unroute('**/vendor/supabase.js*'); await page.locator('#retryStartup').click();
  await expect(page.locator('#helloLine')).toContainText('本机档案'); await expect(page.locator('#startupRecovery')).toHaveCount(0);
});

test('a deferred slow SDK does not block recovery rendering and finishes before the real app initializes', async ({ page }) => {
  let releaseSDK; const sdkGate = new Promise(resolve => { releaseSDK = resolve; });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install(); await page.route('**/vendor/supabase.js*', async route => { await sdkGate; await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' }); await expect(page.locator('#startupRecovery')).toHaveCount(1);
  await page.clock.fastForward(15001); await expect(page.locator('#startupRecovery')).toBeVisible();
  await expect(page.locator('#runningVersion')).toBeEmpty();
  releaseSDK(); await expect(page.locator('#helloLine')).toContainText('本机档案'); await expect(page.locator('#startupRecovery')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a started app never shows the startup entry or reloads an unsaved editor on worker changes', async ({ page }) => {
  await page.clock.install(); await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案'); await expect(page.locator('#startupRecovery')).toHaveCount(0);
  let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('不允许恢复入口刷新我的输入');
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))); await page.clock.fastForward(70000);
  await expect(page.locator('#restaurantName')).toHaveValue('不允许恢复入口刷新我的输入'); await expect(page.locator('#startupRecovery')).toHaveCount(0); expect(navigations).toBe(0);
});

async function blockedSecureStartup(page) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  await page.addInitScript(() => {
    window.startupRegistrationCalls = 0;
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => { window.startupRegistrationCalls++; return new Promise(() => {}); } } });
  });
  await page.route('https://startup-recovery.invalid/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });
  await page.clock.install(); await page.goto('https://startup-recovery.invalid/'); await page.clock.fastForward(15001); await expect(page.locator('#startupRecovery')).toBeVisible();
  expect(await page.evaluate(() => window.startupRegistrationCalls)).toBe(1);
}

test('startup retry has a finite wait even if worker registration hangs and does not loop reloads', async ({ page }) => {
  await blockedSecureStartup(page); let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.locator('#retryStartup').click(); await expect(page.locator('#retryStartup')).toBeDisabled();
  await page.clock.fastForward(6001); await expect.poll(() => navigations).toBe(1);
  await page.clock.fastForward(70000); await expect(page.locator('#startupRecovery')).toBeVisible(); expect(navigations).toBe(1);
});

test('late app-ready signal during startup resource checking cancels the pending reload permanently', async ({ page }) => {
  await blockedSecureStartup(page); let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.locator('#retryStartup').click();
  await page.evaluate(() => window.dispatchEvent(new Event('food-map-ready'))); await expect(page.locator('#startupRecovery')).toHaveCount(0);
  await page.clock.fastForward(70000); expect(navigations).toBe(0);
});

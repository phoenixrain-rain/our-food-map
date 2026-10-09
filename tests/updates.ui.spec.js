import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
const parts = pkg.version.split('.').map(Number), future = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
const photo = { name: 'upgrade.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64') };

async function updateServer() {
  const root = path.resolve(import.meta.dirname, '..'); let newer = false, failures = {}, stalled = false;
  const requests = { criticalFailures: 0, iconFailures: 0, staleHTML: 0 };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), pathname = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
      if (stalled && pathname === '/index.html') {
        if (stalled === 'body') { res.writeHead(200,{'Content-Type':'text/html'}); res.write('<!doctype html>'); }
        return;
      }
      const file = path.resolve(root, '.' + decodeURIComponent(pathname));
      if (!file.startsWith(root + path.sep) || /[\\/](node_modules|\.git|\.private-audit)([\\/]|$)/.test(file)) { res.writeHead(403); res.end(); return; }
      if (failures.critical && pathname === '/lib/updates.js' && url.searchParams.get('v') === future) { requests.criticalFailures++; res.writeHead(503); res.end(); return; }
      if (failures.icon && pathname === '/icons/app-icon-192.png') { requests.iconFailures++; res.writeHead(503); res.end(); return; }
      let body = await readFile(file); const extension = path.extname(file);
      // Versioned resources keep their matching imports even after the server advances.
      // This works in shallow CI checkouts and never edits the repository or requires Git history.
      const nextResource = url.searchParams.get('v') === future || (newer && (pathname === '/service-worker.js' || extension === '.html'));
      if (newer && failures.staleHTML && extension === '.html') requests.staleHTML++;
      else if (nextResource && ['.html', '.js', '.css'].includes(extension)) body = body.toString().replaceAll(pkg.version, future).replace(/our-food-map-shell-v\d+/g, 'our-food-map-shell-upgrade-test');
      res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, stall: (phase = 'headers') => { stalled = phase; }, next: (broken = {}) => { newer = true; failures = broken; }, close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
async function register(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }); await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator('#cachedVersion')).toHaveText(pkg.version);
}

async function draftSnapshot(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('our-food-map-drafts'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const drafts = await new Promise((resolve, reject) => { const request = database.transaction('drafts', 'readonly').objectStore('drafts').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return Promise.all(drafts.map(async draft => ({
        revision: draft.revision, savedAt: draft.savedAt, fields: draft.payload.fields,
        photos: await Promise.all(draft.payload.added.map(async photo => ({ type: photo.file.type, size: photo.file.size, digest: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.file.arrayBuffer()))).map(byte => byte.toString(16).padStart(2, '0')).join('') })))
      })));
    } finally { database.close(); }
  });
}

for (const phase of ['headers','body']) test(`installed shell opens promptly while navigation stalls at ${phase}, preserving local records`, async ({ page, context }) => {
  const server = await updateServer();
  try {
    await page.goto(server.url); await expect(page.locator('#helloLine')).toContainText('本机档案'); await register(page);
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('弱网前保存的记录'); await page.locator('#saveRecordBtn').click();
    await expect(page.locator('#editSheet')).not.toHaveClass(/open/); server.stall(phase);
    // A complete installed shell should not wait for the old 8-second navigation timeout.
    const openedAt = Date.now(); await page.reload({waitUntil:'domcontentloaded',timeout:4000});
    await expect(page.locator('#homeCards')).toContainText('弱网前保存的记录');
    expect(Date.now() - openedAt).toBeLessThan(4000);
    await expect(page.locator('#runningVersion')).toHaveText(pkg.version);
  } finally { await context.close(); await server.close(); }
});

test('an installed newer version never reloads an editor and explicit upgrade preserves records and photo drafts offline', async ({ page, context }) => {
  test.setTimeout(60000); const server = await updateServer(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(server.url); await expect(page.locator('#helloLine')).toContainText('本机档案'); await register(page);
    await page.evaluate(() => caches.open('other-application-update-check'));
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('更新前的记录'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('更新前的照片草稿'); await page.locator('#reviewText').fill('重开后还要保留'); await page.locator('#photoInput').setInputFiles(photo); await expect(page.locator('#photoStatus')).toContainText('已就绪'); await page.locator('#stashDraft').click(); await expect(page.locator('#draftBanner')).toBeVisible();
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('当前没保存的输入'); server.next();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect(page.locator('#updateBannerText')).toContainText(future, { timeout: 25000 }); await expect(page.locator('#restaurantName')).toHaveValue('当前没保存的输入');
    await page.evaluate(() => document.querySelector('#applyUpdateBanner').click()); await expect(page.locator('#toast')).toContainText('先正式保存或暂存'); await expect(page.locator('#restaurantName')).toHaveValue('当前没保存的输入');
    page.once('dialog', dialog => dialog.accept()); await page.locator('[data-close="editSheet"]').click();
    await page.locator('#applyUpdateBanner').click(); await expect(page).toHaveURL(new RegExp(`v=${future.replaceAll('.', '\\.')}`));
    await expect(page.locator('#runningVersion')).toHaveText(future); await expect(page.locator('#updateBanner')).toBeHidden(); await expect(page.locator('#homeCards')).toContainText('更新前的记录'); await expect(page.locator('#draftName')).toHaveText('更新前的照片草稿');
    await context.setOffline(true); await page.reload(); await expect(page.locator('#runningVersion')).toHaveText(future); await page.locator('#resumeDraft').click(); await expect(page.locator('#reviewText')).toHaveValue('重开后还要保留'); await expect.poll(() => page.locator('#photoPreviews img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => caches.keys())).toContain('other-application-update-check'); expect(errors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});

for (const failure of ['critical', 'staleHTML']) test(`failed update (${failure}) keeps a coherent shell and photo draft across online/offline reopens, then upgrades safely`, async ({ page, context }) => {
  test.setTimeout(60000); const server = await updateServer();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(server.url); await expect(page.locator('#helloLine')).toContainText('本机档案'); await register(page);
    const originalCache = await page.evaluate(async () => (await caches.keys()).find(key => key.startsWith('our-food-map-shell-')));
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('失败升级前的记录'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('失败升级前的照片草稿'); await page.locator('#reviewText').fill('文字和照片都不能丢'); await page.locator('#photoInput').setInputFiles(photo); await expect(page.locator('#photoStatus')).toContainText('已就绪'); await page.locator('#stashDraft').click(); await expect(page.locator('#draftBanner')).toBeVisible();
    const originalDraft = await draftSnapshot(page); expect(originalDraft).toHaveLength(1); expect(originalDraft[0].photos).toHaveLength(1); expect(originalDraft[0].photos[0].type).toBe('image/jpeg'); expect(originalDraft[0].photos[0].size).toBeGreaterThan(0);
    await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="updates"]').click(); server.next({ [failure]: true });
    await page.locator('#checkUpdate').click(); await expect(page.locator('#updateStatus')).toContainText('未完成', { timeout: 25000 }); await expect(page.locator('#applyUpdate')).toBeDisabled(); await expect(page.locator('#runningVersion')).toHaveText(pkg.version);
    expect(failure === 'critical' ? server.requests.criticalFailures : server.requests.staleHTML).toBeGreaterThan(0);
    for (const offline of [false, true]) {
      await context.setOffline(offline); await page.reload();
      await expect(page.locator('#runningVersion')).toHaveText(pkg.version); await expect(page.locator('#cachedVersion')).toHaveText(pkg.version);
      await expect(page.locator('#homeCards')).toContainText('失败升级前的记录'); await expect(page.locator('#draftName')).toHaveText('失败升级前的照片草稿');
      expect(await draftSnapshot(page)).toEqual(originalDraft);
      const cachedHTML = await page.evaluate(async name => (await (await caches.open(name)).match('/index.html')).text(), originalCache);
      expect(cachedHTML).toContain(`app.js?v=${pkg.version}`); expect(cachedHTML).not.toContain(`app.js?v=${future}`);
    }
    await context.setOffline(false); server.next(); await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="updates"]').click();
    await page.locator('#checkUpdate').click(); await expect(page.locator('#updateStatus')).toContainText('已下载完成', { timeout: 25000 }); await expect(page.locator('#applyUpdate')).toBeEnabled();
    for (const width of [320, 393, 1280]) { await page.setViewportSize({ width, height: 760 }); expect(await page.locator('#updatesSheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
    await context.setOffline(true); await expect(page.locator('#checkUpdate')).toBeDisabled(); await expect(page.locator('#applyUpdate')).toBeEnabled();
    await page.locator('#applyUpdate').click(); await expect(page.locator('#runningVersion')).toHaveText(future); await expect(page.locator('#connectionBanner')).toContainText('当前离线');
    await expect(page.locator('#homeCards')).toContainText('失败升级前的记录'); expect(await draftSnapshot(page)).toEqual(originalDraft);
    await page.locator('#resumeDraft').click(); await expect(page.locator('#reviewText')).toHaveValue('文字和照片都不能丢'); await expect.poll(() => page.locator('#photoPreviews img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0); expect(errors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});

test('an optional icon failure does not block a complete newer shell or its offline startup', async ({ page, context }) => {
  test.setTimeout(60000); const server = await updateServer(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(server.url); await expect(page.locator('#helloLine')).toContainText('本机档案'); await register(page);
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('图标故障仍能打开'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
    server.next({ icon: true }); await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="updates"]').click();
    await page.locator('#checkUpdate').click(); await expect(page.locator('#updateStatus')).toContainText('已下载完成', { timeout: 25000 }); expect(server.requests.iconFailures).toBeGreaterThan(0);
    await context.setOffline(true); await page.locator('#applyUpdate').click(); await expect(page.locator('#runningVersion')).toHaveText(future); await expect(page.locator('#cachedVersion')).toHaveText(future);
    await expect(page.locator('#homeCards')).toContainText('图标故障仍能打开'); await page.reload(); await expect(page.locator('#runningVersion')).toHaveText(future); await expect(page.locator('#homeCards')).toContainText('图标故障仍能打开'); expect(errors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});

test('version panel explains missing local registration and offline checks without clearing data', async ({ page, context }) => {
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案'); await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="updates"]').click();
  await expect(page.getByRole('dialog', { name: '版本与更新' })).toBeVisible(); await expect(page.locator('#runningVersion')).toHaveText(pkg.version);
  await page.locator('#checkUpdate').click(); await expect(page.locator('#updateStatus')).toContainText('尚未启用'); await expect(page.locator('#applyUpdate')).toBeDisabled();
  await context.setOffline(true); await expect(page.locator('#checkUpdate')).toBeDisabled(); await expect(page.locator('#updatesSheet')).toContainText('不要清除网站数据');
});

test('installed desktop shell still opens offline after eight days without expiring saved records', async ({ page, context }) => {
  const server = await updateServer();
  try {
    await page.clock.install(); await page.goto(server.url); await register(page);
    await expect(page.locator('#helloLine')).toContainText('本机档案');
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('八天后仍能打开的记录'); await page.locator('#saveRecordBtn').click();
    await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
    await page.clock.setFixedTime(new Date(Date.now() + 8 * 86400000));
    await context.setOffline(true); await page.goto(server.url + '/?source=pwa');
    await expect(page.locator('#runningVersion')).toHaveText(pkg.version); await expect(page.locator('#homeCards')).toContainText('八天后仍能打开的记录');
  } finally { await context.close(); await server.close(); }
});

test('evicted shell is rebuilt without a new release or clearing local records', async ({ page, context }) => {
  const server = await updateServer();
  try {
    await page.goto(server.url); await register(page); await expect(page.locator('#helloLine')).toContainText('本机档案');
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('只修资源不清档案'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
    // Simulate cache eviction only inside this isolated browser. IndexedDB stays intact.
    await page.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith('our-food-map-shell-')) await caches.delete(name); });
    await page.reload(); await expect(page.locator('#helloLine')).toContainText('本机档案');
    await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="updates"]').click(); await page.locator('#checkUpdate').click();
    await expect(page.locator('#updateStatus')).toContainText('离线资源已完整');
    await context.setOffline(true); await page.reload(); await expect(page.locator('#homeCards')).toContainText('只修资源不清档案'); await expect(page.locator('#runningVersion')).toHaveText(pkg.version);
  } finally { await context.close(); await server.close(); }
});

for (const result of ['granted', 'denied', 'error']) test(`storage protection is opt-in and reports ${result} honestly`, async ({ page }) => {
  await page.addInitScript(result => {
    window.persistCalls = 0;
    Object.defineProperty(navigator, 'storage', { value: { persisted: async () => false, persist: async () => { window.persistCalls++; if (result === 'error') throw new Error('Synthetic denial'); return result === 'granted'; } } });
    localStorage.setItem('storage-marker', 'keep');
  }, result);
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案');
  await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="updates"]').click();
  expect(await page.evaluate(() => persistCalls)).toBe(0);
  await page.locator('#protectStorage').click();
  await expect(page.locator('#storageProtection')).toContainText(result === 'granted' ? '已允许' : result === 'denied' ? '暂未允许' : '暂时无法确认');
  expect(await page.evaluate(() => [persistCalls, localStorage.getItem('storage-marker')])).toEqual([1, 'keep']);
});

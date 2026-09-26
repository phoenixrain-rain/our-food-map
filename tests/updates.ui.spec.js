import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
const parts = pkg.version.split('.').map(Number), future = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
const photo = { name: 'upgrade.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64') };

async function updateServer() {
  const root = path.resolve(import.meta.dirname, '..'); let newer = false, failAsset = false, stalled = false;
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
      if (failAsset && pathname === '/lib/updates.js' && url.searchParams.get('v') === future) { res.writeHead(503); res.end(); return; }
      let body = await readFile(file); const extension = path.extname(file);
      // Serve two coherent releases from memory; never modify the repository while tests run.
      if (newer && ['.html', '.js', '.css'].includes(extension)) body = body.toString().replaceAll(pkg.version, future).replace(/our-food-map-shell-v\d+/g, 'our-food-map-shell-upgrade-test');
      res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, stall: (phase = 'headers') => { stalled = phase; }, next: (broken = false) => { newer = true; failAsset = broken; }, close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
async function register(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }); await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator('#cachedVersion')).toHaveText(pkg.version);
}

for (const phase of ['headers','body']) test(`navigation stalled at ${phase} falls back without clearing local records`, async ({ page, context }) => {
  const server = await updateServer();
  try {
    await page.goto(server.url); await expect(page.locator('#helloLine')).toContainText('本机档案'); await register(page);
    await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('弱网前保存的记录'); await page.locator('#saveRecordBtn').click();
    await expect(page.locator('#editSheet')).not.toHaveClass(/open/); server.stall(phase);
    await page.reload({waitUntil:'domcontentloaded',timeout:18000});
    await expect(page.locator('#homeCards')).toContainText('弱网前保存的记录');
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

test('failed update download does not claim success and a later explicit retry can install it', async ({ page, context }) => {
  test.setTimeout(60000); const server = await updateServer();
  try {
    await page.goto(server.url); await expect(page.locator('#helloLine')).toContainText('本机档案'); await register(page);
    await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="updates"]').click(); server.next(true);
    await page.locator('#checkUpdate').click(); await expect(page.locator('#updateStatus')).toContainText('未完成', { timeout: 25000 }); await expect(page.locator('#applyUpdate')).toBeDisabled(); await expect(page.locator('#runningVersion')).toHaveText(pkg.version);
    server.next(false); await page.locator('#checkUpdate').click(); await expect(page.locator('#updateStatus')).toContainText('已下载完成', { timeout: 25000 }); await expect(page.locator('#applyUpdate')).toBeEnabled();
    for (const width of [320, 393, 1280]) { await page.setViewportSize({ width, height: 760 }); expect(await page.locator('#updatesSheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
    await context.setOffline(true); await expect(page.locator('#checkUpdate')).toBeDisabled(); await expect(page.locator('#applyUpdate')).toBeEnabled();
    await page.locator('#applyUpdate').click(); await expect(page.locator('#runningVersion')).toHaveText(future); await expect(page.locator('#connectionBanner')).toContainText('当前离线');
  } finally { await context.close(); await server.close(); }
});

test('version panel explains missing local registration and offline checks without clearing data', async ({ page, context }) => {
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案'); await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="updates"]').click();
  await expect(page.getByRole('dialog', { name: '版本与更新' })).toBeVisible(); await expect(page.locator('#runningVersion')).toHaveText(pkg.version);
  await page.locator('#checkUpdate').click(); await expect(page.locator('#updateStatus')).toContainText('尚未启用'); await expect(page.locator('#applyUpdate')).toBeDisabled();
  await context.setOffline(true); await expect(page.locator('#checkUpdate')).toBeDisabled(); await expect(page.locator('#updatesSheet')).toContainText('不要清除网站数据');
});

import { test, expect } from '@playwright/test';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64');
const photo = { name: 'avatar.png', mimeType: 'image/png', buffer: pixel };
async function ready(page) { await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案'); }
async function open(page) { await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="identity"].setting-row').click(); }
test('avatar crop, local save, failed replacement retry, reload, discard and reset', async ({ page }) => {
  await ready(page); await open(page); await page.locator('#avatarInput').setInputFiles(photo); await expect(page.locator('#avatarMessage')).toContainText('预览已就绪');
  await page.locator('#avatarZoom').fill('2'); await expect(page.locator('#avatarZoomValue')).toHaveText('2.0×');
  await page.locator('#nicknameInput').fill('小太阳'); await page.locator('#saveNickname').click(); await expect(page.locator('#identitySheet')).not.toHaveClass(/open/);
  await expect(page.locator('#profileFace img')).toBeVisible(); await expect.poll(() => page.locator('#profileFace img').evaluate(img => img.naturalWidth)).toBe(512);
  await page.reload(); await open(page); await expect(page.locator('#avatarPreview img')).toBeVisible(); await page.locator('#avatarInput').setInputFiles({ name: 'bad.heic', mimeType: 'image/heic', buffer: Buffer.from('invalid') }); await expect(page.locator('#avatarMessage')).toContainText('无法读取'); await expect(page.locator('#avatarPreview img')).toBeVisible();
  await page.locator('#avatarInput').setInputFiles(photo); await expect(page.locator('#avatarMessage')).toContainText('预览已就绪');
  await page.evaluate(() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new Error('Storage full'); }; });
  await page.locator('#saveNickname').click(); await expect(page.locator('#avatarMessage')).toContainText('本次修改仍保留'); await expect(page.locator('#avatarCrop')).toBeVisible();
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; }); await page.locator('#saveNickname').click(); await expect(page.locator('#identitySheet')).not.toHaveClass(/open/);
  await open(page); await page.locator('#removeAvatar').click(); page.once('dialog', dialog => dialog.accept()); await page.locator('[data-close="identitySheet"]').click(); await expect(page.locator('#profileFace img')).toHaveCount(1);
  await open(page); await page.locator('#removeAvatar').click(); await page.locator('#saveNickname').click(); await expect(page.locator('#identitySheet')).not.toHaveClass(/open/); await expect(page.locator('#profileFace img')).toHaveCount(0); await page.reload(); await expect(page.locator('#faceMe img')).toHaveCount(0);
});
test('crop controls select actual pixels, avatar processing cannot be saved early', async ({ page }) => {
  await ready(page); await open(page);
  const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 600, 600); ctx.fillStyle = '#0000ff'; ctx.fillRect(600, 0, 600, 600); return canvas.toDataURL(); });
  await page.evaluate(() => { const decode = window.createImageBitmap.bind(window); window.createImageBitmap = async (...args) => { await new Promise(resolve => setTimeout(resolve, 1000)); return decode(...args); }; });
  await page.locator('#avatarInput').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
  await expect(page.locator('#saveNickname')).toBeDisabled(); await expect(page.locator('#saveNickname')).toBeEnabled();
  await page.locator('#avatarX').fill('0'); const left = await page.locator('#avatarCrop').evaluate(c => [...c.getContext('2d').getImageData(256, 256, 1, 1).data]); expect(left[0]).toBeGreaterThan(240); expect(left[2]).toBeLessThan(15);
  await page.locator('#avatarX').fill('1'); const right = await page.locator('#avatarCrop').evaluate(c => [...c.getContext('2d').getImageData(256, 256, 1, 1).data]); expect(right[2]).toBeGreaterThan(240); expect(right[0]).toBeLessThan(15);
});
test('search focus keeps readable type and zoom; sync and real edits preserve decoded photos', async ({ page }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('稳定照片'); await page.locator('#photoInput').setInputFiles(photo); await expect(page.locator('#photoStatus')).toContainText('已就绪'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await expect.poll(() => page.locator('#homeCards img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.evaluate(() => { window.savedImage = document.querySelector('#homeCards img'); window.loadCount = 0; window.savedImage.addEventListener('load', () => window.loadCount++); });
  for (let i = 0; i < 3; i++) { await page.locator('#refreshBtn').click(); await expect(page.locator('#refreshBtn')).toBeEnabled(); }
  expect(await page.evaluate(() => window.savedImage === document.querySelector('#homeCards img'))).toBe(true); expect(await page.evaluate(() => window.loadCount)).toBe(0);
  await page.locator('#homeCards .food-content').click(); await page.locator('[data-edit]').click(); await page.locator('#price').fill('88'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => window.savedImage === document.querySelector('#homeCards img'))).toBe(true); expect(await page.evaluate(() => window.loadCount)).toBe(0);
  await page.locator('[data-nav="records"]').click();
  const scale = await page.evaluate(() => visualViewport.scale); await page.locator('#searchInput').focus(); await page.locator('#searchInput').fill('稳定');
  expect(await page.locator('#searchInput').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16); expect(await page.evaluate(() => visualViewport.scale)).toBe(scale);
  await expect(page.locator('#recordList .food-card')).toHaveCount(1); expect(await page.locator('meta[name=viewport]').getAttribute('content')).not.toMatch(/user-scalable=no|maximum-scale/);
});
test('avatar broken image shows initials; mobile crop and all controls stay in view', async ({ page }) => {
  await ready(page); await open(page); await page.locator('#avatarInput').setInputFiles(photo); await expect(page.locator('#avatarMessage')).toContainText('预览已就绪'); await page.locator('#saveNickname').click(); await expect(page.locator('#identitySheet')).not.toHaveClass(/open/);
  await page.locator('#profileFace img').evaluate(img => img.dispatchEvent(new Event('error'))); await expect(page.locator('#profileFace .avatar-fallback')).toBeVisible(); await expect(page.locator('#profileFace img')).toBeHidden();
  for (const width of [320, 393, 560]) {
    await page.setViewportSize({ width, height: 640 }); await open(page); await page.locator('#avatarInput').setInputFiles(photo); await expect(page.locator('#avatarMessage')).toContainText('预览已就绪');
    expect(await page.locator('#identitySheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); await page.locator('#saveNickname').click(); await expect(page.locator('#identitySheet')).not.toHaveClass(/open/);
  }
});
test('two local profile editors cannot overwrite a newer avatar, and exports embed the image', async ({ page, context }) => {
  await ready(page); const second = await context.newPage(); await ready(second); await open(page); await open(second);
  await page.locator('#avatarInput').setInputFiles(photo); await expect(page.locator('#avatarMessage')).toContainText('预览已就绪'); await page.locator('#nicknameInput').fill('新的昵称'); await page.locator('#saveNickname').click(); await expect(page.locator('#identitySheet')).not.toHaveClass(/open/);
  await second.locator('#nicknameInput').fill('过期页面'); await second.locator('#saveNickname').click(); await expect(second.locator('#avatarMessage')).toContainText('另一页面修改'); await second.close();
  await page.locator('[data-open="backup"]').click(); const downloadEvent = page.waitForEvent('download'); await page.locator('#exportBtn').click(); const download = await downloadEvent; const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk); const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.data.avatar_url).toMatch(/^data:image\/jpeg;base64,/); expect(exported.data.nickname).toBe('新的昵称');
  await page.locator('[data-close="backupSheet"]').click(); await page.reload(); await expect(page.locator('#faceMe img')).toHaveCount(1);
});

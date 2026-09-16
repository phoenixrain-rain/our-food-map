import { test, expect } from '@playwright/test';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64');
async function ready(page) { await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案'); }
async function rate(page, name, value) { await page.locator(`[data-rate="${name}"]`).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value); }
test('mobile photo save, edit, lightbox, remove, persistence, zero price and no default rating', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await ready(page);
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('照片测试店'); await page.locator('#price').fill('0');
  await expect(page.locator('#overallScore')).toHaveText('未评');
  await page.locator('#photoInput').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: pixel });
  await expect(page.locator('#photoStatus')).toContainText('已就绪');
  await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  const card = page.locator('#homeCards .food-card').first(); await expect(card.locator('.metric.price')).toContainText('¥0'); await expect(card.locator('.metric.taste')).toContainText('未评');
  await expect(card.locator('img')).toBeVisible(); await expect.poll(() => card.locator('img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await card.locator('[data-photo]').click(); await expect(page.locator('#photoViewer')).toBeVisible(); await expect(page.locator('#viewerImage')).toBeVisible(); await page.locator('#closePhotoViewer').click();
  await card.locator('.food-content').click(); await page.locator('[data-edit]').click(); await expect(page.locator('#photoPreviews .preview')).toHaveCount(1);
  await rate(page, 'taste', 9); await rate(page, 'value', 8); await rate(page, 'vibe', 7); await expect(page.locator('#overallScore')).toHaveText('8.3');
  await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await page.reload(); await expect(page.locator('#homeCards .food-card')).toHaveCount(1);
  await expect(page.locator('#homeCards .metric.taste')).toContainText('9.0'); await expect(page.locator('#homeCards img')).toHaveCount(1);
  await page.locator('#homeCards .food-content').click(); await page.locator('[data-edit]').click(); await page.locator('[data-remove-existing]').click(); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.reload(); await expect(page.locator('#homeCards .food-card')).toHaveCount(1); await expect(page.locator('#homeCards img')).toHaveCount(0); expect(errors).toEqual([]);
});
test('wishlist has budget, cannot affect eaten statistics, and rated records cannot switch back', async ({ page }) => {
  await ready(page); await page.locator('[data-quick="wish"]').click(); await page.locator('#restaurantName').fill('未来约会'); await page.locator('#price').fill('199.50');
  await expect(page.locator('#ratingSection')).not.toBeVisible(); await expect(page.locator('#visitDate')).toHaveValue(''); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await expect(page.locator('#wishCards .food-card')).toContainText('预算人均'); await page.locator('[data-nav="rank"]').click(); await expect(page.locator('#statsGrid .stat').first().locator('strong')).toHaveText('0');
  await page.locator('[data-nav="home"]').click(); await page.locator('#wishCards .food-content').click(); await page.locator('[data-edit]').click(); await page.locator('[data-status="eaten"]').click(); await rate(page, 'taste', 8); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.locator('#homeCards .food-content').click(); await page.locator('[data-edit]').click(); await page.locator('[data-status="wishlist"]').click(); await expect(page.locator('#ratingSection')).toBeVisible();
});
test('decoding fallback and invalid images give visible feedback without losing draft', async ({ page }) => {
  await ready(page); await page.evaluate(() => { window.createImageBitmap = undefined; });
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('还没保存的店');
  await page.locator('#photoInput').setInputFiles({ name: 'good.png', mimeType: 'image/png', buffer: pixel }); await expect(page.locator('#photoPreviews .preview')).toHaveCount(1);
  await page.locator('#photoInput').setInputFiles({ name: 'bad.heic', mimeType: 'image/heic', buffer: Buffer.from('not-an-image') }); await expect(page.locator('#photoStatus')).toContainText('无法读取');
  await expect(page.locator('#restaurantName')).toHaveValue('还没保存的店'); await expect(page.locator('#saveRecordBtn')).toBeEnabled();
});
test('older local records migrate with photos and do not mistake partner reviews for mine', async ({ page }) => {
  await page.addInitScript(({ url }) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', 'yes'); localStorage.setItem('couple_food_mobile_v2', JSON.stringify({ nickname: '我', partnerName: 'TA', restaurants: [{ id: 'old', name: '旧档案', status: 'eaten', price_per_person: 68 }], reviews: [{ id: 'review', restaurant_id: 'old', user_id: 'local-partner', taste: 9, value: 9, vibe: 9 }], photos: [{ id: 'photo', restaurant_id: 'old', user_id: 'local-me', url }] })); } }, { url: `data:image/png;base64,${pixel.toString('base64')}` });
  await ready(page); await expect(page.locator('#homeCards .food-card')).toContainText('我待评'); await page.locator('#homeCards .food-content').click(); await page.locator('[data-edit]').click(); await expect(page.locator('#overallScore')).toHaveText('未评'); await expect(page.locator('#photoPreviews .preview')).toHaveCount(1);
});
test('small Android and desktop layouts have no horizontal overflow or trapped navigation', async ({ page }) => {
  await ready(page);
  for (const size of [{ width: 320, height: 640 }, { width: 393, height: 851 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(size);
    for (const nav of ['home', 'records', 'rank', 'profile']) {
      await page.locator(`[data-nav="${nav}"]`).click();
      expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const box = await page.locator('.bottom-nav').boundingBox(); expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
    }
  }
});
test('failed local storage write leaves draft intact and succeeds on retry without duplicates', async ({ page }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('保存失败要保留草稿');
  await page.evaluate(() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function() { throw new DOMException('Storage full', 'QuotaExceededError'); }; });
  await page.locator('#saveRecordBtn').click(); await expect(page.locator('#saveMessage')).toBeVisible(); await expect(page.locator('#editSheet')).toHaveClass(/open/);
  await expect(page.locator('#restaurantName')).toHaveValue('保存失败要保留草稿'); await expect(page.locator('#homeCards .food-card')).toHaveCount(0);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await expect(page.locator('#homeCards .food-card')).toHaveCount(1);
});
test('photo processing blocks early save', async ({ page }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('照片还在处理');
  await page.evaluate(() => { const decode = window.createImageBitmap.bind(window); window.createImageBitmap = async (...args) => { await new Promise(resolve => setTimeout(resolve, 800)); return decode(...args); }; });
  const upload = { name: 'same-photo.png', mimeType: 'image/png', buffer: pixel };
  await page.locator('#photoInput').setInputFiles(upload); await expect(page.locator('#saveRecordBtn')).toBeDisabled(); await expect(page.locator('#photoPreviews .preview')).toHaveCount(1);
  await expect(page.locator('#saveRecordBtn')).toBeEnabled();
});
test('installed shell reloads offline and only removes its own old caches', async ({ page, context }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('离线本机档案'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.evaluate(async () => {
    await caches.open('other-application'); await caches.open('our-food-map-shell-v1');
    await navigator.serviceWorker.register('/service-worker.js'); await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const keys = await page.evaluate(() => caches.keys()); expect(keys).toContain('other-application'); expect(keys).not.toContain('our-food-map-shell-v1'); expect(keys).toContain('our-food-map-shell-v3');
  await context.setOffline(true); await page.reload(); await expect(page.locator('#homeCards .food-card')).toContainText('离线本机档案'); await expect(page.locator('#connectionBanner')).toContainText('当前离线');
});
test('OTP errors and resend cooldown are visible without sending a real email', async ({ page }) => {
  let sends = 0;
  await page.route('**/auth/v1/otp', route => { sends++; return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await page.route('**/auth/v1/verify', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'otp_expired', msg: 'Token has expired or is invalid' }) }));
  await ready(page); await page.locator('#syncBtn').click(); await page.locator('#loginEmail').fill('ui-check@example.invalid'); await page.locator('#sendEmailCode').click();
  await expect(page.locator('#otpLoginBox')).toBeVisible(); await expect(page.locator('#sendEmailCode')).toBeDisabled(); await expect(page.locator('#sendEmailCode')).toContainText('秒后可重发'); expect(sends).toBe(1);
  await page.locator('#loginOtp').fill('12345678'); await page.locator('#verifyEmailCode').click(); await expect(page.locator('#toast')).toContainText('验证码无效或已过期'); await expect(page.locator('#cloudSheet')).toHaveClass(/open/);
});
test('backup merge preserves existing records, escapes content, and restores images', async ({ page }) => {
  await ready(page); await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="backup"]').click();
  const data = { restaurants: [{ id: 'backup-id', name: '<img src=x onerror=alert(1)>', status: 'eaten', price_per_person: 0 }], reviews: [], photos: [{ id: 'backup-photo', restaurant_id: 'backup-id', user_id: 'local-me', url: `data:image/png;base64,${pixel.toString('base64')}` }] };
  await page.locator('#importInput').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#toast')).toContainText('已合并'); await expect(page.locator('#homeCards .food-title')).toHaveText(data.restaurants[0].name);
  data.restaurants[0].name = '不应覆盖';
  await page.locator('#importInput').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#homeCards .food-card')).toHaveCount(1); await expect(page.locator('#homeCards .food-title')).not.toHaveText('不应覆盖');
  await page.reload(); await expect(page.locator('#homeCards img')).toHaveCount(1); await expect(page.locator('#homeCards .metric.price')).toContainText('¥0');
});

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
  const keys = await page.evaluate(() => caches.keys()); expect(keys).toContain('other-application'); expect(keys).not.toContain('our-food-map-shell-v1'); expect(keys).toContain('our-food-map-shell-v12');
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

async function seedRecords(page) {
  const data = { restaurants: [
    { id: 'complete', name: '双方评价的旧上传', category: '火锅', status: 'eaten', price_per_person: 60, created_at: '2026-09-15T01:00:00Z', visit_date: '2026-09-17', updated_at: '2026-09-20T01:00:00Z' },
    { id: 'pending', name: '单人评价的新上传', category: '咖啡茶饮', status: 'eaten', price_per_person: 20, created_at: '2026-09-16T01:00:00Z', visit_date: '2026-08-01' }
  ], reviews: [
    { id: 'a', restaurant_id: 'complete', user_id: 'local-me', taste: 10, value: 8, vibe: 6 },
    { id: 'b', restaurant_id: 'complete', user_id: 'local-partner', taste: 6, value: 6, vibe: 10 },
    { id: 'c', restaurant_id: 'pending', user_id: 'local-me', taste: 10, value: 10, vibe: 10 }
  ], photos: [{ id: 'p', restaurant_id: 'complete', user_id: 'local-me', url: `data:image/png;base64,${pixel.toString('base64')}` }] };
  await page.addInitScript(data => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', 'yes'); localStorage.setItem('couple_food_mobile_v2', JSON.stringify(data)); } }, data);
  return data;
}

test('recent uploads and shared ranking stay correct after editing and every rank tab', async ({ page }) => {
  await seedRecords(page); await ready(page);
  await expect(page.locator('#homeCards .food-title')).toHaveText(['单人评价的新上传', '双方评价的旧上传']);
  await page.locator('[data-nav="records"]').click(); await expect(page.locator('#recordSort')).toHaveValue('visit'); await expect(page.locator('#recordList .food-title')).toHaveText(['双方评价的旧上传', '单人评价的新上传']);
  await page.locator('#recordSort').selectOption('recent'); await expect(page.locator('#recordList .food-title')).toHaveText(['单人评价的新上传', '双方评价的旧上传']);
  await page.locator('[data-nav="rank"]').click();
  for (const key of ['value', 'taste', 'vibe', 'price', 'overall']) {
    await page.locator(`[data-rank="${key}"]`).click(); await expect(page.locator('#rankList .food-card')).toHaveCount(1); await expect(page.locator('#rankList .food-title')).toHaveText('双方评价的旧上传');
  }
  await expect(page.locator('#rankList .metric.taste')).toContainText('8.0'); await expect(page.locator('#rankList .metric.value')).toContainText('7.0');
  await page.locator('#rankList .food-content').click(); await page.locator('[data-edit]').click(); await page.locator('#address').fill('刚刚修改地址'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.locator('[data-nav="home"]').click(); await expect(page.locator('#homeCards .food-title').first()).toHaveText('单人评价的新上传');
});

test('delete, cancel, failed delete retry, reload and restore preserve both reviews and photos', async ({ page }) => {
  const backup = await seedRecords(page); await ready(page);
  await page.locator('#homeCards [data-detail="complete"]').first().click();
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('[data-delete="complete"]').click(); await expect(page.locator('#detailSheet')).toHaveClass(/open/);
  await page.evaluate(() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function() { throw new DOMException('Storage full', 'QuotaExceededError'); }; });
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-delete="complete"]').click(); await expect(page.locator('#toast')).toContainText('Storage full'); await expect(page.locator('#homeCards .food-card')).toHaveCount(2);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-delete="complete"]').click(); await expect(page.locator('#detailSheet')).not.toHaveClass(/open/); await expect(page.locator('#homeCards .food-card')).toHaveCount(1);
  await page.reload(); await expect(page.locator('#homeCards .food-card')).toHaveCount(1); await page.locator('[data-nav="rank"]').click(); await expect(page.locator('#rankList .food-card')).toHaveCount(0);
  await page.locator('[data-nav="profile"]').click(); await expect(page.locator('#trashSummary')).toContainText('1 条');
  // Importing an older active backup must not resurrect the deleted ID.
  await page.locator('[data-open="backup"]').click(); await page.locator('#importInput').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await expect(page.locator('#toast')).toContainText('已合并'); await expect(page.locator('#homeCards .food-card')).toHaveCount(1); await page.locator('[data-close="backupSheet"]').click();
  await page.locator('[data-open="trash"]').click(); await expect(page.locator('#trashList .trash-record')).toHaveCount(1); await page.locator('[data-restore="complete"]').click(); await expect(page.locator('#trashList .trash-record')).toHaveCount(0); await page.locator('[data-close="trashSheet"]').click();
  await page.reload(); await expect(page.locator('#homeCards .food-title')).toHaveText(['单人评价的新上传', '双方评价的旧上传']); await page.locator('#homeCards [data-detail="complete"]').first().click();
  await expect(page.locator('#detailBody .person-card')).toHaveCount(2); await expect(page.locator('#detailBody .metric.value')).toContainText('7.0'); await expect(page.locator('#detailBody .photo-wall img')).toBeVisible();
  await page.locator('[data-close="detailSheet"]').click(); await page.locator('[data-nav="rank"]').click(); await expect(page.locator('#rankList .food-card')).toHaveCount(1);
});

test('category presets and custom labels persist and are suggested on later entries', async ({ page }) => {
  await ready(page); await page.locator('#mainAdd').click(); await expect(page.locator('#categoryOptions option[value="火锅"]')).toHaveCount(1);
  await page.locator('#restaurantName').fill('自定义分类店'); await page.locator('#category').fill('  学校旁的小馆  '); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.reload(); await expect(page.locator('#homeCards .food-meta')).toContainText('学校旁的小馆'); await page.locator('#mainAdd').click(); await expect(page.locator('#categoryOptions option[value="学校旁的小馆"]')).toHaveCount(1);
  await page.locator('#restaurantName').fill('空分类店'); await page.locator('#category').fill(''); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await expect(page.locator('#homeCards .food-card').first().locator('.food-meta')).toContainText('其他');
});

test('two local tabs never overwrite independent saves or revive a deleted record', async ({ page, context }) => {
  await ready(page); const other = await context.newPage(); await ready(other);
  await page.locator('#mainAdd').click(); await other.locator('#mainAdd').click();
  await page.locator('#restaurantName').fill('第一个页面'); await other.locator('#restaurantName').fill('第二个页面');
  await Promise.all([page.locator('#saveRecordBtn').click(), other.locator('#saveRecordBtn').click()]);
  await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await expect(other.locator('#editSheet')).not.toHaveClass(/open/);
  await page.reload(); await other.reload(); await expect(page.locator('#homeCards .food-card')).toHaveCount(2); await expect(other.locator('#homeCards .food-card')).toHaveCount(2);
  for (const p of [page, other]) await p.locator('#homeCards .food-card').filter({ hasText: '第一个页面' }).locator('.food-content').click();
  await other.locator('[data-edit]').click(); await other.locator('#reviewText').fill('这条草稿不能复活已经删除的记录');
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-delete]').click(); await expect(page.locator('#detailSheet')).not.toHaveClass(/open/);
  await other.locator('#saveRecordBtn').click(); await expect(other.locator('#saveMessage')).toContainText('记录已删除'); await expect(other.locator('#reviewText')).toHaveValue('这条草稿不能复活已经删除的记录');
  await page.reload(); await expect(page.locator('#homeCards .food-card')).toHaveCount(1); await page.locator('[data-nav="profile"]').click(); await expect(page.locator('#trashSummary')).toContainText('1 条');
});

test('hundreds of records remain searchable and sortable without truncating rankings', async ({ page }) => {
  const data = { restaurants: Array.from({ length: 600 }, (_, i) => ({ id: `r${i}`, name: `餐厅编号${String(i).padStart(3, '0')}`, category: i % 2 ? '火锅' : '我的自定义分类', status: 'eaten', created_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), price_per_person: i % 100 })),
    reviews: Array.from({ length: 600 }, (_, i) => ['local-me', 'local-partner'].map(user_id => ({ id: `${user_id}${i}`, restaurant_id: `r${i}`, user_id, taste: 8, value: i % 9 + 1, vibe: 7 }))).flat(), photos: [] };
  await page.addInitScript(data => localStorage.setItem('couple_food_mobile_v2', JSON.stringify(data)), data);
  await ready(page); await expect(page.locator('#homeCards .food-title').first()).toHaveText('餐厅编号599');
  await page.locator('[data-nav="rank"]').click(); await expect(page.locator('#rankList .food-card')).toHaveCount(600);
  await page.locator('[data-rank="price"]').click(); await expect(page.locator('#rankList .food-card').first().locator('.metric.price')).toContainText('¥0');
  await page.locator('[data-nav="records"]').click(); await page.locator('#searchInput').fill('餐厅编号599'); await expect(page.locator('#recordList .food-card')).toHaveCount(1);
});

test('revisit uses same place, blank scores and new photos while preserving past meals', async ({ page }) => {
  await seedRecords(page); await ready(page); await page.locator('#homeCards [data-detail="complete"]').first().click(); await page.locator('#detailBody [data-repeat]').click();
  await expect(page.locator('#recordPlace')).toHaveValue('complete'); await expect(page.locator('#restaurantName')).toHaveValue('双方评价的旧上传');
  await expect(page.locator('#price')).toHaveValue(''); await expect(page.locator('#overallScore')).toHaveText('未评'); await expect(page.locator('#photoPreviews .preview')).toHaveCount(0); await expect(page.locator('#reviewText')).toHaveValue('');
  await page.locator('#visitDate').fill('2026-09-20'); await page.locator('#price').fill('120'); await page.locator('#reviewText').fill('第二次的独立评价'); await rate(page, 'taste', 5); await rate(page, 'value', 4); await rate(page, 'vibe', 6);
  await page.locator('#photoInput').setInputFiles({ name: 'revisit.png', mimeType: 'image/png', buffer: pixel }); await expect(page.locator('#photoStatus')).toContainText('已就绪'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.locator('[data-nav="records"]').click(); await expect(page.locator('#recordList .food-card')).toHaveCount(2); await expect(page.locator('#resultsCount')).toHaveText('2 家店 · 3 条记录');
  const card = page.locator('#recordList .food-card[data-place="complete"]'); await expect(card.locator('.visit-tier')).toHaveText('回头客2 次'); await expect(card.locator('.visit-context')).toContainText('第 2 次打卡');
  await card.locator('.visit-history summary').click(); await expect(card.locator('.visit-row')).toHaveCount(2); await expect(card.locator('.visit-row img')).toHaveCount(2);
  await page.locator('#refreshBtn').click(); await expect(card.locator('.visit-history')).toHaveAttribute('open', '');
  await card.locator('.visit-open[data-detail="complete"]').click(); await expect(page.locator('#detailBody .person-card')).toHaveCount(2); await expect(page.locator('#detailBody .metric.value')).toContainText('7.0');
  await page.locator('[data-close="detailSheet"]').click(); await page.locator('[data-record-view="visits"]').click(); await expect(page.locator('#recordList .food-card')).toHaveCount(3);
  await page.locator('[data-nav="rank"]').click(); await expect(page.locator('#rankList .food-card')).toHaveCount(1); await expect(page.locator('#rankList .metric.value')).toContainText('7.0'); await expect(page.locator('#statsGrid .stat').first().locator('strong')).toHaveText('2');
  // Delete only the second meal; the first meal and its photo stay intact.
  await page.locator('[data-nav="records"]').click(); await page.locator('#recordList .food-card').first().locator('.food-content').click(); page.once('dialog', dialog => dialog.accept()); await page.locator('#detailBody [data-delete]').click(); await expect(page.locator('#detailSheet')).not.toHaveClass(/open/);
  await page.reload(); await page.locator('[data-nav="records"]').click(); await expect(page.locator('#recordList .food-card')).toHaveCount(2); await expect(page.locator('#recordList [data-place="complete"] .visit-tier')).toHaveText('初见1 次');
  await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="trash"]').click(); await page.locator('[data-restore]').click(); await expect(page.locator('#trashList .trash-record')).toHaveCount(0); await page.locator('[data-close="trashSheet"]').click(); await page.locator('[data-nav="records"]').click(); await expect(page.locator('#recordList [data-place="complete"] .visit-tier')).toHaveText('回头客2 次');
});

test('existing visits can be linked or separated without merging reviews and same-day warning prevents accidental duplicates', async ({ page }) => {
  await seedRecords(page); await ready(page); await page.locator('#homeCards [data-detail="pending"]').first().click(); await page.locator('#detailBody [data-edit]').click(); await page.locator('#recordPlace').selectOption('complete');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.locator('[data-nav="records"]').click(); await expect(page.locator('#recordList .food-card')).toHaveCount(1); await expect(page.locator('#recordList .visit-tier')).toHaveText('回头客2 次');
  await page.locator('#recordList .visit-history summary').click(); await page.locator('#recordList .visit-open[data-detail="pending"]').click(); await page.locator('#detailBody [data-edit]').click(); await expect(page.locator('#overallScore')).toHaveText('10.0'); await expect(page.locator('#photoPreviews .preview')).toHaveCount(0);
  await page.locator('#recordPlace').selectOption('new'); page.once('dialog', dialog => dialog.accept()); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await expect(page.locator('#recordList .food-card')).toHaveCount(2);
  await page.locator('#recordList [data-record="complete"] .food-content').click(); await page.locator('#detailBody [data-repeat]').click(); await page.locator('#visitDate').fill('2026-09-17'); await expect(page.locator('#placeSuggestion')).toContainText('这一天已有打卡');
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-existing-visit="complete"]').click(); await expect(page.locator('#detailSheet')).toHaveClass(/open/); await expect(page.locator('#detailBody .person-card')).toHaveCount(2); await expect(page.locator('#recordList .food-card')).toHaveCount(2);
});

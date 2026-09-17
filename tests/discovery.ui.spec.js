import { test, expect } from '@playwright/test';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=';
const row = (id, name, date, price, extra = {}) => ({ id, place_id: id, name, visit_date: date, price_per_person: price, status: 'eaten', city: '沈阳', category: '家常菜', created_at: '2026-09-17T01:00:00Z', ...extra });
const fixture = { restaurants: [
  row('a', '春日小馆', '2026-09-15', 60, { address: '青年大街 1 号' }),
  row('a2', '春日小馆', '2026-09-16', 0, { place_id: 'a', address: '青年大街 1 号' }),
  row('b', '街角咖啡', '2026-09-16', null, { city: '大连', category: '咖啡茶饮' }),
  row('c', '未填日期的小店', null, 20),
  row('w', '想吃的面馆', null, 25, { status: 'wishlist', category: '面馆粉店' }),
  row('z', '已删除的店', '2026-09-17', 100, { deleted_at: '2026-09-17T02:00:00Z', deleted_by: 'local-me' })
], reviews: [{ id: 'r', restaurant_id: 'a2', user_id: 'local-me', taste: 8, value: 9, vibe: 7, would_return: true, comment: '私人评价不能复制' }],
photos: [{ id: 'p', restaurant_id: 'a', user_id: 'local-me', url: pixel }] };
async function seed(page, data = fixture) {
  await page.addInitScript(data => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('couple_food_mobile_v2', JSON.stringify(data)); } }, data);
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案');
}
async function journal(page) {
  await page.locator('[data-nav="home"]').click(); await page.locator('.journal-home').click();
  await page.locator('#journalMonth').fill('2026-09'); await page.locator('#journalMonth').dispatchEvent('change');
}

test('advanced record filters combine, validate, include free meals and reset from home shortcuts', async ({ page }) => {
  await seed(page); await page.locator('[data-nav="records"]').click(); await page.locator('#advancedFilters summary').click();
  await page.locator('#filterCity').selectOption('沈阳'); await page.locator('#filterCategory').selectOption('家常菜'); await page.locator('#filterMaxPrice').fill('0');
  await expect(page.locator('#resultsCount')).toHaveText('1 家店 · 1 条记录'); await expect(page.locator('#recordList .food-card')).toHaveAttribute('data-record', 'a2');
  await page.locator('#filterMinPrice').fill('10'); await expect(page.locator('#recordFilterError')).toContainText('最低人均不能高于'); await expect(page.locator('#recordList .food-card')).toHaveCount(0);
  await page.locator('#resetRecordFilters').click(); await page.locator('#filterFrom').fill('2026-09-15'); await page.locator('#filterTo').fill('2026-09-15');
  await page.locator('#filterPhotos').check(); await expect(page.locator('#recordList .food-card')).toHaveAttribute('data-record', 'a');
  await page.locator('#filterFrom').fill('2026-09-17'); await page.locator('#filterFrom').blur(); await expect(page.locator('#recordFilterError')).toContainText('开始日期不能晚于');
  await page.locator('#filterUndated').check(); await expect(page.locator('#filterFrom')).toHaveValue(''); await expect(page.locator('#filterTo')).toHaveValue('');
  await page.locator('#filterPhotos').uncheck(); await page.locator('[data-filter="eaten"]').click(); await expect(page.locator('#recordList .food-title')).toHaveText('未填日期的小店');
  await page.locator('[data-nav="home"]').click(); await page.locator('[data-filter-go="eaten"]').click();
  await expect(page.locator('#filterUndated')).not.toBeChecked(); await expect(page.locator('#resultsCount')).toHaveText('3 家店 · 4 条记录');
});

test('dinner picker gives each place one chance, no repeat until exhausted, shows budget and opens detail', async ({ page }) => {
  await seed(page); await page.locator('[data-quick="random"]').click(); await expect(page.locator('#decisionCount')).toContainText('2 家');
  await page.locator('#drawDinner').click(); const first = await page.locator('#decisionResult h3').textContent();
  await page.locator('#drawDinner').click(); expect(await page.locator('#decisionResult h3').textContent()).not.toBe(first); await expect(page.locator('#decisionProgress')).toContainText('2/2');
  await page.locator('#drawDinner').click(); await expect(page.locator('#decisionProgress')).toContainText('1/2');
  await page.locator('#decisionSource').selectOption('all'); await expect(page.locator('#decisionCount')).toContainText('4 家');
  await page.locator('#decisionMaxPrice').fill('0'); await expect(page.locator('#decisionCount')).toContainText('1 家'); await page.locator('#drawDinner').click();
  await expect(page.locator('#decisionResult')).toContainText('上次实付人均 ¥0');
  await page.locator('#decisionCity').selectOption('大连'); await expect(page.locator('#drawDinner')).toBeDisabled(); await expect(page.locator('#decisionResult')).toContainText('暂时没有');
  await page.locator('#decisionMaxPrice').fill(''); await page.locator('#drawDinner').click(); await page.locator('#decisionResult [data-detail]').click();
  await expect(page.locator('#decisionSheet')).not.toHaveClass(/open/); await expect(page.locator('#detailSheet')).toHaveClass(/open/); await expect(page.locator('#detailBody')).toContainText('街角咖啡');
});

test('dinner picker excludes recently visited whole places including a wishlist entry', async ({ page }) => {
  const today = new Date(), date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await seed(page, { restaurants: [row('now', '今天吃过', date, 50), row('plan', '今天吃过', null, 40, { place_id: 'now', status: 'wishlist' }), row('old', '旧店', '2020-01-01', 50)], reviews: [], photos: [] });
  await page.locator('[data-quick="random"]').click(); await page.locator('#decisionSource').selectOption('all'); await expect(page.locator('#decisionCount')).toContainText('2 家');
  await page.locator('#decisionAvoidRecent').check(); await expect(page.locator('#decisionCount')).toContainText('1 家'); await page.locator('#drawDinner').click(); await expect(page.locator('#decisionResult h3')).toHaveText('旧店');
});

test('month journal separates visits, places and days, handles photo gallery, day filtering and undated records', async ({ page }) => {
  await seed(page); await journal(page); await expect(page.locator('#journalStats b')).toHaveText(['3', '2', '2', '¥30']);
  await expect(page.locator('#journalPriceNote')).toContainText('2 次已填实付'); await expect(page.locator('#journalMeals .food-card')).toHaveCount(3); await expect(page.locator('#journalCalendar button')).toHaveCount(30);
  await page.locator('#journalPhotos [data-photo]').click(); await expect(page.locator('#photoViewer')).toBeVisible(); await page.locator('#closePhotoViewer').click();
  await page.locator('[data-journal-day="2026-09-16"]').click(); await expect(page.locator('#journalMeals .food-card')).toHaveCount(2); await expect(page.locator('#journalPhotoSection')).toBeHidden(); await expect(page.locator('[data-journal-day="2026-09-16"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#showWholeMonth').click(); await expect(page.locator('#journalMeals .food-card')).toHaveCount(3);
  await page.locator('#previousMonth').click(); await expect(page.locator('#journalMonth')).toHaveValue('2026-08'); await expect(page.locator('#journalMeals')).toContainText('还是空白');
  await page.locator('#journalMonth').fill('2024-02'); await page.locator('#journalMonth').dispatchEvent('change'); await expect(page.locator('#journalCalendar button')).toHaveCount(29);
  await page.locator('#journalMonth').fill(''); await page.locator('#journalMonth').dispatchEvent('change'); await expect(page.locator('#journalContent')).toBeHidden(); await expect(page.locator('#journalError')).toContainText('有效月份');
  await page.locator('#currentMonth').click(); await page.locator('#journalUndated').click(); await expect(page.locator('#journalSheet')).not.toHaveClass(/open/); await expect(page.locator('#filterUndated')).toBeChecked(); await expect(page.locator('#recordList .food-title')).toHaveText('未填日期的小店');
});

test('restaurant copy contains no private reviews, and offers manual copy on permission failure', async ({ page }) => {
  await seed(page); await page.locator('#homeCards [data-record="a2"] .food-content').click(); await page.locator('#detailBody [data-copy-place]').click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedText = text; } } }));
  await page.locator('#copyPlaceText').click(); await expect(page.locator('#placeCopyMessage')).toContainText('已复制');
  expect(await page.evaluate(() => window.copiedText)).toBe('春日小馆\n沈阳 · 家常菜\n地址 / 分店：青年大街 1 号');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await page.locator('#copyPlaceText').click(); await expect(page.locator('#placeCopyMessage')).toContainText('长按上方文字');
  expect(await page.locator('#placeCopyText').evaluate(el => el.selectionEnd - el.selectionStart)).toBeGreaterThan(10);
});

test('new panels fit small Android and desktop widths, with readable inputs', async ({ page }) => {
  await seed(page); const errors = []; page.on('pageerror', e => errors.push(e.message));
  for (const width of [320, 393, 1280]) {
    await page.setViewportSize({ width, height: 851 }); await journal(page);
    expect(await page.locator('#journalSheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (width === 393) await page.screenshot({ path: '.private-audit/mobile-journal-2.4.png' });
    await page.locator('[data-close="journalSheet"]').click(); await page.locator('[data-quick="random"]').click();
    expect(await page.locator('#decisionSheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.locator('#decisionMaxPrice').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    if (width === 393) { await page.locator('#drawDinner').click(); await page.screenshot({ path: '.private-audit/mobile-decision-2.4.png' }); }
    await page.locator('[data-close="decisionSheet"]').click(); await page.locator('[data-nav="records"]').click(); await page.locator('#advancedFilters').evaluate(el => el.open = true);
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (width === 393) await page.screenshot({ path: '.private-audit/mobile-filters-2.4.png' });
  }
  expect(errors).toEqual([]);
});

test('new discovery modules and local data work offline, deletions update reports and picker', async ({ page, context }) => {
  await seed(page); await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js'); await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true); await page.reload(); await journal(page); await expect(page.locator('#journalStats b')).toHaveText(['3', '2', '2', '¥30']);
  await page.locator('#journalMeals [data-record="a2"] .food-content').click(); page.once('dialog', d => d.accept()); await page.locator('#detailBody [data-delete]').click();
  await journal(page); await expect(page.locator('#journalStats b')).toHaveText(['2', '2', '2', '¥60']);
  await page.locator('[data-close="journalSheet"]').click(); await page.locator('[data-quick="random"]').click(); await expect(page.locator('#decisionCount')).toContainText('1 家');
  await page.locator('#drawDinner').click(); await expect(page.locator('#decisionResult h3')).toHaveText('想吃的面馆');
});

import { test, expect } from '@playwright/test';
const photo = { name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64') };
async function ready(page) { await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案'); }
async function rate(page, key, value) { await page.locator(`[data-rate="${key}"]`).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, value); }
async function stash(page) { await page.locator('#stashDraft').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await expect(page.locator('#draftBanner')).toBeVisible(); }

test('in-app help is keyboard reachable and explains separate reviews, drafts and local data', async ({ page }) => {
  await ready(page); await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="help"]').focus(); await page.keyboard.press('Space');
  await expect(page.locator('#helpSheet')).toHaveClass(/open/); await expect(page.locator('#helpSheet')).toContainText('不要为了评分再发一条'); await expect(page.locator('#helpSheet')).toContainText('不含未完成草稿');
  await page.setViewportSize({ width: 320, height: 640 }); expect(await page.locator('#helpSheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#helpSheet')).not.toHaveClass(/open/);
});

test('draft stashes incomplete text, actual photo blobs and ratings, reloads and commits once', async ({ page }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('草稿小馆'); await page.locator('#reviewText').fill('还没写完的体验'); await page.locator('#price').fill('0');
  await rate(page, 'taste', 9); await page.locator('#againToggle').click(); await page.locator('#photoInput').setInputFiles(photo); await expect(page.locator('#photoStatus')).toContainText('已就绪'); await stash(page);
  await expect(page.locator('#homeCards .food-card')).toHaveCount(0); await expect(page.locator('#draftName')).toHaveText('草稿小馆'); await expect(page.locator('#draftInfo')).toContainText('1 张新照片');
  await page.reload(); await expect(page.locator('#draftBanner')).toBeVisible(); await page.locator('#resumeDraft').click(); await expect(page.locator('#restaurantName')).toHaveValue('草稿小馆'); await expect(page.locator('#reviewText')).toHaveValue('还没写完的体验');
  await expect(page.locator('#price')).toHaveValue('0'); await expect(page.locator('[data-rate="taste"]')).toHaveValue('9'); await expect(page.locator('#againToggle')).toHaveClass(/on/);
  await expect.poll(() => page.locator('#photoPreviews img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await expect(page.locator('#draftBanner')).toBeHidden(); await expect(page.locator('#homeCards .food-card')).toHaveCount(1);
  await page.reload(); await expect(page.locator('#draftBanner')).toBeHidden(); await expect(page.locator('#homeCards img')).toHaveCount(1); await expect(page.locator('#homeCards .metric.price')).toContainText('¥0');
});

test('unfinished blank forms can be stashed, replacement is confirmed, storage failure preserves current edits', async ({ page }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#reviewText').fill('只有几句话也可以先存'); await stash(page); await expect(page.locator('#draftName')).toHaveText('未命名的一顿');
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('另一份'); page.once('dialog', d => d.dismiss()); await page.locator('#stashDraft').click(); await expect(page.locator('#editSheet')).toHaveClass(/open/); await expect(page.locator('#stashDraft')).toBeEnabled();
  await page.evaluate(() => { window.draftPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { if (this.transaction.db.name === 'our-food-map-drafts') throw new DOMException('Full', 'QuotaExceededError'); return window.draftPut.apply(this, args); }; });
  page.once('dialog', d => d.accept()); await page.locator('#stashDraft').click(); await expect(page.locator('#saveMessage')).toContainText('编辑内容未丢失'); await expect(page.locator('#restaurantName')).toHaveValue('另一份');
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.draftPut; }); page.once('dialog', d => d.accept()); await stash(page); await expect(page.locator('#draftName')).toHaveText('另一份');
  page.once('dialog', d => d.dismiss()); await page.locator('#discardDraft').click(); await expect(page.locator('#draftBanner')).toBeVisible(); page.once('dialog', d => d.accept()); await page.locator('#discardDraft').click(); await expect(page.locator('#draftBanner')).toBeHidden();
});

test('restoring a stale draft never overwrites the other tabs saved record', async ({ page, context }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('共同的店'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  const second = await context.newPage(); await ready(second);
  await page.locator('#homeCards .food-content').click(); await page.locator('#detailBody [data-edit]').click(); await page.locator('#reviewText').fill('暂存的旧评价'); await stash(page);
  await second.locator('#homeCards .food-content').click(); await second.locator('#detailBody [data-edit]').click(); await second.locator('#restaurantName').fill('已经更新的店名'); await second.locator('#saveRecordBtn').click(); await expect(second.locator('#editSheet')).not.toHaveClass(/open/);
  await page.reload(); await page.locator('#resumeDraft').click(); await expect(page.locator('#saveMessage')).toContainText('原记录已变化'); await expect(page.locator('#reviewText')).toHaveValue('暂存的旧评价');
  await page.locator('#saveRecordBtn').click(); await expect(page.locator('#saveMessage')).toContainText('刚刚被修改');
  page.once('dialog', d => d.accept()); await page.locator('[data-close="editSheet"]').click(); await page.reload(); await expect(page.locator('#homeCards .food-title')).toHaveText('已经更新的店名'); await expect(page.locator('#draftBanner')).toBeVisible();
});

test('draft storage serializes concurrent edits, enforces revision deletion, expiry and account-scoped cleanup', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const api = await import('/lib/drafts.js?v=2.6.0');
    const payload = { id: 'temporary', status: 'eaten', fields: { restaurantName: '测试草稿' }, removed: [], added: [] };
    const race = await Promise.allSettled([api.saveDraft('cloud:a:s', payload), api.saveDraft('cloud:a:s', payload)]);
    const saved = await api.loadDraft('cloud:a:s'); let blocked = false;
    try { await api.removeDraft('cloud:a:s', 'stale'); } catch { blocked = true; }
    await api.saveDraft('cloud:b:s', payload); await api.saveDraft('local:local-me:', payload); await api.clearAccountDrafts('a');
    const remaining = [await api.loadDraft('cloud:a:s'), await api.loadDraft('cloud:b:s'), await api.loadDraft('local:local-me:')].map(Boolean);
    await new Promise((resolve, reject) => { const req = indexedDB.open('our-food-map-drafts', 1); req.onsuccess = () => { const tx = req.result.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put({ ...saved, savedAt: Date.now() - api.DRAFT_TTL }, 'cloud:expired:s'); tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = reject; }; });
    return { results: race.map(r => r.status).sort(), blocked, remaining, expired: await api.loadDraft('cloud:expired:s') };
  });
  expect(result.results).toEqual(['fulfilled', 'rejected']); expect(result.blocked).toBe(true); expect(result.remaining).toEqual([false, true, true]); expect(result.expired).toBeNull();
});

test('local draft including photo is usable offline and fits the smallest phone viewport', async ({ page, context }) => {
  await ready(page); await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js'); await navigator.serviceWorker.ready; }); await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true); await page.reload(); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('离线草稿的长店名用于测试小屏布局'); await page.locator('#photoInput').setInputFiles(photo); await expect(page.locator('#photoStatus')).toContainText('已就绪'); await stash(page);
  for (const width of [320, 393, 1280]) { await page.setViewportSize({ width, height: 851 }); expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
  await page.setViewportSize({ width: 393, height: 851 }); await page.locator('#draftBanner').scrollIntoViewIfNeeded(); await page.screenshot({ path: '.private-audit/mobile-draft-2.5.png' });
  await page.reload(); await page.locator('#resumeDraft').click(); await expect(page.locator('#photoPreviews img')).toHaveCount(1); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await expect(page.locator('#homeCards .food-card')).toHaveCount(1);
});

test('task center separates both reviewers, offers only appropriate actions and updates after completion', async ({ page }) => {
  const fixture = { restaurants: [
    { id: 'mine', name: '我还没评', status: 'eaten', visit_date: '2026-09-16', price_per_person: 0 },
    { id: 'partner', name: '对方还没评', status: 'eaten', visit_date: null, price_per_person: null },
    { id: 'wish', name: '想吃但没预算', status: 'wishlist' }
  ], reviews: [
    { id: 'r1', restaurant_id: 'mine', user_id: 'local-partner', taste: 8, value: 8, vibe: 8 },
    { id: 'r2', restaurant_id: 'partner', user_id: 'local-me', taste: 7, value: 7, vibe: 7 }
  ], photos: [{ id: 'missing', restaurant_id: 'partner', user_id: 'local-partner', url: '' }] };
  await page.addInitScript(data => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('couple_food_mobile_v2', JSON.stringify(data)); } }, fixture);
  await ready(page); await page.locator('.task-home').click(); await expect(page.locator('#taskList .task-card')).toHaveCount(1); await expect(page.locator('#taskList')).toContainText('我还没评');
  await page.locator('[data-task-filter="partner"]').click(); await expect(page.locator('#taskList')).toContainText('对方还没评'); await expect(page.locator('#taskList [data-task-edit]')).toHaveCount(0);
  await page.locator('[data-task-filter="price"]').click(); await expect(page.locator('#taskList .task-card')).toHaveCount(2); await page.locator('[data-task-filter="photos"]').click(); await expect(page.locator('#taskList .task-card')).toHaveCount(1);
  for (const width of [320, 393, 1280]) { await page.setViewportSize({ width, height: 851 }); expect(await page.locator('#tasksSheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true); }
  await page.setViewportSize({ width: 393, height: 851 }); await page.locator('[data-task-filter="all"]').click(); await page.screenshot({ path: '.private-audit/mobile-tasks-2.5.png' });
  await page.locator('[data-task-filter="mine"]').click(); await page.locator('#taskList [data-task-edit]').click(); await expect(page.locator('#tasksSheet')).not.toHaveClass(/open/); await expect(page.locator('#overallScore')).toHaveText('未评');
  for (const key of ['taste', 'value', 'vibe']) await rate(page, key, 8);
  await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/); await page.locator('.task-home').click(); await expect(page.locator('#taskList .task-card')).toHaveCount(0); await expect(page.locator('#taskList')).toContainText('已经整理好');
});

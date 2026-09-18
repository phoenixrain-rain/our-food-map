import { test, expect } from '@playwright/test';
import pkg from '../package.json' with { type: 'json' };
const meals = [
  { id: 'old', place_id: 'shared', name: '复访小馆', status: 'eaten', visit_date: '2026-08-01', price_per_person: 0, created_at: '2026-08-01T08:00:00Z' },
  { id: 'full', place_id: 'shared', name: '复访小馆', status: 'eaten', visit_date: '2026-09-01', price_per_person: 90, created_at: '2026-09-01T08:00:00Z' },
  { id: 'pending', place_id: 'shared', name: '复访小馆', status: 'eaten', visit_date: '2026-09-15', price_per_person: null, created_at: '2026-09-15T08:00:00Z' }
];
const reviews = meals.slice(0, 2).flatMap((meal, index) => ['local-me', 'local-partner'].map((user_id, person) => ({ id: `${meal.id}-${person}`, restaurant_id: meal.id, user_id, taste: 6 + index * 2 + person * 2, value: 8, vibe: 9 - index, favorite_dish: index ? '<img src=x onerror=alert(1)> 招牌豆腐' : '招牌豆腐' })));
async function ready(page) {
  await page.addInitScript(data => localStorage.setItem('couple_food_mobile_v2', JSON.stringify(data)), { nickname: '我', partnerName: 'TA', restaurants: meals, reviews, photos: [] });
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案');
  await page.locator('#homeCards [data-record="pending"] .food-content').click(); await page.locator('#detailBody .place-insights summary').click();
}

test('revisit summary distinguishes average price, latest joint changes and private dish phrases', async ({ page }) => {
  await ready(page); const recap = page.locator('#detailBody .place-insights');
  await expect(recap.locator('.insights-stats')).toContainText('¥45'); await expect(recap).toContainText('2/3'); await expect(recap).toContainText('不是两人总花费');
  await expect(recap.locator('[data-dimension="taste"]')).toContainText('上升 2.0'); await expect(recap.locator('[data-dimension="value"]')).toContainText('持平'); await expect(recap.locator('[data-dimension="vibe"]')).toContainText('下降 1.0');
  await expect(recap.locator('.insights-dishes img')).toHaveCount(0); await expect(recap.locator('.insights-dishes')).toContainText('<img');
  await recap.locator('.insights-dates [data-detail="full"]').click(); await expect(page.locator('#detailBody [data-edit]')).toHaveAttribute('data-edit', 'full'); await expect(recap).toHaveAttribute('open', '');
  await page.locator('#detailBody [data-copy-place]').click(); await expect(page.locator('#placeCopyText')).not.toHaveValue(/招牌豆腐|onerror/);
});

test('open recap updates after local refresh, remains usable offline, and removed visits stop participating', async ({ page, context }) => {
  await ready(page); await page.evaluate(async version => {
    const { mutateLocal } = await import(`/lib/local-store.js?v=${version}`); await mutateLocal(data => { data.restaurants.find(r => r.id === 'full').price_per_person = 120; }); document.querySelector('#refreshBtn').click();
  }, pkg.version);
  await expect(page.locator('#detailBody .place-insights')).toHaveAttribute('open', ''); await expect(page.locator('.insights-stats')).toContainText('¥60');
  await page.keyboard.press('Escape'); await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js'); await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true); await context.setOffline(true); await page.reload(); await expect(page.locator('#connectionBanner')).toContainText('当前离线'); await expect(page.locator('#homeCards .food-card')).toHaveCount(3);
  await page.locator('#homeCards [data-record="full"] .food-content').click(); page.once('dialog', dialog => dialog.accept()); await page.locator('#detailBody [data-delete]').click();
  await page.locator('#homeCards [data-record="pending"] .food-content').click(); await page.locator('.place-insights summary').click(); await expect(page.locator('.place-insights')).toContainText('还需要两次'); await expect(page.locator('.insight-dimension')).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="trash"]').click(); await page.locator('[data-restore="full"]').click(); await page.keyboard.press('Escape'); await page.locator('[data-nav="home"]').click();
  await page.locator('#homeCards [data-record="pending"] .food-content').click(); await page.locator('.place-insights summary').click(); await expect(page.locator('.insight-dimension')).toHaveCount(3);
});

test('revisit summary and comparison fit a small phone and desktop without horizontal overflow', async ({ page }) => {
  await ready(page);
  for (const width of [320, 393, 1280]) {
    await page.setViewportSize({ width, height: 850 }); await page.locator('.place-insights').scrollIntoViewIfNeeded();
    expect(await page.locator('#detailSheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.locator('.place-insights').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    if (width === 393) await page.screenshot({ path: '.private-audit/mobile-insights-2.7.png' });
  }
});

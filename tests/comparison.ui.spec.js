import { test, expect } from '@playwright/test';
import pkg from '../package.json' with { type: 'json' };
import { comparisonFixture } from './fixtures/comparison.js';

async function ready(page) {
  await page.addInitScript(data => { if (!localStorage.getItem('comparison-seed')) { localStorage.setItem('comparison-seed', '1'); localStorage.setItem('couple_food_mobile_v2', JSON.stringify(data)); } }, comparisonFixture);
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案');
  await page.locator('[data-nav="records"]').click(); await page.locator('[data-page="records"] [data-open="compare"]').click();
}
const choose = (page, id) => page.locator(`[data-compare-toggle="local-space:${id}"]`).click();
const cells = (page, row) => page.locator(`[data-compare-row="${row}"] td`);

test('shortlist picks stable places once, limits to three, searches and preserves selection across filters', async ({ page }) => {
  await ready(page); await expect(page.locator('#compareCandidates button')).toHaveCount(4);
  await choose(page, 'a'); await choose(page, 'b'); await choose(page, 'c'); await expect(page.locator('#compareStatus')).toContainText('3/3');
  await expect(page.locator('[data-compare-toggle="local-space:d"]')).toBeDisabled();
  await page.locator('#compareSource').selectOption('wishlist'); await expect(page.locator('#compareCandidates button')).toHaveCount(2); await expect(page.locator('#compareSelected button')).toHaveCount(3);
  await page.locator('[data-compare-remove="local-space:c"]').click(); await page.locator('#compareSource').selectOption('all'); await page.locator('#compareSearch').fill('北京');
  await expect(page.locator('#compareCandidates button')).toHaveCount(1); await choose(page, 'd');
  await page.locator('#clearComparison').click(); await expect(page.locator('#compareStatus')).toContainText('0/3'); await expect(page.locator('#compareChooser summary')).toBeFocused();
  await expect(page.locator('#recordList .food-card')).toHaveCount(4);
});
test('comparison separates joint review and price sources, marks real differences and escapes untrusted names', async ({ page }) => {
  await ready(page); await choose(page, 'a'); await choose(page, 'b'); await choose(page, 'c'); await page.locator('#showComparison').click();
  await expect(cells(page, 'taste').nth(0)).toContainText('8.0'); await expect(cells(page, 'taste').nth(2)).toHaveText('待双方评完');
  await expect(page.locator('[data-compare-row="taste"] .comparison-highlight')).toHaveCount(0);
  await expect(cells(page, 'value').nth(1)).toContainText('本组较高'); await expect(cells(page, 'price').nth(0)).toHaveText('¥90'); await expect(cells(page, 'price').nth(1)).toContainText('¥0');
  await expect(cells(page, 'budget').nth(0)).toHaveText('¥25 / 人'); await expect(cells(page, 'review-source').nth(0)).toContainText('2026-08-01'); await expect(cells(page, 'price-source').nth(0)).toContainText('2026-09-20');
  await expect(cells(page, 'review-source').nth(0)).toContainText('最近一次尚未评完'); await expect(page.locator('#compareResults img')).toHaveCount(0); await expect(page.locator('#compareResults')).toContainText('<img src=x onerror=alert(1)>');
  await cells(page, 'review-source').nth(0).locator('button').click(); await expect(page.locator('#detailBody [data-edit]')).toHaveAttribute('data-edit', 'a-old');
  await page.keyboard.press('Escape'); await expect(page.locator('#compareSheet')).toHaveClass(/open/); await expect(cells(page, 'review-source').nth(0).locator('button')).toBeFocused();
});
test('detail shortcut does not toggle off a previous selection or add a second visit of the same place', async ({ page }) => {
  await ready(page); await page.keyboard.press('Escape'); await page.locator('#recordList [data-record="a-new"] .food-content').click();
  await page.locator('#detailBody [data-compare-add]').click(); await expect(page.locator('#compareStatus')).toContainText('1/3'); await page.keyboard.press('Escape');
  await page.locator('#detailBody [data-compare-add]').click(); await expect(page.locator('#compareStatus')).toContainText('1/3'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.locator('[data-page="records"] [data-open="compare"]').click(); await choose(page, 'b'); await expect(page.locator('#compareStatus')).toContainText('2/3');
});
test('live refresh updates comparisons, prunes removed places, and offline reopening never loses records', async ({ page, context }) => {
  await ready(page); await choose(page, 'a'); await choose(page, 'b'); await page.locator('#showComparison').click();
  await page.evaluate(async version => { const { mutateLocal } = await import(`/lib/local-store.js?v=${version}`); await mutateLocal(data => { data.restaurants.find(r => r.id === 'a-new').price_per_person = 120; }); document.querySelector('#refreshBtn').click(); }, pkg.version);
  await expect(cells(page, 'price').nth(0)).toHaveText('¥120'); await expect(page.locator('#compareChooser')).not.toHaveAttribute('open', '');
  await page.evaluate(async version => { const { mutateLocal } = await import(`/lib/local-store.js?v=${version}`); await mutateLocal(data => { data.restaurants = data.restaurants.filter(r => r.place_id !== 'a'); }); document.querySelector('#refreshBtn').click(); }, pkg.version);
  await expect(page.locator('#compareStatus')).toContainText('1/3'); await expect(page.locator('#compareResults table')).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js'); await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true); await context.setOffline(true); await page.reload(); await expect(page.locator('#connectionBanner')).toContainText('当前离线');
  await page.locator('[data-nav="records"]').click(); await page.locator('[data-page="records"] [data-open="compare"]').click(); await expect(page.locator('#compareStatus')).toContainText('0/3'); await expect(page.locator('#compareCandidates button')).toHaveCount(3);
  await choose(page, 'b'); await choose(page, 'c'); await page.locator('#showComparison').click(); await expect(cells(page, 'price').nth(0)).toHaveText('¥0');
});
test('mobile comparison scroll stays within its panel with sticky labels, readable search and keyboard return', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await ready(page); await choose(page, 'a'); await choose(page, 'b'); await choose(page, 'c');
  expect(await page.locator('#compareSearch').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16); await page.locator('#showComparison').click();
  for (const width of [320, 393, 1280]) {
    await page.setViewportSize({ width, height: 851 }); expect(await page.locator('#compareSheet .sheet').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const box = page.locator('.comparison-scroll'); await box.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = 80; });
    const labels = await box.evaluate(el => ({ container: el.getBoundingClientRect().left, label: el.querySelector('tbody th').getBoundingClientRect().left })); expect(Math.abs(labels.label - labels.container)).toBeLessThan(3);
    await box.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; }); if (width === 393) await page.screenshot({ path: '.private-audit/mobile-comparison-2.8.png' });
  }
  await page.keyboard.press('Escape'); await expect(page.locator('[data-page="records"] [data-open="compare"]')).toBeFocused(); expect(errors).toEqual([]);
});

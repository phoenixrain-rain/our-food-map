import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, rankedRestaurants } from '../lib/model.js';
import { placeInsights, insightsHTML } from '../lib/insights.js';
const row = (id, visit_date, extra = {}) => ({ id, place_id: 'place', space_id: 'space', name: '复访店', status: 'eaten', visit_date, created_at: `${visit_date || '2026-09-01'}T12:00:00Z`, price_per_person: 50, ...extra });
const pair = (id, a, b, extra = {}) => [a, b].map((value, index) => ({ id: `${id}-${index}`, restaurant_id: id, user_id: index ? 'partner' : 'me', taste: value, value, vibe: value, ...extra }));
function fixture() {
  return { ...emptyData(), restaurants: [row('old', '2026-08-01', { price_per_person: 0 }), row('full', '2026-09-01', { price_per_person: 90 }), row('pending', '2026-09-15', { price_per_person: null }), row('undated', null, { price_per_person: 60 }), row('wish', '2026-10-01', { status: 'wishlist', price_per_person: 999 }), row('trash', '2026-09-12', { deleted_at: '2026-09-13' }), row('branch', '2026-09-14', { place_id: 'another' }), row('other-space', '2026-09-16', { space_id: 'other' })], reviews: [...pair('old', 6, 8), ...pair('full', 8, 10), ...pair('undated', 10, 10), pair('pending', 9, 9)[0]], photos: [] };
}

test('place insights deduplicate visits, exclude wishlists/trash/other places and distinguish zero from missing prices', () => {
  const data = fixture(); data.restaurants.push(data.restaurants[0]); const before = structuredClone(data);
  const report = placeInsights(data, data.restaurants[0]);
  assert.equal(report.visits.length, 4); assert.equal(report.pricedCount, 3); assert.equal(report.averagePrice, 50); assert.equal(report.minPrice, 0); assert.equal(report.maxPrice, 90);
  assert.equal(report.datedCount, 3); assert.equal(report.firstDate, '2026-08-01'); assert.equal(report.lastDate, '2026-09-15'); assert.deepEqual(data, before);
});
test('changes compare the latest two dated joint reviews, never historical best or mixed unfinished visits', () => {
  const data = fixture(), rankedBefore = rankedRestaurants(data).map(r => r.id), report = placeInsights(data, data.restaurants[0]);
  assert.equal(report.previous.id, 'old'); assert.equal(report.latest.id, 'full'); assert.equal(report.completeCount, 2);
  assert.deepEqual(report.dimensions.map(d => [d.from, d.to, d.change]), [[7, 9, 2], [7, 9, 2], [7, 9, 2]]);
  assert.deepEqual(rankedRestaurants(data).map(r => r.id), rankedBefore);
  data.restaurants.find(r => r.id === 'full').deleted_at = '2026-09-18'; assert.deepEqual(placeInsights(data, data.restaurants[0]).dimensions, []);
});
test('same-day visits use upload order, missing dates and amounts are not fabricated', () => {
  const data = { ...emptyData(), restaurants: [row('first', '2026-09-01', { created_at: '2026-09-01T08:00:00Z', price_per_person: null }), row('later', '2026-09-01', { created_at: '2026-09-01T18:00:00Z', price_per_person: null }), row('invalid', '2026-02-30', { price_per_person: null })], reviews: [...pair('first', 10, 10), ...pair('later', 8, 8), ...pair('invalid', 9, 9)] };
  const report = placeInsights(data, data.restaurants[0]); assert.equal(report.latest.id, 'later'); assert.equal(report.previous.id, 'first'); assert.equal(report.dimensions[0].change, -2); assert.equal(report.averagePrice, null); assert.equal(report.pricedCount, 0); assert.equal(report.datedCount, 2);
  assert.equal(insightsHTML({ ...emptyData(), restaurants: [data.restaurants[0]] }, data.restaurants[0], String), '');
});
test('recommended phrases count once per visit, preserve whole text, respect latest reviews and stay escaped', () => {
  const data = fixture(); data.reviews = [...pair('old', 8, 8, { favorite_dish: '招牌菜' }), ...pair('full', 8, 8, { favorite_dish: ' 招牌菜 ' }), ...pair('pending', 8, 8, { favorite_dish: '<img onerror=alert(1)>、另一道菜' })];
  data.reviews.push({ ...data.reviews[0], favorite_dish: '旧评分已替换', updated_at: '2000-01-01' }); data.reviews[0].updated_at = '2026-01-01';
  const report = placeInsights(data, data.restaurants[0]); assert.equal(report.dishes[0].text, '<img onerror=alert(1)>、另一道菜'); assert.equal(report.dishes[0].visits, 1);
  assert.equal(report.dishes[1].text, '招牌菜'); assert.equal(report.dishes[1].visits, 2); assert.equal(report.dishes[1].lastVisitId, 'full'); assert.equal(report.dishes.length, 2);
  const html = insightsHTML(data, data.restaurants[0], value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
  assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img')); assert.ok(html.includes('不是两人总花费'));
});

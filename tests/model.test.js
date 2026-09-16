import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, rating, reviewScore, summary, tasteMatch, filterRestaurants, sortRestaurants, formatPrice, todayLocal, validateBackup, safeImageURL } from '../lib/model.js';
const restaurant = (id, price = null, status = 'eaten') => ({ id, name: id, status, price_per_person: price, created_at: '2026-09-16' });
test('unrated and partial ratings never become automatic 8s or zeros', () => {
  assert.equal(rating(null), null); assert.equal(rating(''), null); assert.equal(rating(false), null); assert.equal(rating(0), null); assert.equal(rating(11), null);
  assert.equal(reviewScore({ taste: 9, value: 8 }), null);
  assert.equal(reviewScore({ taste: 8, value: 6, vibe: 5, service: 10, look: 10 }), 6.8);
});
test('dimension averages ignore missing scores; shared favorites require both people', () => {
  const data = { ...emptyData(), restaurants: [restaurant('r')], reviews: [{ restaurant_id: 'r', user_id: 'a', taste: 10, favorite: true }, { restaurant_id: 'r', user_id: 'b', taste: null, value: 6, favorite: false }] };
  const s = summary(data, data.restaurants[0]); assert.equal(s.taste, 10); assert.equal(s.value, 6); assert.equal(s.overall, null); assert.equal(s.bothFavorite, false);
  data.reviews[1].favorite = true; assert.equal(summary(data, data.restaurants[0]).bothFavorite, true);
});
test('wishlist reviews never influence ranking or shared favorites', () => {
  const data = { ...emptyData(), restaurants: [restaurant('r', 80, 'wishlist')], reviews: [{ restaurant_id: 'r', user_id: 'a', taste: 10, value: 10, vibe: 10, favorite: true }] };
  assert.equal(summary(data, data.restaurants[0]).taste, null); assert.equal(summary(data, data.restaurants[0]).overall, null);
});
test('my pending and partner pending are distinct; dish search works', () => {
  const data = { ...emptyData(), restaurants: [restaurant('r')], reviews: [{ restaurant_id: 'r', user_id: 'a', taste: 8, value: 8, vibe: 8, favorite_dish: '鸡架' }] };
  assert.equal(filterRestaurants(data, { selfId: 'a', filter: 'mine-pending' }).length, 0);
  assert.equal(filterRestaurants(data, { selfId: 'a', filter: 'pending' }).length, 1);
  assert.equal(filterRestaurants(data, { query: '鸡架' }).length, 1);
  assert.equal(filterRestaurants(data, { filter: 'favorite' }).length, 0);
});
test('zero-yuan meals are distinct from unknown price and sort first', () => {
  const data = { ...emptyData(), restaurants: [restaurant('unknown'), restaurant('normal', 80), restaurant('free', 0)] };
  assert.deepEqual(sortRestaurants(data.restaurants, data, 'price').map(r => r.id), ['free', 'normal', 'unknown']);
  assert.equal(formatPrice(0), '¥0'); assert.equal(formatPrice(null), '未填人均');
});
test('taste match cannot hide opposite tastes behind identical overall means', () => {
  const data = { ...emptyData(), restaurants: [restaurant('r')], reviews: [{ restaurant_id: 'r', user_id: 'a', taste: 10, value: 1 }, { restaurant_id: 'r', user_id: 'b', taste: 1, value: 10 }] };
  assert.deepEqual(tasteMatch(data, 'a'), { value: 0, count: 1 });
  data.reviews[1].taste = null; assert.equal(tasteMatch(data, 'a').value, null);
});
test('backups validate links and references and never restore a cloud scope', () => {
  const raw = { ...emptyData(), space: { id: 'private' }, restaurants: [restaurant('r')], photos: [{ id: 'p', restaurant_id: 'r', user_id: 'local-me', url: 'https://example.com/expired?token=secret' }] };
  const result = validateBackup(raw); assert.equal(result.space, null); assert.equal(result.photos[0].url, ''); assert.equal(result.photos[0].unavailable, true);
  assert.equal(safeImageURL('javascript:alert(1)'), ''); assert.equal(safeImageURL('data:image/svg+xml;base64,ABC'), '');
  raw.reviews = [{ restaurant_id: 'absent' }]; assert.throws(() => validateBackup(raw), /餐厅/);
});
test('local calendar dates use device date components', () => {
  assert.equal(todayLocal(new Date(2026, 8, 16, 0, 1)), '2026-09-16');
});

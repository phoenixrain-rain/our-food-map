import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonPlaces, selectedPlaces, filterComparison, comparisonLeaders } from '../lib/comparison.js';
import { comparisonFixture } from './fixtures/comparison.js';

test('comparison keeps stable places separate and coherent joint scores, latest spending and wishlist budgets', () => {
  const before = JSON.stringify(comparisonFixture), places = comparisonPlaces(comparisonFixture), a = places.find(p => p.key === 'local-space:a');
  assert.equal(places.length, 4); assert.equal(a.count, 2); assert.equal(a.joint.id, 'a-old'); assert.equal(a.latest.id, 'a-new');
  assert.equal(a.scores.taste, 8); assert.equal(a.price, 90); assert.equal(a.budget, 25);
  assert.equal(places.find(p => p.key === 'local-space:b').price, 0);
  assert.equal(places.find(p => p.key === 'local-space:c').scores, null);
  assert.equal(places.find(p => p.key === 'local-space:d').scores, null);
  assert.equal(JSON.stringify(comparisonFixture), before);
});
test('unknown money never borrows an old value; deleted and duplicate visits, same-day dates and spaces are handled', () => {
  const data = structuredClone(comparisonFixture); data.restaurants.find(r => r.id === 'a-new').price_per_person = null;
  data.restaurants.push({ ...data.restaurants[0] }, { ...data.restaurants[0], id: 'other-space', space_id: 'other' });
  let a = comparisonPlaces(data).find(p => p.key === 'local-space:a'); assert.equal(a.count, 2); assert.equal(a.price, null);
  assert.equal(comparisonPlaces(data).length, 5);
  data.restaurants.find(r => r.id === 'a-new').deleted_at = '2026-09-23T00:00:00Z';
  a = comparisonPlaces(data).find(p => p.key === 'local-space:a'); assert.equal(a.count, 1); assert.equal(a.price, 60);
  data.restaurants.find(r => r.id === 'a-new').deleted_at = null;
  data.restaurants.find(r => r.id === 'a-new').visit_date = '2026-08-01';
  assert.equal(comparisonPlaces(data).find(p => p.key === 'local-space:a').latest.id, 'a-new');
  data.restaurants.find(r => r.id === 'a-new').visit_date = null;
  assert.equal(comparisonPlaces(data).find(p => p.key === 'local-space:a').latest.id, 'a-old');
});
test('shortlist is ordered, limited and unique; filters search all visits without discarding selected items', () => {
  const places = comparisonPlaces(comparisonFixture), keys = ['local-space:c', 'local-space:a', 'local-space:a', 'gone', 'local-space:b', 'local-space:d'];
  assert.deepEqual(selectedPlaces(places, keys).map(p => p.key), ['local-space:c', 'local-space:a', 'local-space:b']);
  assert.equal(filterComparison(places, '', 'wishlist').length, 2); assert.equal(filterComparison(places, '', 'eaten').length, 3);
  assert.equal(filterComparison(places, '约会')[0].key, 'local-space:a'); assert.equal(filterComparison(places, '北京')[0].key, 'local-space:d');
  assert.equal(filterComparison(places, '不存在').length, 0); assert.equal(keys.length, 6);
});
test('relative highlights ignore unknowns and budgets, require two known values, and handle ties', () => {
  const places = comparisonPlaces(comparisonFixture);
  assert.deepEqual(comparisonLeaders(places, 'taste'), []);
  assert.deepEqual(comparisonLeaders(places, 'value'), ['local-space:b']);
  assert.deepEqual(comparisonLeaders(places, 'price'), ['local-space:b']);
  assert.deepEqual(comparisonLeaders(places.filter(p => p.key !== 'local-space:a'), 'price'), []);
  assert.deepEqual(comparisonLeaders(places, 'budget'), []);
  const b = places.find(p => p.key === 'local-space:b');
  assert.deepEqual(new Set(comparisonLeaders([...places, { ...b, key: 'tie' }], 'value')), new Set(['local-space:b', 'tie']));
});

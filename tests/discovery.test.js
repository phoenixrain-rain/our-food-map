import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from '../lib/model.js';
import { criteriaError, filterRecords, decisionCandidates, drawCandidate, monthJournal, shiftMonth, validDate, validMonth, restaurantText, facetValues } from '../lib/discovery.js';
const row = (id, extra = {}) => ({ id, place_id: id, space_id: 's', name: id, status: 'eaten', city: '沈阳', category: '火锅', visit_date: '2026-09-10', price_per_person: 60, created_at: '2026-09-10T08:00:00Z', ...extra });
const data = rows => ({ ...emptyData(), restaurants: rows });

test('advanced filters combine exact facets, inclusive price/date ranges, photo metadata and undated state', () => {
  const state = data([row('free', { price_per_person: 0 }), row('same', { price_per_person: null }), row('different', { city: '沈阳市' }), row('old', { visit_date: '2026-08-31' }), row('no-date', { visit_date: null }), row('removed', { deleted_at: '2026-09-11' })]);
  state.photos = [{ id: 'p', restaurant_id: 'free', url: '' }];
  assert.deepEqual(filterRecords(state, { city: '沈阳', category: '火锅', minPrice: '0', maxPrice: '0', from: '2026-09-10', to: '2026-09-10', hasPhotos: true }).map(r => r.id), ['free']);
  assert.deepEqual(filterRecords(state, { onlyUndated: true }).map(r => r.id), ['no-date']);
  assert.equal(filterRecords(state, { from: '2026-09-01' }).some(r => r.id === 'no-date'), false);
  assert.equal(filterRecords(state).some(r => r.id === 'removed'), false);
  assert.deepEqual(facetValues(state, 'city'), ['沈阳', '沈阳市']);
});
test('invalid ranges are explicit errors, rather than inverted queries or treating unknown money as zero', () => {
  assert.ok(criteriaError({ minPrice: 100, maxPrice: 20 }));
  assert.ok(criteriaError({ maxPrice: 'no' })); assert.ok(criteriaError({ maxPrice: -1 }));
  assert.ok(criteriaError({ from: '2026-09-10', to: '2026-09-01' }));
  assert.ok(criteriaError({ from: '2026-02-30' })); assert.ok(criteriaError({ from: '2026-09-01', onlyUndated: true }));
  assert.equal(criteriaError({ maxPrice: 0 }), ''); assert.equal(validDate('2024-02-29'), true); assert.equal(validDate('2026-02-29'), false);
});
test('dinner choices use each place once and the latest eligible snapshot, not an older cheaper visit', () => {
  const state = data([row('old', { place_id: 'shared', price_per_person: 20 }), row('new', { place_id: 'shared', price_per_person: 100, visit_date: '2026-09-12' }), row('wish', { status: 'wishlist', price_per_person: 30 }), row('unknown', { status: 'wishlist', price_per_person: null })]);
  state.reviews = ['old', 'new'].map(id => ({ restaurant_id: id, user_id: 'local-me', would_return: true }));
  assert.equal(decisionCandidates(state).length, 3);
  assert.deepEqual(decisionCandidates(state, { maxPrice: 40 }).map(c => c.restaurant.id), ['wish']);
  assert.deepEqual(decisionCandidates(state, { source: 'again' }).map(c => c.restaurant.id), ['new']);
  state.reviews = state.reviews.filter(r => r.restaurant_id !== 'new');
  assert.equal(decisionCandidates(state, { source: 'again' }).length, 0, 'old return flag cannot override latest visit');
});
test('recent exclusion counts all visits of the place, including today but not future or undated records', () => {
  const state = data([row('recent', { visit_date: '2026-09-11' }), row('today', { visit_date: '2026-09-17' }), row('old', { visit_date: '2026-09-10' }), row('future', { visit_date: '2026-09-18' }), row('none', { visit_date: null }), row('planned', { place_id: 'recent', status: 'wishlist', visit_date: '2026-10-01' })]);
  assert.deepEqual(decisionCandidates(state, { source: 'all', avoidRecent: true }, '2026-09-17').map(c => c.restaurant.id), ['old', 'future', 'none']);
});
test('drawing without replacement is fair by place, restarts only after exhausting and handles empty pools', () => {
  const pool = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]; let seen = [];
  for (const key of ['a', 'b', 'c']) { const result = drawCandidate(pool, seen, () => 0); assert.equal(result.candidate.key, key); assert.equal(result.restarted, false); seen = result.seen; }
  const restart = drawCandidate(pool, seen, () => 0); assert.equal(restart.restarted, true); assert.deepEqual(restart.seen, ['a']);
  assert.equal(drawCandidate([], []).candidate, null); assert.equal(drawCandidate(pool, [], () => 1).candidate.key, 'c');
});
test('monthly journal separates visits, places and days, excludes wishlist/trash/undated and counts zero price', () => {
  const state = data([row('a'), row('b', { place_id: 'a', price_per_person: 0 }), row('c', { visit_date: '2026-09-11', price_per_person: null }), row('wish', { status: 'wishlist', price_per_person: 999 }), row('trash', { deleted_at: '2026-09-11' }), row('undated', { visit_date: null }), row('old', { visit_date: '2026-08-31' })]);
  state.restaurants.push(state.restaurants[0]);
  state.reviews = [{ restaurant_id: 'a', user_id: 'local-me', taste: 8, value: 9, vibe: 7 }];
  const report = monthJournal(state, '2026-09');
  assert.equal(report.rows.length, 3); assert.equal(report.placeCount, 2); assert.equal(report.dayCount, 2);
  assert.equal(report.averagePrice, 30); assert.equal(report.pricedCount, 2); assert.equal(report.pendingCount, 2); assert.equal(report.undatedCount, 1);
  assert.equal(report.days[0].date, '2026-09-11'); assert.equal(report.calendarLength, 30); assert.equal(report.offset, 1);
});
test('calendar handles leap years, month boundaries, empty months and invalid fallback input', () => {
  assert.equal(monthJournal(emptyData(), '2024-02').calendarLength, 29); assert.equal(monthJournal(emptyData(), '2100-02').calendarLength, 28);
  assert.equal(monthJournal(emptyData(), '2026-01').averagePrice, null);
  assert.equal(shiftMonth('2026-01', -1), '2025-12'); assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('0001-01', -1), '0001-01'); assert.equal(shiftMonth('9999-12', 1), '9999-12');
  assert.equal(validMonth('2026-13'), false); assert.equal(validMonth('0000-01'), false); assert.throws(() => monthJournal(emptyData(), 'bad'));
});
test('copyable restaurant text never includes private scores, comments, invite codes or image links', () => {
  const result = restaurantText(row('店名', { address: '和平区某路 18 号', invite_code: 'PRIVATE', comment: 'PRIVATE', avatar_url: 'PRIVATE', price_per_person: 123 }));
  assert.equal(result, '店名\n沈阳 · 火锅\n地址 / 分店：和平区某路 18 号'); assert.equal(result.includes('PRIVATE'), false);
});

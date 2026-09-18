import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from '../lib/model.js';
import { recordTasks } from '../lib/tasks.js';
import { draftExpired, DRAFT_TTL, validateDraftPayload } from '../lib/drafts.js';

test('task inbox separates people and counts records once, never zero price or wish dates as incomplete', () => {
  const data = { ...emptyData(), restaurants: [
    { id: 'a', status: 'eaten', visit_date: '2026-09-01', price_per_person: 0 },
    { id: 'b', status: 'eaten', visit_date: null, price_per_person: null },
    { id: 'w', status: 'wishlist', visit_date: null, price_per_person: 30 },
    { id: 'z', status: 'eaten', deleted_at: '2026-09-17' }
  ], reviews: [{ restaurant_id: 'a', user_id: 'local-partner', taste: 8, value: 8, vibe: 8 }, { restaurant_id: 'b', user_id: 'local-me', taste: 7, value: 7, vibe: 7 }], photos: [{ id: 'p', restaurant_id: 'b', url: null }] };
  data.restaurants.push(data.restaurants[0]);
  const report = recordTasks(data);
  assert.equal(report.rows.length, 2); assert.deepEqual(report.counts, { mine: 1, partner: 1, date: 1, price: 1, photos: 1 });
  assert.deepEqual(report.rows.find(r => r.restaurant.id === 'a').tasks, ['mine']);
  assert.equal(recordTasks({ ...data, space: { id: 's' }, members: [{ user_id: 'local-me' }] }).counts.partner, 0);
  assert.equal(recordTasks(data, 'local-partner').rows.find(r => r.restaurant.id === 'a').tasks.includes('mine'), false);
});
test('draft expiry handles exact seven-day boundary, invalid clock and missing dates', () => {
  const now = 1800000000000;
  assert.equal(draftExpired({ savedAt: now }, now), false); assert.equal(draftExpired({ savedAt: now - DRAFT_TTL + 1 }, now), false);
  assert.equal(draftExpired({ savedAt: now - DRAFT_TTL }, now), true); assert.equal(draftExpired({ savedAt: now + 61000 }, now), true);
  assert.equal(draftExpired({}, now), true); assert.equal(draftExpired(null, now), true);
});
test('drafts allow incomplete forms but validate photo type, sizes, count and text length', () => {
  const draft = { id: 'a', status: 'eaten', fields: { restaurantName: '', reviewText: '写到一半' }, removed: [], added: [{ file: new Blob(['jpeg'], { type: 'image/jpeg' }) }] };
  assert.equal(validateDraftPayload(draft), draft);
  assert.throws(() => validateDraftPayload({ ...draft, added: [{ file: new Blob(['svg'], { type: 'image/svg+xml' }) }] }), /限制/);
  assert.throws(() => validateDraftPayload({ ...draft, added: Array(9).fill(draft.added[0]) }), /限制/);
  assert.throws(() => validateDraftPayload({ ...draft, fields: { reviewText: 'a'.repeat(20001) } }), /文字过长/);
  assert.throws(() => validateDraftPayload({ ...draft, status: 'unknown' }), /不完整/);
});

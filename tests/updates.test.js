import test from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, workerVersion } from '../lib/updates.js';

test('release version comparison is numeric, bounded and never mistakes a downgrade for an update', () => {
  assert.equal(newerVersion('2.10.0', '2.9.9'), true); assert.equal(newerVersion('3.0.0', '2.99.99'), true);
  assert.equal(newerVersion('2.6.0', '2.6.0'), false); assert.equal(newerVersion('2.5.99', '2.6.0'), false);
  for (const value of [null, [], {}, '2.6', '2.6.1-beta', '999999.0.0', 'https://evil.invalid', '2.6.1\n']) assert.equal(newerVersion(value, '2.6.0'), false);
});
test('worker version messages validate replies and release channels on failure and timeout', async () => {
  assert.equal(await workerVersion({ postMessage: (_, ports) => ports[0].postMessage({ type: 'FOOD_MAP_VERSION', version: '2.6.1' }) }), '2.6.1');
  assert.equal(await workerVersion({ postMessage: (_, ports) => ports[0].postMessage({ type: 'OTHER', version: '2.6.1' }) }), null);
  assert.equal(await workerVersion({ postMessage: () => { throw new Error('terminated'); } }), null);
  assert.equal(await workerVersion({ postMessage: () => {} }, 20), null); assert.equal(await workerVersion(null), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { withDeadline, singleFlight, recoveryFetch, connectionSummary, connectionReport } from '../lib/connection.js';

test('deadline settles success and errors, and a timed-out wait never applies a late result', async () => {
  assert.equal(await withDeadline(Promise.resolve(7), 10), 7);
  await assert.rejects(withDeadline(Promise.reject(new Error('failed')), 10), /failed/);
  let resolve, applied = false;
  const source = new Promise(done => { resolve = done; });
  await assert.rejects(withDeadline(source, 5).then(() => { applied = true; }), { code: 'connection_timeout' });
  resolve(9); await Promise.resolve(); assert.equal(applied, false);
});
test('initialization is single flight, including after a UI deadline, and can retry a settled failure', async () => {
  const run = singleFlight(); let resolve, calls = 0;
  const start = () => { calls++; return new Promise(done => { resolve = done; }); };
  const a = run(start); await assert.rejects(withDeadline(a, 5));
  assert.equal(run(start), a); assert.equal(calls, 1); resolve('ready'); assert.equal(await a, 'ready');
  await assert.rejects(run(() => Promise.reject(new Error('failure'))));
  assert.equal(await run(() => 3), 3);
});
test('transport bounds reads and token renewal but does not time out or retry record writes', async () => {
  let calls = 0;
  const fetcher = recoveryFetch((input, options) => {
    calls++;
    if (!options.signal) return Promise.resolve(options);
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }, 5);
  await assert.rejects(fetcher('https://example.invalid/rest/v1/records'), {code:'connection_timeout'});
  await assert.rejects(fetcher('https://example.invalid/auth/v1/token?grant_type=refresh_token', { method: 'POST' }), {code:'connection_timeout'});
  const write = { method: 'POST', body: 'private-record' };
  assert.equal(await fetcher('https://example.invalid/rest/v1/rpc/save_food_record', write), write);
  assert.equal(calls, 3);
});
test('transport preserves caller cancellation and headers', async () => {
  const controller = new AbortController(); let received;
  const fetcher = recoveryFetch(async (_, options) => { received = options; return new Response('ok'); });
  controller.abort('caller'); await fetcher('https://example.invalid/read', { signal: controller.signal, headers: { test: 'value' } });
  assert.equal(received.signal.aborted, true); assert.equal(received.signal.reason, 'caller'); assert.equal(received.headers.test, 'value');
});
test('body deadline releases initialization even when a fetch implementation ignores cancellation', async () => {
  let signal, attempts = 0;
  const fetcher = recoveryFetch(async (_, options) => {
    signal = options.signal; attempts++;
    return attempts === 1 ? new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}})) : new Response('{"ok":true}');
  }, 15);
  const run = singleFlight();
  await assert.rejects(run(()=>fetcher('https://example.invalid/auth/v1/token',{method:'POST'})),{code:'connection_timeout'});
  assert.equal(signal.aborted,true);
  assert.deepEqual(await (await run(()=>fetcher('https://example.invalid/auth/v1/token',{method:'POST'}))).json(),{ok:true});
  assert.equal(attempts,2);
});
test('connection copy never labels an unread space as empty or a failed read as current', () => {
  const base = { mode: 'cloud', syncStatus: 'error', online: true, hasSpace: false, lastSyncAt: 0 };
  assert.match(connectionSummary(base).detail, /不是空空间/);
  assert.match(connectionSummary({ ...base, hasSpace: true, lastSyncAt: 1 }).detail, /可能不是最新/);
  assert.match(connectionSummary({ ...base, syncStatus: 'loading' }).title, /读取共同/);
  assert.match(connectionSummary({ ...base, syncStatus: 'ready', lastSyncAt: 1 }).title, /等待加入/);
  assert.match(connectionSummary({ ...base, mode: 'loading' }).title, /安全重试/);
});
test('diagnostic report allows only non-identifying fields', () => {
  const report = connectionReport({ version: '2.9.0', mode: 'cloud', syncStatus: 'ready', online: true, hasSpace: true, lastSyncAt: 1000,
    email: 'secret@example.com', error: 'Bearer SECRET', token: 'SECRET', invite: 'PRIVATE', url: 'https://private.invalid' });
  assert.match(report, /2.9.0/); assert.match(report, /1970-01-01T00:00:01.000Z/);
  assert.doesNotMatch(report, /secret@example|SECRET|PRIVATE|private.invalid/);
});

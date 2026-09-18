// Real authenticated integration checks. Credentials stay in memory and are never logged.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const project = 'ednkwzwxcowxboxmptvs', url = `https://${project}.supabase.co`;
const publishable = 'sb_publishable_gWqoh1ETeyGIxYMtNywdeg_mWQOOj3m';
const run = randomUUID(), marker = `codex-check-${run}`, resources = { run, users: [], spaces: [], pendingEmails: [] };
const output = execFileSync('cmd.exe', ['/d', '/s', '/c', `npx --yes supabase@latest projects api-keys --project-ref ${project} --reveal -o json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let parsed;
try { parsed = JSON.parse(output.slice(output.search(/[\[{]/))); } catch { throw new Error('Could not read authorized project key response'); }
const objects = [];
function walk(value) { if (!value || typeof value !== 'object') return; if (!Array.isArray(value)) objects.push(value); Object.values(value).forEach(walk); }
walk(parsed);
const credential = objects.find(x => x.name === 'service_role' && x.api_key)?.api_key || objects.find(x => typeof x.api_key === 'string' && x.api_key.startsWith('sb_secret_'))?.api_key;
if (!credential || credential.includes('***')) throw new Error('No usable server credential available');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, credential, options);
let browser, server;
const clients = [], sessions = [];
const resourceFile = `.private-audit/cloud-resources-${run}.json`;
await mkdir('.private-audit', { recursive: true });
const counts = async () => Object.fromEntries(await Promise.all(['spaces', 'space_members', 'food_places', 'restaurants', 'reviews', 'food_photos'].map(async name => {
  const { count, error } = await admin.from(name).select('id', { count: 'exact', head: true });
  // space_members has a composite primary key.
  if (error && name === 'space_members') { const r = await admin.from(name).select('user_id', { count: 'exact', head: true }); if (r.error) throw r.error; return [name, r.count]; }
  if (error) throw error; return [name, count];
})));
const before = await counts();
const check = (result, label) => { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
async function recordResources() { await writeFile(resourceFile, JSON.stringify(resources, null, 2)); }
async function objectsUnder(prefix, bucket = 'food-photos') {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
    if (!response.error || !/fetch|network|timeout/i.test(response.error.message)) break;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  const listed = check(response, 'list test storage');
  const paths = [];
  for (const item of listed) {
    const path = `${prefix}/${item.name}`;
    if (item.id) paths.push(path); else paths.push(...await objectsUnder(path, bucket));
  }
  return paths;
}
try {
  for (let i = 0; i < 3; i++) {
    const password = randomBytes(24).toString('base64url'), email = `food-map-check-${run}-${i}@example.invalid`;
    resources.pendingEmails.push(email); await recordResources();
    const { user } = check(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { purpose: marker } }), 'create isolated test account');
    resources.users.push(user.id); resources.pendingEmails = resources.pendingEmails.filter(value => value !== email); await recordResources();
    const c = createClient(url, publishable, options), signed = check(await c.auth.signInWithPassword({ email, password }), 'authenticate test account');
    clients.push(c); sessions.push(signed.session);
  }
  const [a, b, outsider] = clients;
  const space = check(await a.rpc('create_space', { p_name: marker, p_nickname: '小雨' }), 'create isolated space');
  resources.spaces.push({ id: space.id, name: marker }); await recordResources();
  check(await b.rpc('join_space_by_code', { p_code: space.invite_code, p_nickname: '小晴' }), 'join isolated space');
  assert.ok((await outsider.rpc('join_space_by_code', { p_code: space.invite_code })).error, 'third person must be rejected');
  assert.equal(check(await outsider.from('restaurants').select('id').eq('space_id', space.id), 'outsider read').length, 0);
  assert.ok((await b.from('space_members').update({ role: 'owner' }).eq('user_id', resources.users[1])).error, 'member role cannot be changed by client');
  console.log('PASS two-person membership and cross-space access checks');

  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', proxy: { server: 'http://127.0.0.1:7897', bypass: '127.0.0.1,localhost' } });
  const imagePage = await browser.newPage();
  const image = await imagePage.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e8c1a3'; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#fff9ec'; ctx.beginPath(); ctx.ellipse(600, 400, 420, 285, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d99a43'; ctx.beginPath(); ctx.ellipse(600, 400, 310, 195, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#689269'; for (let i = 0; i < 18; i++) ctx.fillRect(360 + i * 27, 315 + (i % 4) * 55, 26, 12);
    return canvas.toDataURL('image/jpeg', .82);
  });
  const jpeg = Buffer.from(image.split(',')[1], 'base64'); await imagePage.close();
  const avatarPath = `${space.id}/${resources.users[0]}/${randomUUID()}.jpg`;
  const avatarB = `${space.id}/${resources.users[1]}/${randomUUID()}.jpg`;
  check(await a.storage.from('food-avatars').upload(avatarPath, jpeg, { contentType: 'image/jpeg' }), 'stage private avatar');
  check(await b.storage.from('food-avatars').upload(avatarB, jpeg, { contentType: 'image/jpeg' }), 'stage partner avatar');
  assert.ok((await b.storage.from('food-avatars').upload(`${space.id}/${resources.users[0]}/${randomUUID()}.jpg`, jpeg, { contentType: 'image/jpeg' })).error, 'partner cannot upload into my avatar folder');
  assert.ok((await a.storage.from('food-avatars').upload(`${space.id}/${resources.users[0]}/${randomUUID()}.jpg`, Buffer.alloc(1048577), { contentType: 'image/jpeg' })).error, 'oversized avatar rejected');
  const profileArgs = { p_nickname: '小雨', p_avatar_path: avatarPath, p_expected_avatar_path: null, p_expected_nickname: '小雨' };
  check(await a.rpc('save_member_profile', profileArgs), 'save my avatar');
  check(await a.rpc('save_member_profile', profileArgs), 'idempotent avatar save');
  check(await b.rpc('save_member_profile', { p_nickname: '小晴', p_avatar_path: avatarB, p_expected_avatar_path: null, p_expected_nickname: '小晴' }), 'save partner avatar');
  assert.ok((await a.from('space_members').update({ avatar_path: avatarB }).eq('user_id', resources.users[0])).error, 'cannot bypass profile RPC');
  assert.ok((await a.rpc('save_member_profile', { ...profileArgs, p_avatar_path: avatarB, p_expected_avatar_path: avatarPath })).error, 'cannot use partner avatar path');
  assert.ok((await a.rpc('save_member_profile', { ...profileArgs, p_avatar_path: `${space.id}/${resources.users[0]}/${randomUUID()}.jpg`, p_expected_avatar_path: avatarPath })).error, 'cannot save missing avatar');
  assert.ok((await a.rpc('save_member_profile', { ...profileArgs, p_avatar_path: null })).error, 'stale profile editor cannot clear newer avatar');
  await b.storage.from('food-avatars').remove([avatarPath]); await a.storage.from('food-avatars').remove([avatarPath]);
  assert.equal((await fetch(check(await b.storage.from('food-avatars').createSignedUrl(avatarPath, 60), 'referenced avatar protected and shared').signedUrl)).status, 200);
  assert.ok((await outsider.storage.from('food-avatars').createSignedUrl(avatarPath, 60)).error, 'outsider cannot view avatar');
  assert.notEqual((await fetch(`${url}/storage/v1/object/public/food-avatars/${avatarPath}`)).status, 200, 'no public avatar endpoint');
  console.log('PASS private avatars, ownership, upload limit, protected deletion, stale editor and idempotent save');
  const id = randomUUID(), path = `${space.id}/${id}/${resources.users[0]}/${randomUUID()}.jpg`;
  check(await a.storage.from('food-photos').upload(path, jpeg, { contentType: 'image/jpeg' }), 'stage photo before restaurant');
  const restaurant = { id, space_id: space.id, name: '周末小馆 · 测试', city: '沈阳', category: '东北菜', address: '测试地址', visit_date: '2026-09-16', price_per_person: 68.5, tags: ['约会', '分量足'], status: 'eaten' };
  const aReview = { taste: 9, value: 8, vibe: 7, service: null, look: null, comment: '味道很好，下次还想来。', favorite_dish: '锅包肉', favorite: true, would_return: true };
  const args = { p_restaurant: restaurant, p_review: aReview, p_photo_paths: [path] };
  let result = check(await a.rpc('save_food_record', args), 'save atomic record');
  assert.equal(result.restaurant.place_id, id, 'old clients receive a stable place identity');
  assert.equal(check(await outsider.from('food_places').select('id').eq('space_id', space.id), 'private place identities').length, 0);
  const originalVersion = result.restaurant.updated_at;
  check(await a.rpc('save_food_record', args), 'retry same save');
  assert.equal(check(await a.from('restaurants').select('id').eq('id', id), 'count restaurants').length, 1);
  assert.equal(check(await a.from('food_photos').select('id').eq('restaurant_id', id), 'count photos').length, 1);
  check(await b.rpc('save_food_record', { p_restaurant: restaurant, p_review: { ...aReview, taste: 8, value: 9, vibe: 8, favorite_dish: '鸡架' }, p_expected_updated_at: originalVersion }), 'independent partner review');
  const reviews = check(await a.from('reviews').select('*').eq('restaurant_id', id), 'read both reviews');
  assert.equal(reviews.length, 2); assert.equal(reviews.find(r => r.user_id === resources.users[0]).taste, 9);
  const signed = check(await b.storage.from('food-photos').createSignedUrl(path, 120), 'partner photo visibility');
  assert.equal((await fetch(signed.signedUrl)).status, 200);
  assert.ok((await outsider.storage.from('food-photos').createSignedUrl(path, 120)).error, 'outsider cannot sign private photo');
  await b.storage.from('food-photos').remove([path]);
  assert.ok(check(await a.storage.from('food-photos').createSignedUrl(path, 120), 'photo survives partner deletion attempt').signedUrl);
  console.log('PASS staged JPEG upload, private photo sharing, save retry, independent reviews');

  const badId = randomUUID();
  const bad = await a.rpc('save_food_record', { p_restaurant: { ...restaurant, id: badId }, p_photo_paths: [`${space.id}/${badId}/${resources.users[0]}/missing.jpg`] });
  assert.ok(bad.error); assert.equal(check(await a.from('restaurants').select('id').eq('id', badId), 'rollback check').length, 0);
  assert.equal(check(await a.from('food_places').select('id').eq('id', badId), 'place creation rollback').length, 0);
  result = check(await b.rpc('save_food_record', { p_restaurant: { ...restaurant, address: '另一半更新的地址' }, p_expected_updated_at: originalVersion }), 'concurrent edit first writer');
  const stale = await a.rpc('save_food_record', { p_restaurant: { ...restaurant, name: '过期的编辑' }, p_expected_updated_at: originalVersion });
  assert.ok(stale.error?.message.includes('修改'));
  assert.equal(check(await a.from('restaurants').select('name,address').eq('id', id).single(), 'conflict leaves row unchanged').address, '另一半更新的地址');
  const missingPath = `${space.id}/${id}/${resources.users[0]}/${randomUUID()}.jpg`;
  check(await admin.from('food_photos').insert({ restaurant_id: id, space_id: space.id, user_id: resources.users[0], path: missingPath }), 'isolated missing photo fixture');
  console.log('PASS atomic rollback and stale-write protection');

  try { await fetch('http://127.0.0.1:4173'); } catch {
    server = spawn(process.execPath, ['tools/serve.mjs'], { windowsHide: true, stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { await fetch('http://127.0.0.1:4173'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  }
  const contextA = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  const contextB = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  for (const [i, context] of [contextA, contextB].entries()) await context.addInitScript(({ key, session }) => { if (!localStorage.getItem('test-auth-seeded')) { localStorage.setItem(key, JSON.stringify(session)); localStorage.setItem('test-auth-seeded', 'yes'); } }, { key: `sb-${project}-auth-token`, session: sessions[i] });
  const pageA = await contextA.newPage(), pageB = await contextB.newPage(), browserErrors = [];
  const realtimeEvents = { changes: 0, ready: 0, errors: 0 };
  for (const page of [pageA, pageB]) {
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('websocket', socket => socket.on('framereceived', frame => {
      try { const message = JSON.parse(String(frame.payload)), event = message.event || message[3], payload = message.payload || message[4];
        if (event === 'postgres_changes') realtimeEvents.changes++;
        if (event === 'system' && payload?.status === 'ok') realtimeEvents.ready++;
        if (event === 'system' && payload?.status === 'error') realtimeEvents.errors++;
      } catch { /* No credentials or payloads are logged. */ }
    }));
  }
  await Promise.all([pageA.goto('http://127.0.0.1:4173'), pageB.goto('http://127.0.0.1:4173')]);
  await expect(pageA.locator('#helloLine')).toContainText('已同步', { timeout: 30000 });
  await expect(pageB.locator('#helloLine')).toContainText('已同步', { timeout: 30000 });
  await expect(pageA.locator('#heroMembers')).toContainText('两人已加入');
  await expect.poll(() => pageA.locator('#homeCards img').first().evaluate(img => img.naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
  await expect.poll(() => pageA.locator('#faceMe img').evaluate(img => img.naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
  await expect.poll(() => pageB.locator('#facePartner img').evaluate(img => img.naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
  await pageA.evaluate(async () => {
    const photo = document.querySelector('#homeCards img'); await photo.decode();
    // naturalWidth alone can become nonzero before the initial load event is dispatched.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.stablePhoto = photo; window.photoLoads = 0; window.photoTrace = [];
    const initialSource = photo.src;
    photo.addEventListener('load', () => { window.photoLoads++; window.photoTrace.push({ event: 'load', sourceChanged: photo.src !== initialSource, connected: photo.isConnected }); });
    new MutationObserver(records => { for (const r of records) window.photoTrace.push({ event: 'attribute', name: r.attributeName, sourceChanged: photo.src !== initialSource }); }).observe(photo, { attributes: true });
  });
  await pageA.locator('#faceMe').click();
  await pageA.locator('#avatarInput').setInputFiles({ name: 'portrait.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(pageA.locator('#avatarMessage')).toContainText('预览已就绪');
  await pageA.locator('#avatarZoom').fill('1.5');
  let failAvatarUpload = true;
  await pageA.route('**/storage/v1/object/food-avatars/**', async route => { if (failAvatarUpload && route.request().method() === 'POST') { failAvatarUpload = false; return route.abort('failed'); } return route.continue(); });
  await pageA.locator('#saveNickname').click(); await expect(pageA.locator('#avatarMessage')).toContainText('本次修改仍保留', { timeout: 30000 });
  assert.equal(check(await a.from('space_members').select('avatar_path').eq('user_id', resources.users[0]).single(), 'failed upload keeps old avatar').avatar_path, avatarPath);
  await pageA.unroute('**/storage/v1/object/food-avatars/**');
  // Response loss after commit is retried with the same file/path, without deleting the new avatar.
  let loseProfileResponse = true;
  await pageA.route('**/rest/v1/rpc/save_member_profile', async route => { if (loseProfileResponse) { loseProfileResponse = false; await route.fetch(); return route.abort('failed'); } return route.continue(); });
  await pageA.locator('#saveNickname').click(); await expect(pageA.locator('#avatarMessage')).toContainText('本次修改仍保留', { timeout: 30000 });
  await pageA.locator('#saveNickname').click(); await expect(pageA.locator('#identitySheet')).not.toHaveClass(/open/, { timeout: 30000 });
  await pageA.unroute('**/rest/v1/rpc/save_member_profile');
  const currentAvatar = check(await a.from('space_members').select('avatar_path').eq('user_id', resources.users[0]).single(), 'replacement avatar path').avatar_path;
  assert.notEqual(currentAvatar, avatarPath);
  await expect(pageB.locator('#facePartner img')).toHaveAttribute('src', new RegExp(currentAvatar.replace(/[.]/g, '\\.')), { timeout: 30000 });
  await expect.poll(() => pageB.locator('#facePartner img').evaluate(img => img.naturalWidth), { timeout: 15000 }).toBe(512);
  await expect.poll(async () => !!(await a.storage.from('food-avatars').createSignedUrl(avatarPath, 60)).error, { timeout: 20000 }).toBe(true);
  assert.equal(await pageA.evaluate(() => window.stablePhoto === document.querySelector('#homeCards img')), true);
  assert.equal(await pageA.evaluate(() => window.photoLoads), 0, JSON.stringify(await pageA.evaluate(() => window.photoTrace)));
  // Several background refresh triggers must neither replace nor re-download an unchanged photo.
  for (let i = 0; i < 3; i++) { await pageA.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pageA.waitForTimeout(1200); }
  assert.equal(await pageA.evaluate(() => window.stablePhoto === document.querySelector('#homeCards img')), true); assert.equal(await pageA.evaluate(() => window.photoLoads), 0);
  await pageA.locator('[data-nav="profile"]').click(); await pageA.screenshot({ path: '.private-audit/mobile-profile-v2.3.png' });
  await pageA.locator('[data-open="identity"].setting-row').click(); await pageA.screenshot({ path: '.private-audit/mobile-avatar-v2.3.png' }); await pageA.locator('[data-close="identitySheet"]').click();
  await pageA.locator('[data-nav="home"]').click();
  console.log('PASS avatar upload failure/retry, committed-response loss, partner live update, old-file cleanup and stable decoded photos through background sync');
  await pageA.screenshot({ path: '.private-audit/mobile-home.png' });
  await pageA.locator('#homeCards .food-content').click(); await expect(pageA.locator('#detailBody .person-card')).toHaveCount(2);
  await expect(pageA.locator('#detailBody .photo-wall .photo-placeholder').last()).toBeVisible();
  await pageA.screenshot({ path: '.private-audit/mobile-detail.png' }); await pageA.locator('[data-close="detailSheet"]').click();
  await pageA.locator('[data-nav="profile"]').click(); await pageA.locator('.setting-row[data-open="couple"]').click(); await expect(pageA.locator('#memberList .member')).toHaveCount(2);
  await pageA.screenshot({ path: '.private-audit/mobile-members.png' }); await pageA.locator('[data-close="coupleSheet"]').click(); await pageA.locator('[data-nav="home"]').click();

  await pageB.locator('#mainAdd').click(); await pageB.locator('#restaurantName').fill('双人同步甜品店'); await pageB.locator('#price').fill('32.50'); await pageB.locator('#category').fill('我们的周末甜品'); await pageB.locator('#visitDate').fill('2026-08-01');
  for (const [key, value] of [['taste', 9], ['value', 8], ['vibe', 7]]) await pageB.locator(`[data-rate="${key}"]`).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await pageB.locator('#photoInput').setInputFiles({ name: 'cloud-photo.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(pageB.locator('#photoStatus')).toContainText('已就绪');
  await pageB.route('**/rest/v1/rpc/save_food_record', route => route.abort());
  await pageB.locator('#saveRecordBtn').click(); await expect(pageB.locator('#saveMessage')).toBeVisible({ timeout: 30000 }); await expect(pageB.locator('#restaurantName')).toHaveValue('双人同步甜品店');
  assert.equal(check(await b.from('restaurants').select('id').eq('space_id', space.id).eq('name', '双人同步甜品店'), 'failed UI save has no partial record').length, 0);
  await pageB.unroute('**/rest/v1/rpc/save_food_record'); await pageB.locator('#saveRecordBtn').click(); await expect(pageB.locator('#editSheet')).not.toHaveClass(/open/, { timeout: 30000 });
  await expect(pageA.locator('#homeCards')).toContainText('双人同步甜品店', { timeout: 30000 });
  const dessert = pageA.locator('#homeCards .food-card').filter({ hasText: '双人同步甜品店' }); await expect(dessert.locator('img')).toBeVisible(); await expect.poll(() => dessert.locator('img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await pageA.locator('[data-nav="records"]').click(); await pageA.locator('#recordSort').selectOption('value'); await pageA.screenshot({ path: '.private-audit/mobile-records.png' });
  await pageA.locator('[data-nav="rank"]').click(); await expect(pageA.locator('#rankList .food-card')).toHaveCount(1); await expect(pageA.locator('#rankList .metric.value')).toContainText('8.5'); await pageA.screenshot({ path: '.private-audit/mobile-rank.png' });
  await expect(pageA.locator('#homeCards .food-title').first()).toHaveText('双人同步甜品店'); await expect(dessert.locator('.food-meta')).toContainText('我们的周末甜品');
  await pageA.setViewportSize({ width: 320, height: 640 }); assert.ok(await pageA.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)); await pageA.screenshot({ path: '.private-audit/mobile-small.png' });
  // Replace my uploaded file while retaining the partner's file on the same record.
  const bPath = `${space.id}/${id}/${resources.users[1]}/${randomUUID()}.jpg`;
  check(await b.storage.from('food-photos').upload(bPath, jpeg, { contentType: 'image/jpeg' }), 'stage partner photo');
  const currentRecord = check(await b.from('restaurants').select('*').eq('id', id).single(), 'read current restaurant');
  check(await b.rpc('save_food_record', { p_restaurant: currentRecord, p_photo_paths: [bPath], p_expected_updated_at: currentRecord.updated_at }), 'attach partner photo');
  await pageA.setViewportSize({ width: 393, height: 851 }); await pageA.locator('#refreshBtn').click();
  await expect(pageA.locator('#refreshBtn')).toHaveText('↻', { timeout: 20000 });
  await pageA.locator('[data-nav="home"]').click(); await pageA.locator('#homeCards .food-card').filter({ hasText: '周末小馆' }).locator('.food-content').click(); await pageA.locator('[data-edit]').click();
  await expect(pageA.locator('#photoPreviews .photo-owner').filter({ hasText: 'TA 的照片' })).toHaveCount(1);
  const oldPhotoId = check(await a.from('food_photos').select('id').eq('path', path).single(), 'find old photo').id;
  // The other member keeps the old image open while its owner replaces it.
  await pageB.locator('#homeCards .food-card').filter({ hasText: '周末小馆' }).locator('.food-content').click();
  await pageB.locator(`#detailBody .photo-wall [data-photo="${oldPhotoId}"]`).click(); await expect(pageB.locator('#photoViewer')).toBeVisible();
  await expect(pageB.locator('#viewerImage')).toHaveAttribute('src', new RegExp(path.replace(/[.]/g, '\\.')));
  await pageA.locator(`[data-remove-existing="${oldPhotoId}"]`).click();
  await pageA.locator('#photoInput').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: jpeg }); await expect(pageA.locator('#photoStatus')).toContainText('已就绪');
  await pageA.locator('#saveRecordBtn').click(); await expect(pageA.locator('#editSheet')).not.toHaveClass(/open/, { timeout: 30000 });
  assert.equal(check(await a.from('food_photos').select('id').eq('path', path), 'removed photo metadata').length, 0);
  assert.equal(check(await a.from('food_photos').select('id').eq('path', bPath), 'partner photo retained').length, 1);
  await expect.poll(async () => Boolean((await a.storage.from('food-photos').createSignedUrl(path, 60)).error), { timeout: 15000 }).toBe(true);
  await expect(pageB.locator(`#detailBody [data-photo="${oldPhotoId}"]`)).toHaveCount(0, { timeout: 30000 });
  assert.ok(!(await pageB.locator('#viewerImage').getAttribute('src') || '').includes(path), 'open viewer must stop displaying removed photo');
  await pageB.locator('#closePhotoViewer').click(); await pageB.locator('[data-close="detailSheet"]').click();
  console.log('PASS cloud photo replacement, ownership, storage cleanup and partner open-gallery refresh');
  // Both members can archive/restore, but neither can accidentally edit a deleted post.
  const currentBeforeTrash = check(await a.from('restaurants').select('*').eq('id', id).single(), 'read version before trash');
  const photosBeforeTrash = check(await a.from('food_photos').select('id,path').eq('restaurant_id', id).order('id'), 'capture photos before trash');
  assert.ok((await a.rpc('set_food_record_deleted', { p_id: id, p_deleted: true, p_expected_updated_at: originalVersion })).error?.message.includes('修改'), 'stale deletion must not apply');
  assert.ok((await outsider.rpc('set_food_record_deleted', { p_id: id, p_deleted: true, p_expected_updated_at: currentBeforeTrash.updated_at })).error, 'outsider cannot delete');
  await pageB.locator('#refreshBtn').click(); await expect(pageB.locator('#refreshBtn')).toHaveText('↻', { timeout: 20000 });
  await pageB.locator('#homeCards [data-detail]').filter({ hasText: '周末小馆' }).click(); await pageB.locator('[data-edit]').click(); await pageB.locator('#reviewText').fill('另一半正在写的草稿');
  await pageA.locator('#homeCards .food-card').filter({ hasText: '周末小馆' }).locator('.food-content').click();
  await pageA.route('**/rest/v1/rpc/set_food_record_deleted', route => route.abort());
  pageA.once('dialog', dialog => dialog.accept()); await pageA.locator(`[data-delete="${id}"]`).click(); await expect(pageA.locator('#toast')).toContainText('网络连接失败'); await expect(pageA.locator('#detailSheet')).toHaveClass(/open/);
  await pageA.unroute('**/rest/v1/rpc/set_food_record_deleted');
  pageA.once('dialog', dialog => dialog.accept()); await pageA.locator(`[data-delete="${id}"]`).click(); await expect(pageA.locator('#detailSheet')).not.toHaveClass(/open/, { timeout: 30000 });
  await expect(pageB.locator('#saveMessage')).toContainText('已被移到回收站', { timeout: 30000 }); await expect(pageB.locator('#reviewText')).toHaveValue('另一半正在写的草稿');
  await pageB.locator('#saveRecordBtn').click(); await expect(pageB.locator('#saveMessage')).toContainText('记录已删除');
  assert.ok((await b.rpc('save_food_record', { p_restaurant: currentBeforeTrash })).error?.message.includes('记录已删除'), 'even a no-op stale save cannot succeed');
  assert.ok((await b.from('reviews').update({ taste: 2 }).eq('restaurant_id', id).eq('user_id', resources.users[1])).error?.message.includes('记录已删除'), 'old direct review update rejected');
  assert.ok((await b.from('restaurants').update({ name: '旧页面不应写入' }).eq('id', id)).error?.message.includes('记录已删除'), 'old direct restaurant update rejected');
  const archived = check(await a.rpc('set_food_record_deleted', { p_id: id, p_deleted: true, p_expected_updated_at: currentBeforeTrash.updated_at }), 'idempotent delete retry');
  assert.ok(archived.deleted_at); assert.equal(archived.created_at, currentBeforeTrash.created_at);
  assert.deepEqual(check(await a.from('food_photos').select('id,path').eq('restaurant_id', id).order('id'), 'archived photos retained'), photosBeforeTrash);
  await pageA.locator('[data-nav="rank"]').click(); await expect(pageA.locator('#rankList .food-card')).toHaveCount(0);
  pageB.once('dialog', dialog => dialog.accept()); await pageB.locator('[data-close="editSheet"]').click(); await pageB.locator('[data-nav="profile"]').click(); await pageB.locator('[data-open="trash"]').click(); await expect(pageB.locator('#trashList .trash-record')).toHaveCount(1);
  await pageB.screenshot({ path: '.private-audit/mobile-trash.png' }); await pageB.locator(`[data-restore="${id}"]`).click(); await expect(pageB.locator('#trashList .trash-record')).toHaveCount(0, { timeout: 30000 });
  await expect(pageA.locator('#rankList .food-card')).toHaveCount(1, { timeout: 30000 }); await expect(pageA.locator('#rankList .metric.value')).toContainText('8.5');
  const restored = check(await b.rpc('set_food_record_deleted', { p_id: id, p_deleted: false, p_expected_updated_at: archived.updated_at }), 'idempotent restore retry');
  assert.equal(restored.deleted_at, null); assert.equal(restored.created_at, currentBeforeTrash.created_at);
  assert.equal(check(await a.from('reviews').select('id').eq('restaurant_id', id), 'restored review count').length, 2);
  assert.deepEqual(check(await a.from('food_photos').select('id,path').eq('restaurant_id', id).order('id'), 'restored photos retained'), photosBeforeTrash);
  assert.equal((await fetch(check(await b.storage.from('food-photos').createSignedUrl(bPath, 60), 'restored photo readable').signedUrl)).status, 200);
  await expect(pageA.locator('#homeCards .food-title').first()).toHaveText('双人同步甜品店');
  console.log('PASS cloud delete failure/retry, partner realtime removal/restore, stale edit protection, trash permissions, intact photos/reviews and ranking order');
  await pageA.locator('#rankList .food-content').click(); await pageA.locator('#detailBody [data-repeat]').click(); await expect(pageA.locator('#recordPlace')).toHaveValue(id); await expect(pageA.locator('#overallScore')).toHaveText('未评'); await expect(pageA.locator('#photoPreviews .preview')).toHaveCount(0);
  await pageA.locator('#visitDate').fill('2026-09-18'); await pageA.locator('#price').fill('99');
  for (const key of ['taste', 'value', 'vibe']) await pageA.locator(`[data-rate="${key}"]`).evaluate(el => { el.value = 4; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pageA.locator('#photoInput').setInputFiles({ name: 'revisit.jpg', mimeType: 'image/jpeg', buffer: jpeg }); await expect(pageA.locator('#photoStatus')).toContainText('已就绪'); await pageA.locator('#saveRecordBtn').click(); await expect(pageA.locator('#editSheet')).not.toHaveClass(/open/, { timeout: 30000 });
  const revisited = check(await a.from('restaurants').select('*').eq('space_id', space.id).eq('place_id', id).neq('id', id).single(), 'second visit linked to same place');
  assert.equal(check(await a.from('food_places').select('id').eq('space_id', space.id), 'count distinct places').length, 2);
  await expect(pageA.locator('#rankList .food-card')).toHaveCount(1); await expect(pageA.locator('#rankList .metric.value')).toContainText('8.5');
  await pageA.locator('[data-nav="records"]').click(); await pageA.locator('#recordSort').selectOption('visit'); await expect(pageA.locator('#recordList .food-card')).toHaveCount(2); await expect(pageA.locator('#resultsCount')).toHaveText('2 家店 · 3 条记录');
  await expect(pageA.locator('#recordList .food-card').first()).toHaveAttribute('data-record', revisited.id); await expect.poll(() => pageA.locator(`#recordList [data-record="${revisited.id}"] .food-photo img`).evaluate(img => img.naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
  await pageA.locator(`#recordList [data-place="${id}"] summary`).click(); await expect(pageA.locator(`#recordList [data-place="${id}"] .visit-row`)).toHaveCount(2); await pageA.locator('#recordList .visit-row').last().scrollIntoViewIfNeeded(); await pageA.screenshot({ path: '.private-audit/mobile-visits.png' });
  await pageA.locator(`#recordList [data-record="${revisited.id}"] .food-content`).click(); await pageA.locator('#detailBody .place-insights summary').click();
  await expect(pageA.locator('#detailBody .place-insights')).toContainText('还需要两次');
  await pageB.locator('[data-close="trashSheet"]').click(); await pageB.locator('[data-nav="home"]').click(); await expect(pageB.locator(`#homeCards [data-record="${revisited.id}"]`)).toHaveCount(1, { timeout: 30000 });
  await pageB.locator(`#homeCards [data-record="${revisited.id}"] .food-content`).click(); await pageB.locator('#detailBody [data-edit]').click(); await expect(pageB.locator('#overallScore')).toHaveText('未评');
  for (const key of ['taste', 'value', 'vibe']) await pageB.locator(`[data-rate="${key}"]`).evaluate(el => { el.value = 6; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pageB.locator('#saveRecordBtn').click(); await expect(pageB.locator('#editSheet')).not.toHaveClass(/open/, { timeout: 30000 });
  await expect(pageA.locator('#rankList .food-card')).toHaveAttribute('data-record', revisited.id, { timeout: 30000 }); await expect(pageA.locator('#rankList .metric.value')).toContainText('5.0');
  await expect(pageA.locator('#detailBody .place-insights')).toHaveAttribute('open', '');
  await expect(pageA.locator('#detailBody [data-dimension="value"]')).toContainText('下降 3.5', { timeout: 30000 }); await expect(pageA.locator('#detailBody .insights-dishes')).toContainText('锅包肉');
  await pageA.locator('[data-close="detailSheet"]').click(); console.log('PASS open revisit recap updates from partner review, uses latest joint dimensions, keeps private dish phrases and existing ranking rule');
  assert.deepEqual(check(await a.from('food_photos').select('id,path').eq('restaurant_id', id).order('id'), 'prior visit photos remain independent'), photosBeforeTrash);
  assert.equal(check(await a.from('reviews').select('taste').eq('restaurant_id', id).eq('user_id', resources.users[0]).single(), 'prior visit rating unchanged').taste, 9);
  // Moving a visit does not merge reviews or affect the other visits. A stale move is rejected.
  const detachedPlace = randomUUID();
  const detached = check(await a.rpc('save_food_record', { p_restaurant: { ...revisited, place_id: detachedPlace, create_place: true }, p_expected_updated_at: revisited.updated_at }), 'detach visit into separate place').restaurant;
  assert.ok((await b.rpc('save_food_record', { p_restaurant: { ...revisited, address: 'stale move' }, p_expected_updated_at: revisited.updated_at })).error?.message.includes('修改'));
  check(await a.rpc('save_food_record', { p_restaurant: { ...detached, place_id: id }, p_expected_updated_at: detached.updated_at }), 'relink existing visit');
  assert.equal(check(await a.from('reviews').select('id').eq('restaurant_id', revisited.id), 'review count after relink').length, 2);
  assert.ok((await outsider.from('restaurants').insert({ ...restaurant, id: randomUUID(), place_id: id, created_by: resources.users[2] })).error, 'cross-space visit insertion denied');
  assert.ok((await a.rpc('save_food_record', { p_restaurant: { ...restaurant, id: randomUUID(), place_id: randomUUID() } })).error, 'nonexistent place link denied');
  const otherSpace = check(await outsider.rpc('create_space', { p_name: marker, p_nickname: '隔离账号' }), 'second isolated space'); resources.spaces.push({ id: otherSpace.id, name: marker }); await recordResources();
  assert.ok((await outsider.rpc('save_food_record', { p_restaurant: { ...restaurant, id: randomUUID(), space_id: otherSpace.id, place_id: id } })).error, 'member of another space cannot attach its visit to private place');
  const lastVisit = check(await a.from('restaurants').select('*').eq('id', revisited.id).single(), 'current revisit');
  await pageA.locator(`#recordList [data-record="${revisited.id}"] .food-photo [data-photo]`).click(); await expect(pageA.locator('#photoViewer')).toBeVisible();
  const deletedVisit = check(await a.rpc('set_food_record_deleted', { p_id: revisited.id, p_deleted: true, p_expected_updated_at: lastVisit.updated_at }), 'delete only revisit');
  await expect(pageA.locator('#photoViewer')).toBeHidden({ timeout: 30000 }); await expect(pageA.locator('#viewerImage')).not.toHaveAttribute('src'); await expect(pageA.locator('#viewerCaption')).toBeEmpty();
  await expect(pageA.locator('#rankList .food-card')).toHaveAttribute('data-record', id, { timeout: 30000 });
  check(await a.rpc('set_food_record_deleted', { p_id: revisited.id, p_deleted: false, p_expected_updated_at: deletedVisit.updated_at }), 'restore same place revisit');
  await expect(pageA.locator('#rankList .food-card')).toHaveAttribute('data-record', revisited.id, { timeout: 30000 });
  console.log('PASS same-place revisits, chronological grouped history, independent photos/reviews, single-slot latest joint ranking, relink/detach, stale move protection and restore');
  console.log(`Realtime diagnostic counts: ${JSON.stringify(realtimeEvents)}`);
  const silentContext = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  await silentContext.routeWebSocket('**/realtime/v1/**', socket => socket.onMessage(() => {}));
  await silentContext.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${project}-auth-token`, session: sessions[0] });
  const silentPage = await silentContext.newPage(); await silentPage.goto('http://127.0.0.1:4173'); await expect(silentPage.locator('#helloLine')).toContainText('已同步', { timeout: 30000 });
  check(await b.from('space_members').update({ nickname: '小晴自动同步检查' }).eq('user_id', resources.users[1]).eq('space_id', space.id), 'change synthetic nickname while websocket is silent');
  await expect(silentPage.locator('#heroMembers')).toContainText('小晴自动同步检查', { timeout: 30000 }); await silentContext.close();
  console.log('PASS automatic refetch fallback with all Realtime WebSocket messages suppressed');
  // New read-only discovery views use the same private snapshot and update while open.
  await pageA.locator('[data-nav="home"]').click(); await pageA.locator('.journal-home').click(); await pageA.locator('#journalMonth').fill('2026-09'); await pageA.locator('#journalMonth').dispatchEvent('change');
  await expect(pageA.locator('#journalStats b').nth(0)).toHaveText('2'); await expect(pageA.locator('#journalStats b').nth(1)).toHaveText('1');
  const reportVisit = check(await b.from('restaurants').select('*').eq('id', revisited.id).single(), 'read temporary visit before report change');
  check(await b.rpc('save_food_record', { p_restaurant: { ...reportVisit, visit_date: '2026-08-18' }, p_expected_updated_at: reportVisit.updated_at }), 'move only temporary visit to prior month');
  await expect(pageA.locator('#journalStats b').nth(0)).toHaveText('1', { timeout: 30000 }); await expect(pageA.locator('#journalMeals .food-card')).toHaveCount(1);
  await pageA.locator('[data-close="journalSheet"]').click(); await pageA.locator('[data-quick="random"]').click(); await pageA.locator('#decisionSource').selectOption('all');
  await expect(pageA.locator('#decisionCount')).toContainText('2 家'); await pageA.locator('#drawDinner').click(); await expect(pageA.locator('#decisionResult [data-detail]')).toBeVisible();
  await pageA.locator('[data-close="decisionSheet"]').click(); await pageA.locator('[data-nav="records"]').click(); await pageA.locator('#advancedFilters summary').click(); await pageA.locator('#filterCity').selectOption('沈阳'); await pageA.locator('#filterPhotos').check();
  await expect(pageA.locator('#recordList .food-card')).toHaveCount(1); await pageA.locator('#recordList .food-content').click(); await pageA.locator('#detailBody [data-copy-place]').click();
  await expect(pageA.locator('#placeCopyText')).toHaveValue(/周末小馆/); assert.ok(!(await pageA.locator('#placeCopyText').inputValue()).includes(space.invite_code));
  await pageA.locator('[data-close="placeCopySheet"]').click(); await pageA.locator('[data-close="detailSheet"]').click();
  console.log('PASS private monthly report live changes, per-place dinner choices, city/photo filters and sanitized restaurant copy');
  await pageA.locator('[data-nav="home"]').click(); await pageA.locator('.task-home').click(); await pageA.locator('[data-task-filter="partner"]').click();
  await expect(pageA.locator('#taskList [data-task-edit]')).toHaveCount(0); await expect(pageA.locator('#taskSummary')).toContainText('不向对方发送消息'); await pageA.locator('[data-close="tasksSheet"]').click();
  const storageBeforeDraft = (await objectsUnder(space.id)).length;
  await pageA.locator('#mainAdd').click(); await pageA.locator('#restaurantName').fill('只在本机的云端草稿'); await pageA.locator('#reviewText').fill('未发表的草稿文字'); await pageA.locator('#photoInput').setInputFiles({ name: 'draft.jpg', mimeType: 'image/jpeg', buffer: jpeg }); await expect(pageA.locator('#photoStatus')).toContainText('已就绪');
  await pageA.locator('#stashDraft').click(); await expect(pageA.locator('#draftBanner')).toBeVisible(); await expect(pageA.locator('#editSheet')).not.toHaveClass(/open/);
  assert.equal(check(await a.from('restaurants').select('id').eq('space_id', space.id).eq('name', '只在本机的云端草稿'), 'draft must not create a cloud visit').length, 0);
  assert.equal((await objectsUnder(space.id)).length, storageBeforeDraft, 'stashing must not upload a photo'); await expect(pageB.locator('#draftBanner')).toBeHidden();
  await pageA.reload(); await expect(pageA.locator('#helloLine')).toContainText('已同步', { timeout: 30000 }); await expect(pageA.locator('#draftBanner')).toBeVisible(); await pageA.locator('#resumeDraft').click(); await expect(pageA.locator('#reviewText')).toHaveValue('未发表的草稿文字');
  await expect.poll(() => pageA.locator('#photoPreviews img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0); await pageA.locator('#saveRecordBtn').click(); await expect(pageA.locator('#editSheet')).not.toHaveClass(/open/, { timeout: 30000 }); await expect(pageA.locator('#draftBanner')).toBeHidden();
  await expect(pageB.locator('#homeCards')).toContainText('只在本机的云端草稿', { timeout: 30000 });
  await pageA.locator('#mainAdd').click(); await pageA.locator('#restaurantName').fill('退出时应清除的草稿'); await pageA.locator('#stashDraft').click(); await expect(pageA.locator('#draftBanner')).toBeVisible();
  console.log('PASS cloud-account draft stays device-local with photo, reload/resume and explicit publish sync to partner, task inbox preserves reviewer ownership');
  await pageA.locator('[data-nav="profile"]').click(); await pageA.locator('[data-open="cloud"]').click(); await pageA.locator('#logoutBtn').click(); await expect(pageA.locator('#helloLine')).toContainText('本机档案', { timeout: 20000 });
  await expect(pageA.locator('#homeCards .food-card')).toHaveCount(0); assert.deepEqual(browserErrors, []);
  for (const selector of ['#journalMeals', '#journalPhotos', '#journalStats', '#decisionResult', '#decisionCount', '#journalPriceNote']) await expect(pageA.locator(selector)).toBeEmpty();
  await expect(pageA.locator('#filterCity option')).toHaveCount(1); await expect(pageA.locator('#decisionCity option')).toHaveCount(1); await expect(pageA.locator('#placeCopyText')).toHaveValue('');
  await expect(pageA.locator('#draftBanner')).toBeHidden(); await expect(pageA.locator('#taskList')).toBeEmpty(); await expect(pageA.locator('#taskTabs')).toBeEmpty(); await expect(pageA.locator('#taskSummary')).toBeEmpty();
  for (const selector of ['#detailBody', '#memberList', '#currentInviteCode', '#avatarPreview', '#photoPreviews', '#recordPlace']) await expect(pageA.locator(selector)).toBeEmpty();
  await expect(pageA.locator('#restaurantName')).toHaveValue(''); await expect(pageA.locator('#reviewText')).toHaveValue(''); await expect(pageA.locator('#nicknameInput')).toHaveValue('');
  assert.equal(await pageA.evaluate(async scope => (await import('/lib/drafts.js?v=2.7.0')).loadDraft(scope), `cloud:${resources.users[0]}:${space.id}`), null, 'logout removes that account draft from IndexedDB');
  await expect(pageA.locator('#faceMe img')).toHaveCount(0); await expect(pageA.locator('#facePartner img')).toHaveCount(0);
  check(await b.rpc('save_member_profile', { p_nickname: '小晴自动同步检查', p_avatar_path: null, p_expected_avatar_path: avatarB, p_expected_nickname: '小晴自动同步检查' }), 'reset partner avatar');
  await expect(pageB.locator('#faceMe img')).toHaveCount(0, { timeout: 30000 });
  console.log('PASS real two-browser sync, member list, missing-photo fallback, failed upload retry, mobile UI and logout isolation');
} finally {
  await browser?.close(); if (server) server.kill();
  let cleanupFailed = false;
  // A failed response can still have created an account. Reconcile only this run's journaled emails.
  if (resources.pendingEmails.length) {
    try {
      for (let page = 1; ; page++) {
        const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), 'reconcile uncertain test account creation');
        for (const user of users.filter(u => resources.pendingEmails.includes(u.email))) {
          if (user.user_metadata?.purpose !== marker) throw new Error('Pending test account identity mismatch');
          if (!resources.users.includes(user.id)) resources.users.push(user.id);
        }
        if (users.length < 1000) break;
      }
      resources.pendingEmails = []; await recordResources();
    } catch (error) { cleanupFailed = true; console.error(`Test account reconciliation requires attention: ${error.message}`); }
  }
  for (const space of resources.spaces) {
    try {
      const row = check(await admin.from('spaces').select('id,name').eq('id', space.id).maybeSingle(), 'verify test cleanup target');
      if (!row) continue;
      if (row.name !== marker) throw new Error('Test space identity mismatch; cleanup halted');
      const paths = await objectsUnder(space.id);
      if (paths.length) check(await admin.storage.from('food-photos').remove(paths), 'delete test photos');
      const avatars = await objectsUnder(space.id, 'food-avatars');
      if (avatars.length) check(await admin.storage.from('food-avatars').remove(avatars), 'delete isolated test avatars');
      check(await admin.from('spaces').delete().eq('id', space.id).eq('name', marker), 'delete isolated test space');
    } catch (error) { cleanupFailed = true; console.error(`Test cleanup requires attention: ${error.message}`); }
  }
  for (const id of resources.users) {
    try { check(await admin.auth.admin.deleteUser(id), 'delete isolated test user'); }
    catch (error) { cleanupFailed = true; console.error(`Test account cleanup requires attention: ${error.message}`); }
  }
  if (!cleanupFailed) { await unlink(resourceFile).catch(() => {}); assert.deepEqual(await counts(), before); console.log('PASS test data removed; pre-existing row counts unchanged'); }
  else throw new Error(`Test cleanup incomplete; resource IDs are recorded in ${resourceFile}`);
}
// All checks and cleanup have completed. Supabase/HTTP background handles must not hang CI.
process.exit(0);

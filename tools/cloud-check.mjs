// Real authenticated integration checks. Credentials stay in memory and are never logged.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const project = 'ednkwzwxcowxboxmptvs', url = `https://${project}.supabase.co`;
const publishable = 'sb_publishable_gWqoh1ETeyGIxYMtNywdeg_mWQOOj3m';
const run = randomUUID(), marker = `codex-check-${run}`, resources = { run, users: [], spaces: [] };
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
const counts = async () => Object.fromEntries(await Promise.all(['spaces', 'space_members', 'restaurants', 'reviews', 'food_photos'].map(async name => {
  const { count, error } = await admin.from(name).select('id', { count: 'exact', head: true });
  // space_members has a composite primary key.
  if (error && name === 'space_members') { const r = await admin.from(name).select('user_id', { count: 'exact', head: true }); if (r.error) throw r.error; return [name, r.count]; }
  if (error) throw error; return [name, count];
})));
const before = await counts();
const check = (result, label) => { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
async function recordResources() { await writeFile(resourceFile, JSON.stringify(resources, null, 2)); }
async function objectsUnder(prefix) {
  const listed = check(await admin.storage.from('food-photos').list(prefix, { limit: 1000 }), 'list test storage');
  const paths = [];
  for (const item of listed) {
    const path = `${prefix}/${item.name}`;
    if (item.id) paths.push(path); else paths.push(...await objectsUnder(path));
  }
  return paths;
}
try {
  for (let i = 0; i < 3; i++) {
    const password = randomBytes(24).toString('base64url'), email = `food-map-check-${run}-${i}@example.invalid`;
    const { user } = check(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { purpose: marker } }), 'create isolated test account');
    resources.users.push(user.id); await recordResources();
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
  const id = randomUUID(), path = `${space.id}/${id}/${resources.users[0]}/${randomUUID()}.jpg`;
  check(await a.storage.from('food-photos').upload(path, jpeg, { contentType: 'image/jpeg' }), 'stage photo before restaurant');
  const restaurant = { id, space_id: space.id, name: '周末小馆 · 测试', city: '沈阳', category: '东北菜', address: '测试地址', visit_date: '2026-09-16', price_per_person: 68.5, tags: ['约会', '分量足'], status: 'eaten' };
  const aReview = { taste: 9, value: 8, vibe: 7, service: null, look: null, comment: '味道很好，下次还想来。', favorite_dish: '锅包肉', favorite: true, would_return: true };
  const args = { p_restaurant: restaurant, p_review: aReview, p_photo_paths: [path] };
  let result = check(await a.rpc('save_food_record', args), 'save atomic record');
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
  for (const page of [pageA, pageB]) page.on('pageerror', error => browserErrors.push(error.message));
  await Promise.all([pageA.goto('http://127.0.0.1:4173'), pageB.goto('http://127.0.0.1:4173')]);
  await expect(pageA.locator('#helloLine')).toContainText('已同步', { timeout: 30000 });
  await expect(pageB.locator('#helloLine')).toContainText('已同步', { timeout: 30000 });
  await expect(pageA.locator('#heroMembers')).toContainText('两人已加入');
  await expect.poll(() => pageA.locator('#homeCards img').first().evaluate(img => img.naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
  await pageA.screenshot({ path: '.private-audit/mobile-home.png' });
  await pageA.locator('#homeCards .food-content').click(); await expect(pageA.locator('#detailBody .person-card')).toHaveCount(2);
  await expect(pageA.locator('#detailBody .photo-wall .photo-placeholder').last()).toBeVisible();
  await pageA.screenshot({ path: '.private-audit/mobile-detail.png' }); await pageA.locator('[data-close="detailSheet"]').click();
  await pageA.locator('[data-nav="profile"]').click(); await pageA.locator('.setting-row[data-open="couple"]').click(); await expect(pageA.locator('#memberList .member')).toHaveCount(2);
  await pageA.screenshot({ path: '.private-audit/mobile-members.png' }); await pageA.locator('[data-close="coupleSheet"]').click(); await pageA.locator('[data-nav="home"]').click();

  await pageB.locator('#mainAdd').click(); await pageB.locator('#restaurantName').fill('双人同步甜品店'); await pageB.locator('#price').fill('32.50');
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
  await pageA.locator('[data-nav="rank"]').click(); await pageA.screenshot({ path: '.private-audit/mobile-rank.png' });
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
  await pageA.locator(`[data-remove-existing="${oldPhotoId}"]`).click();
  await pageA.locator('#photoInput').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: jpeg }); await expect(pageA.locator('#photoStatus')).toContainText('已就绪');
  await pageA.locator('#saveRecordBtn').click(); await expect(pageA.locator('#editSheet')).not.toHaveClass(/open/, { timeout: 30000 });
  assert.equal(check(await a.from('food_photos').select('id').eq('path', path), 'removed photo metadata').length, 0);
  assert.equal(check(await a.from('food_photos').select('id').eq('path', bPath), 'partner photo retained').length, 1);
  await expect.poll(async () => Boolean((await a.storage.from('food-photos').createSignedUrl(path, 60)).error), { timeout: 15000 }).toBe(true);
  console.log('PASS cloud photo replacement, ownership and storage cleanup');
  await pageA.locator('[data-nav="profile"]').click(); await pageA.locator('[data-open="cloud"]').click(); await pageA.locator('#logoutBtn').click(); await expect(pageA.locator('#helloLine')).toContainText('本机档案', { timeout: 20000 });
  await expect(pageA.locator('#homeCards .food-card')).toHaveCount(0); assert.deepEqual(browserErrors, []);
  console.log('PASS real two-browser sync, member list, missing-photo fallback, failed upload retry, mobile UI and logout isolation');
} finally {
  await browser?.close(); if (server) server.kill();
  let cleanupFailed = false;
  for (const space of resources.spaces) {
    try {
      const row = check(await admin.from('spaces').select('id,name').eq('id', space.id).maybeSingle(), 'verify test cleanup target');
      if (!row) continue;
      if (row.name !== marker) throw new Error('Test space identity mismatch; cleanup halted');
      const paths = await objectsUnder(space.id);
      if (paths.length) check(await admin.storage.from('food-photos').remove(paths), 'delete test photos');
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

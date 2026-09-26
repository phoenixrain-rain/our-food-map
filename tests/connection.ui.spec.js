import { test, expect } from '@playwright/test';

const fixture = { space: { id: 'space-a', name: '原来的空间', invite_code: 'PRIVATE-CODE' }, members: [{ user_id: 'user-a', nickname: '我' }], restaurants: [{ id: 'meal-a', place_id: 'place-a', name: '原来的记录', status: 'eaten', visit_date: '2026-09-20', created_at: '2026-09-20T00:00:00Z', tags: [] }], trash: [], reviews: [], photos: [] };
async function mockCloud(page, { pending = false, session = null, loadError = false } = {}) {
  await page.addInitScript(args => {
    window.connectionMock = { ...args, getCalls: 0, loadCalls: 0, clients: 0, listeners: 0, getError: false, loadError: args.loadError, emit: (event, session) => window.connectionMock.callback(event, session) };
  }, { pending, session, loadError, data: fixture });
  await page.route('**/vendor/supabase.js*', route => route.fulfill({ contentType: 'text/javascript', body: `window.supabase = { createClient() {
    const m = window.connectionMock; m.clients++;
    return { auth: { getSession: async () => { m.getCalls++; if(m.pending) return new Promise(resolve => { m.resolve = resolve; }); return { data:{session:m.session}, error:m.getError ? new Error('Synthetic network failure'):null }; },
      onAuthStateChange: cb => { m.listeners++; m.callback=cb; return {data:{subscription:{unsubscribe(){}}}}; },
      signOut: async () => { m.callback('SIGNED_OUT',null); return {error:null}; } },
      channel: () => ({ on(){return this;},subscribe(){return this;} }), removeChannel(){} };
  }};` }));
  await page.route('**/lib/cloud.js*', route => route.fulfill({ contentType: 'text/javascript', body: `export class CloudRepository {
    constructor(){ this.urls=new Map(); } async load(){const m=window.connectionMock; m.loadCalls++; if(m.loadError) throw new Error('Synthetic network failure'); return structuredClone(m.data);}
    cleanup(){} cleanupAvatars(){} queueCleanup(){}
  }` }));
}
async function seedLocal(page) {
  await page.addInitScript(() => { localStorage.setItem('couple_food_mobile_v2', JSON.stringify({ restaurants: [{ id: 'local-meal', name: '本机旧档案', status: 'eaten' }], photos: [], reviews: [] })); });
}

test('initial failure has a recoverable state and retry preserves local records; sessionStorage denial does not block startup', async ({ page }) => {
  await mockCloud(page); await seedLocal(page);
  await page.addInitScript(() => { window.connectionMock.getError = true; const original = Storage.prototype.getItem; Storage.prototype.getItem = function(key) { if (this === sessionStorage) throw new DOMException('blocked','SecurityError'); return original.call(this,key); }; });
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('可安全重试');
  await page.locator('[data-open="connection"]').first().click(); await expect(page.locator('#connectionTitle')).toContainText('可安全重试');
  await page.evaluate(() => { window.connectionMock.getError = false; }); await page.locator('#retryConnection').click();
  await expect(page.locator('#connectionTitle')).toContainText('本机档案'); await page.locator('[data-close="connectionSheet"]').click();
  await expect(page.locator('#homeCards')).toContainText('本机旧档案');
  expect(await page.evaluate(() => [connectionMock.clients, connectionMock.listeners])).toEqual([1,1]);
});

test('hung startup shows timeout, repeated retry shares initialization and late success recovers without clearing data', async ({ page }) => {
  await mockCloud(page, { pending: true }); await seedLocal(page); await page.clock.install();
  await page.goto('/'); await expect.poll(() => page.evaluate(() => connectionMock.getCalls)).toBe(1);
  await page.clock.fastForward(16000); await expect(page.locator('#helloLine')).toContainText('可安全重试');
  await page.locator('#retryConnectionBanner').click(); await page.clock.fastForward(16000);
  await expect(page.locator('#retryConnectionBanner')).toBeEnabled();
  expect(await page.evaluate(() => [connectionMock.clients, connectionMock.getCalls])).toEqual([1,1]);
  await page.evaluate(() => connectionMock.resolve({ data: { session: null }, error: null }));
  await expect(page.locator('#helloLine')).toContainText('本机档案'); await expect(page.locator('#homeCards')).toContainText('本机旧档案');
});

test('failed cloud load does not suggest recreating a space; recovery tracks sync and a later failure retains records and editor input', async ({ page }) => {
  await mockCloud(page, { session: { user: { id:'user-a', email:'private@example.invalid' } }, loadError: true });
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('云同步待重试');
  await page.locator('[data-nav="profile"]').click(); await page.locator('[data-page="profile"] [data-open="couple"]').click();
  await expect(page.locator('#spaceLoading')).toBeVisible(); await expect(page.locator('#spaceSetup')).toBeHidden();
  await page.locator('#spaceLoading [data-open="connection"]').click();
  await page.evaluate(() => { connectionMock.loadError = false; }); await page.locator('#retryConnection').click();
  await expect(page.locator('#connectionTitle')).toContainText('已同步'); await expect(page.locator('#connectionLastSync')).not.toContainText('尚未');
  await page.locator('.connection-report summary').click(); const report = await page.locator('#connectionReport').inputValue();
  expect(report).not.toMatch(/private@example|PRIVATE-CODE|原来的记录|space-a|user-a/);
  await page.locator('[data-close="connectionSheet"]').click(); await page.locator('[data-close="coupleSheet"]').click();
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('还未保存的输入');
  const previousTime = await page.locator('#connectionLastSync').textContent();
  await page.evaluate(() => { connectionMock.loadError = true; document.querySelector('#refreshBtn').click(); });
  await expect(page.locator('#helloLine')).toContainText('云同步待重试');
  await expect(page.locator('#restaurantName')).toHaveValue('还未保存的输入');
  await expect(page.locator('#homeCards')).toContainText('原来的记录'); await expect(page.locator('#connectionLastSync')).toHaveText(previousTime);
});

test('late startup result cannot replace a newer auth event', async ({ page }) => {
  await mockCloud(page, { pending: true }); await page.goto('/');
  await expect.poll(() => page.evaluate(() => connectionMock.getCalls)).toBe(1);
  await page.evaluate(() => connectionMock.emit('SIGNED_IN', { user: { id:'user-a', email:'private@example.invalid' } }));
  await expect(page.locator('#helloLine')).toContainText('已同步');
  await page.evaluate(() => connectionMock.resolve({ data:{session:null},error:null }));
  await expect(page.locator('#profileSub')).toHaveText('private@example.invalid'); await expect(page.locator('#homeCards')).toContainText('原来的记录');
});

test('natural expiry retains account-scoped drafts, but explicit logout still clears them', async ({ page }) => {
  await mockCloud(page, { session: { user: { id:'user-a', email:'private@example.invalid' } } });
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('已同步');
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('续期失败前的草稿'); await page.locator('#stashDraft').click();
  await expect(page.locator('#draftName')).toHaveText('续期失败前的草稿');
  await page.evaluate(() => connectionMock.emit('SIGNED_OUT', null)); await expect(page.locator('#helloLine')).toContainText('本机档案');
  await expect(page.locator('#draftBanner')).toBeHidden();
  await page.evaluate(() => connectionMock.emit('SIGNED_IN', { user: { id:'user-a', email:'private@example.invalid' } }));
  await expect(page.locator('#draftName')).toHaveText('续期失败前的草稿');
  await page.locator('#syncBtn').click(); await page.locator('#logoutBtn').click(); await expect(page.locator('#helloLine')).toContainText('本机档案');
  await page.evaluate(() => connectionMock.emit('SIGNED_IN', { user: { id:'user-a', email:'private@example.invalid' } }));
  await expect(page.locator('#helloLine')).toContainText('已同步'); await expect(page.locator('#draftBanner')).toBeHidden();
});

test('connection panel fits small screens, reports offline correctly, and never loses a local photo draft', async ({ page, context }) => {
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案');
  await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('保留我的本机草稿');
  await page.locator('#photoInput').setInputFiles({ name:'draft.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=','base64') });
  await expect(page.locator('#photoStatus')).toContainText('已就绪'); await page.locator('#stashDraft').click();
  await page.locator('[data-nav="profile"]').click(); await page.locator('[data-page="profile"] [data-open="connection"]').click();
  for (const width of [320,393,1280]) { await page.setViewportSize({width,height:851}); expect(await page.locator('#connectionSheet .sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true); }
  await context.setOffline(true); await expect(page.locator('#connectionNetwork')).toContainText('离线');
  await page.locator('#retryConnection').click(); await expect(page.locator('#connectionTitle')).toContainText('本机档案');
  await page.setViewportSize({width:393,height:851}); await page.screenshot({path:'.private-audit/mobile-connection-2.9.png'});
  await page.locator('[data-close="connectionSheet"]').click(); await page.locator('[data-nav="home"]').click(); await expect(page.locator('#draftName')).toHaveText('保留我的本机草稿');
  await page.locator('#resumeDraft').click(); await expect.poll(() => page.locator('#photoPreviews img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
});

for (const halfBody of [false, true]) test(`real bundled SDK recovers a renewal stalled ${halfBody ? 'after' : 'before'} headers and retains the stored session`, async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(halfBody => {
    const user = { id:'00000000-0000-4000-8000-000000000001', aud:'authenticated', role:'authenticated', email:'synthetic@example.invalid' };
    const jwt = expiry => `${btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))}.${btoa(JSON.stringify({sub:user.id,aud:'authenticated',exp:expiry}))}.synthetic`;
    window.renewal = { recover:false, attempts:0, aborted:0, valid: { access_token:jwt(Math.floor(Date.now()/1000)+3600),refresh_token:'synthetic-renewed-token',expires_in:3600,token_type:'bearer',user } };
    localStorage.setItem('couple_food_supabase_config_v1',JSON.stringify({url:'https://diagnostic.invalid',key:'synthetic-public-key'}));
    localStorage.setItem('sb-diagnostic-auth-token',JSON.stringify({...renewal.valid,access_token:jwt(1),refresh_token:'synthetic-old-token',expires_at:1}));
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).startsWith('https://diagnostic.invalid/auth/v1/token')) {
        renewal.attempts++;
        if (!renewal.recover) {
          if (halfBody) {
            init.signal.addEventListener('abort',()=>{renewal.aborted++;},{once:true});
            return Promise.resolve(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}}),{headers:{'Content-Type':'application/json'}}));
          }
          return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{renewal.aborted++;reject(new DOMException('Aborted','AbortError'));},{once:true}));
        }
        return Promise.resolve(new Response(JSON.stringify(renewal.valid),{status:200,headers:{'Content-Type':'application/json'}}));
      }
      if (String(input).startsWith('https://diagnostic.invalid/')) return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));
      return original(input,init);
    };
  }, halfBody);
  await page.route('**/lib/cloud.js*', route => route.fulfill({contentType:'text/javascript',body:`export class CloudRepository {constructor(){this.urls=new Map();}async load(){return {space:null,members:[],restaurants:[],trash:[],reviews:[],photos:[]};}cleanup(){}cleanupAvatars(){}}`}));
  await page.goto('/'); await expect.poll(()=>page.evaluate(()=>renewal.attempts)).toBe(1);
  await page.clock.fastForward(16000); await expect(page.locator('#helloLine')).toContainText('可安全重试');
  expect(await page.evaluate(()=>renewal.aborted)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sb-diagnostic-auth-token')).refresh_token)).toBe('synthetic-old-token');
  await page.evaluate(()=>{renewal.recover=true;}); await page.clock.fastForward(1000);
  await expect(page.locator('#helloLine')).toContainText('已登录');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('sb-diagnostic-auth-token')).refresh_token)).toBe('synthetic-renewed-token');
});

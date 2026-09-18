import { test, expect } from '@playwright/test';
import pkg from '../package.json' with { type: 'json' };
const imageURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=';
async function ready(page) {
  await page.addInitScript(url => localStorage.setItem('couple_food_mobile_v2', JSON.stringify({
    nickname: '我', partnerName: 'TA', restaurants: [{ id: 'visit', name: '相册测试', status: 'eaten' }], reviews: [],
    photos: ['one', 'two', 'three'].map((id, index) => ({ id, restaurant_id: 'visit', user_id: index === 1 ? 'local-partner' : 'local-me', url }))
  })), imageURL);
  await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案');
  await page.locator('#homeCards [data-photo]').click(); await expect(page.locator('#viewerCaption')).toContainText('1 / 3');
}
async function update(page, change) {
  await page.evaluate(async ({ version, change }) => {
    const { mutateLocal } = await import(`/lib/local-store.js?v=${version}`);
    await mutateLocal(data => {
      if (change === 'remove') data.photos = data.photos.filter(p => p.id !== 'two');
      if (change === 'delete') { data.trash = data.restaurants; data.restaurants = []; }
      if (change === 'rename') data.nickname = '新昵称';
      if (change === 'replace') {
        const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
        const paint = canvas.getContext('2d'); paint.fillStyle = '#ff0000'; paint.fillRect(0, 0, 2, 2);
        data.photos[0].url = canvas.toDataURL();
      }
    });
    document.querySelector('#refreshBtn').click();
  }, { version: pkg.version, change });
  await expect(page.locator('#refreshBtn')).toBeEnabled();
}

test('an open gallery follows refreshed photo metadata and clears the deleted visit', async ({ page }) => {
  await ready(page); await page.locator('#nextPhoto').click(); await expect(page.locator('#viewerCaption')).toContainText('2 / 3');
  await update(page, 'remove'); await expect(page.locator('#viewerCaption')).toContainText('2 / 2');
  await update(page, 'delete'); await expect(page.locator('#photoViewer')).toBeHidden();
  await expect(page.locator('#viewerImage')).not.toHaveAttribute('src'); await expect(page.locator('#viewerCaption')).toBeEmpty();
});

test('gallery refresh preserves decoded pixels, refreshes changed sources and supports keyboard return focus', async ({ page }) => {
  await ready(page);
  await page.locator('#viewerImage').evaluate(async img => { await img.decode(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); window.originalViewerImage = img; window.viewerLoads = 0; img.addEventListener('load', () => window.viewerLoads++); });
  for (let i = 0; i < 3; i++) await update(page, 'rename');
  await expect(page.locator('#viewerCaption')).toContainText('新昵称');
  expect(await page.evaluate(() => window.originalViewerImage === document.querySelector('#viewerImage'))).toBe(true);
  expect(await page.evaluate(() => window.viewerLoads)).toBe(0);
  await update(page, 'replace'); await expect.poll(() => page.locator('#viewerImage').evaluate(img => img.naturalWidth)).toBe(2);
  await page.locator('#closePhotoViewer').focus(); await page.keyboard.press('Shift+Tab'); await expect(page.locator('#nextPhoto')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#closePhotoViewer')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('#viewerCaption')).toContainText('1 / 3');
  await page.keyboard.press('ArrowRight'); await expect(page.locator('#viewerCaption')).toContainText('2 / 3');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await expect(page.locator('#viewerCaption')).toContainText('3 / 3');
  await page.keyboard.press('Escape'); await expect(page.locator('#photoViewer')).toBeHidden();
  await expect(page.locator('#homeCards [data-photo]')).toBeFocused(); await expect(page.locator('#viewerImage')).not.toHaveAttribute('src');
});

async function isolatedGallery(page) {
  // No app session or real cloud calls: exercise the production module with a deferred signer.
  await page.route('**/gallery-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>.hidden{display:none}</style><button id="origin">Open</button><div id="photoViewer" class="hidden"><button id="closePhotoViewer">Close</button><button id="previousPhoto">Previous</button><img id="viewerImage"><p id="viewerCaption"></p><button id="retryPhoto">Retry</button><button id="nextPhoto">Next</button></div>` }));
  await page.goto('/gallery-fixture.html');
  await page.evaluate(async version => {
    const { PhotoGallery } = await import(`/lib/gallery.js?v=${version}`);
    window.fixtureState = { restaurants: [{ id: 'visit' }], photos: ['one', 'two'].map(id => ({ id, restaurant_id: 'visit', user_id: 'me', path: `${id}.jpg`, url: '' })) };
    window.fixtureEpoch = 1; window.fixtureUpdates = 0; window.fixtureErrors = []; window.fixtureMessages = [];
    const repository = { signPhotos: ([photo]) => new Promise((resolve, reject) => { window.finishSigning = url => resolve([{ ...photo, url }]); window.failSigning = () => reject(new Error('network unavailable')); }) };
    window.fixtureGallery = new PhotoGallery({ getState: () => window.fixtureState, getEpoch: () => window.fixtureEpoch, getRepository: () => repository,
      isCloud: () => true, ownerName: () => '我', toast: message => window.fixtureMessages.push(message), onError: error => window.fixtureErrors.push(error.message),
      updatePhoto: fresh => { window.fixtureUpdates++; window.fixtureState.photos = window.fixtureState.photos.map(p => p.id === fresh.id ? fresh : p); } });
    document.querySelector('#origin').focus(); window.fixtureGallery.open('one');
  }, pkg.version);
}

test('late photo retry cannot change another photo, reopen a viewer or cross an account epoch', async ({ page }) => {
  await isolatedGallery(page);
  await page.locator('#retryPhoto').click(); await expect(page.locator('#retryPhoto')).toBeDisabled();
  await page.locator('#nextPhoto').click(); await page.evaluate(url => window.finishSigning(url), imageURL);
  await expect(page.locator('#viewerCaption')).toContainText('2 / 2'); await expect(page.locator('#viewerImage')).not.toHaveAttribute('src');
  expect(await page.evaluate(() => window.fixtureUpdates)).toBe(0);
  await page.locator('#retryPhoto').click(); await page.locator('#closePhotoViewer').click(); await page.evaluate(url => window.finishSigning(url), imageURL);
  await expect(page.locator('#photoViewer')).toBeHidden(); await expect(page.locator('#viewerCaption')).toBeEmpty();
  await page.evaluate(() => window.fixtureGallery.open('one')); await page.locator('#retryPhoto').click();
  await page.evaluate(url => { window.fixtureEpoch++; window.fixtureGallery.close(false); window.finishSigning(url); }, imageURL);
  expect(await page.evaluate(() => window.fixtureUpdates)).toBe(0); await expect(page.locator('#viewerImage')).not.toHaveAttribute('src');
});

test('photo retry handles failure, succeeds explicitly, and ignores a removed or newer photo', async ({ page }) => {
  await isolatedGallery(page); await page.locator('#retryPhoto').click(); await page.evaluate(() => window.failSigning());
  await expect(page.locator('#retryPhoto')).toBeEnabled(); expect(await page.evaluate(() => window.fixtureErrors)).toEqual(['network unavailable']);
  await page.locator('#retryPhoto').click(); await page.evaluate(url => window.finishSigning(url), imageURL);
  await expect(page.locator('#viewerImage')).toHaveAttribute('src', imageURL); await expect(page.locator('#retryPhoto')).toBeHidden();
  // An unchanged metadata refresh must not hide the failed-image state or auto-retry forever.
  await page.evaluate(() => { window.fixtureGallery.failed(); window.fixtureGallery.sync(); });
  await expect(page.locator('#viewerImage')).toBeHidden(); await expect(page.locator('#viewerCaption')).toContainText('加载失败');
  await page.locator('#retryPhoto').click(); await page.evaluate(url => window.finishSigning(url), imageURL); await expect(page.locator('#viewerImage')).toBeVisible();
  expect(await page.evaluate(() => window.fixtureUpdates)).toBe(2);
  await page.evaluate(() => window.fixtureGallery.step(1)); await page.locator('#retryPhoto').click();
  await page.evaluate(() => { window.fixtureState.photos = window.fixtureState.photos.filter(p => p.id !== 'two'); window.fixtureGallery.sync(); });
  await page.evaluate(url => window.finishSigning(url), imageURL); await expect(page.locator('#viewerCaption')).toContainText('1 / 1');
  expect(await page.evaluate(() => window.fixtureUpdates)).toBe(2);
  await page.evaluate(() => { window.fixtureState.photos[0].url = ''; window.fixtureGallery.sync(); }); await page.locator('#retryPhoto').click();
  await page.evaluate(url => { window.fixtureState.photos[0].url = url; window.fixtureGallery.sync(); window.finishSigning(''); }, imageURL);
  await expect(page.locator('#viewerImage')).toHaveAttribute('src', imageURL); expect(await page.evaluate(() => window.fixtureUpdates)).toBe(2);
});

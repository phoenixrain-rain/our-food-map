import { test, expect } from '@playwright/test';
import pkg from '../package.json' with { type: 'json' };
async function ready(page) { await page.goto('/'); await expect(page.locator('#helloLine')).toContainText('本机档案'); }

test('opening a sheet moves focus inside it and Escape returns to its own opener', async ({ page }) => {
  await ready(page); await page.locator('[data-nav="profile"]').click();
  await page.locator('[data-open="help"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-close="helpSheet"]')).toBeFocused();
  await expect(page.getByRole('dialog', { name: '一起使用的小指南' })).toBeVisible();
  expect(await page.locator('.app').evaluate(el => el.inert)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('[data-open="help"]')).toBeFocused();
  expect(await page.locator('.app').evaluate(el => el.inert)).toBe(false);
});

async function addRecord(page) {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('弹窗测试小馆');
  await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
}

test('nested copy dialog traps focus, closes only its own layer and returns to the correct entry', async ({ page }) => {
  await addRecord(page); await page.locator('#homeCards .food-content').click(); await page.locator('#detailBody [data-copy-place]').click();
  await expect(page.locator('[data-close="placeCopySheet"]')).toBeFocused();
  expect(await page.locator('#detailSheet').evaluate(el => el.inert)).toBe(true);
  await page.keyboard.press('Shift+Tab'); await expect(page.locator('#copyPlaceText')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('[data-close="placeCopySheet"]')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#placeCopySheet')).not.toHaveClass(/open/);
  await expect(page.locator('#detailSheet')).toHaveClass(/open/); await expect(page.locator('#detailBody [data-copy-place]')).toBeFocused();
  expect(await page.locator('#detailSheet').evaluate(el => el.inert)).toBe(false);
  await page.keyboard.press('Escape'); await expect(page.locator('#homeCards .food-content')).toBeFocused();
  expect(await page.locator('.app').evaluate(el => el.inert)).toBe(false);
});

test('dirty editor confirmation keeps focus and input until the user actually discards', async ({ page }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.getByLabel('餐厅 / 店名 *', { exact: true }).fill('不应丢失');
  await page.getByLabel('地址 / 分店', { exact: true }).fill('一楼'); await page.getByLabel('标签', { exact: true }).fill('约会');
  await page.getByLabel('最喜欢的一道', { exact: true }).fill('招牌菜'); await page.getByLabel('我的一句话评价', { exact: true }).fill('还没写完');
  page.once('dialog', dialog => dialog.dismiss()); await page.keyboard.press('Escape');
  await expect(page.locator('#editSheet')).toHaveClass(/open/); await expect(page.locator('#restaurantName')).toHaveValue('不应丢失');
  expect(await page.evaluate(() => document.querySelector('#editSheet').contains(document.activeElement))).toBe(true);
  page.once('dialog', dialog => dialog.accept()); await page.keyboard.press('Escape'); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await expect(page.locator('#mainAdd')).toBeFocused();
});

test('photo and backup file pickers work from the keyboard, gallery restores the underlying sheet', async ({ page }) => {
  await ready(page); await page.locator('#mainAdd').click(); await page.locator('#restaurantName').fill('键盘选照片');
  const picking = page.waitForEvent('filechooser'); await page.locator('#choosePhotos').focus(); await page.keyboard.press('Enter');
  const chooser = await picking; await chooser.setFiles({ name: 'keyboard.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('#photoStatus')).toContainText('已就绪'); await page.locator('#saveRecordBtn').click(); await expect(page.locator('#editSheet')).not.toHaveClass(/open/);
  await page.locator('#homeCards .food-content').click(); await page.locator('#detailBody .photo-wall [data-photo]').click();
  expect(await page.locator('#detailSheet').evaluate(el => el.inert)).toBe(true); await expect(page.locator('#closePhotoViewer')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#detailBody .photo-wall [data-photo]')).toBeFocused();
  expect(await page.locator('#detailSheet').evaluate(el => el.inert)).toBe(false); await page.keyboard.press('Escape');
  await page.locator('[data-nav="profile"]').click(); await page.locator('[data-open="backup"]').click(); await page.locator('#importLabel').focus();
  const importing = page.waitForEvent('filechooser'); await page.keyboard.press('Space'); const backupChooser = await importing; await backupChooser.setFiles([]);
  await page.keyboard.press('Escape'); await expect(page.locator('#backupSheet')).not.toHaveClass(/open/);
});

test('modal stack uses opening order, even when the newer sheet occurs earlier in the HTML', async ({ page }) => {
  const body = '<!doctype html><style>.sheet-wrap{display:none}.sheet-wrap.open{display:block}</style><div class="app"><button id="mainAdd">Open</button></div>' + ['first', 'last'].map(id => `<div class="sheet-wrap" id="${id}"><div class="sheet"><div class="sheet-head"><h3>${id}</h3></div><button data-close="${id}">Close</button></div></div>`).join('');
  await page.route('**/dialog-fixture.html', route => route.fulfill({ contentType: 'text/html', body })); await page.goto('/dialog-fixture.html');
  await page.evaluate(async version => {
    const { DialogController } = await import(`/lib/dialogs.js?v=${version}`);
    const controller = new DialogController(); window.fixtureDialogs = controller;
    document.querySelector('#mainAdd').focus(); controller.open('last'); controller.open('first');
  }, pkg.version);
  await expect(page.locator('#first [data-close]')).toBeFocused();
  expect(await page.evaluate(() => Number(getComputedStyle(document.querySelector('#first')).zIndex) > Number(getComputedStyle(document.querySelector('#last')).zIndex))).toBe(true);
  await page.evaluate(() => window.fixtureDialogs.close(window.fixtureDialogs.top().id)); await expect(page.locator('#last [data-close]')).toBeFocused();
  await page.evaluate(() => window.fixtureDialogs.close('last')); await expect(page.locator('#mainAdd')).toBeFocused();
});

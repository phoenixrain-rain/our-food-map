export const APP_VERSION = '2.7.0';
const $ = selector => document.querySelector(selector);
export function newerVersion(candidate, current = APP_VERSION) {
  const valid = value => typeof value === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value);
  if (!valid(candidate) || !valid(current)) return false;
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function workerVersion(worker, timeout = 2000) {
  if (!worker) return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel(); let done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value); };
    const timer = setTimeout(() => finish(null), timeout);
    channel.port1.onmessage = event => finish(event.data?.type === 'FOOD_MAP_VERSION' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(event.data.version) ? event.data.version : null);
    try { worker.postMessage({ type: 'FOOD_MAP_GET_VERSION' }, [channel.port2]); } catch { finish(null); }
  });
}
export class UpdateUI {
  constructor({ hasUnsaved, toast, reload = version => { const url = new URL(location.href); url.searchParams.set('v', version); location.replace(url.href); } }) {
    Object.assign(this, { hasUnsaved, toast, reload });
    this.registration = null; this.installed = null; this.available = null; this.busy = false; this.serial = 0;
    this.message = '联网后可检查更新。更新不清理本机档案和已暂存草稿。'; this.watched = new WeakSet(); this.workers = new WeakSet();
    $('#checkUpdate').onclick = () => this.check(); $('#applyUpdate').onclick = () => this.apply(); $('#applyUpdateBanner').onclick = () => this.apply();
    navigator.serviceWorker?.addEventListener('controllerchange', () => this.refresh());
    window.addEventListener('online', () => this.render()); window.addEventListener('offline', () => this.render());
    navigator.serviceWorker?.getRegistration().then(registration => { if (registration) this.connect(registration); }).catch(() => {});
    this.render();
  }
  render() {
    $('#profileVersion').textContent = this.available ? `新版本 ${this.available} 可用` : `当前 ${APP_VERSION}`;
    $('#runningVersion').textContent = APP_VERSION; $('#cachedVersion').textContent = this.installed || '尚未确认';
    $('#aboutVersion').textContent = APP_VERSION;
    $('#updateStatus').textContent = this.available ? `新版本 ${this.available} 已下载完成，点“更新并重新打开”即可使用。` : this.message;
    $('#updateSafety').textContent = this.hasUnsaved() ? '当前有未保存内容或正在处理的任务，请先正式保存或暂存草稿，再更新。' : '不会自动刷新；更新不会清除本机档案、已暂存草稿或云端记录。';
    $('#checkUpdate').disabled = this.busy || !navigator.onLine;
    $('#checkUpdate').textContent = this.busy ? '正在检查…' : navigator.onLine ? '检查更新' : '离线，联网后检查';
    $('#applyUpdate').disabled = !this.available;
    $('#updateBanner').classList.toggle('hidden', !this.available);
    $('#updateBannerText').textContent = this.available ? `新版本 ${this.available} 已准备好` : '';
  }
  connect(registration) {
    this.registration = registration;
    if (!this.watched.has(registration)) { registration.addEventListener('updatefound', () => this.watch(registration.installing)); this.watched.add(registration); }
    this.watch(registration.installing); return this.refresh();
  }
  watch(worker) {
    if (!worker || this.workers.has(worker)) return; this.workers.add(worker);
    const changed = () => {
      if (worker.state === 'activated') this.refresh();
      else if (worker.state === 'redundant') { this.message = '新版下载或安装未完成，当前版本仍可用，请联网后重试。'; this.render(); }
      else { this.message = '正在准备离线资源；不会打断当前编辑。'; this.render(); }
    };
    worker.addEventListener('statechange', changed); changed();
  }
  async refresh() {
    const serial = ++this.serial, worker = this.registration?.active || navigator.serviceWorker?.controller;
    const version = await workerVersion(worker);
    if (serial !== this.serial) return;
    this.installed = version; this.available = newerVersion(version) ? version : null;
    if (version === APP_VERSION) this.message = '当前页面与已安装的离线版本一致。可联网检查是否有更新。';
    else if (version && !this.available) this.message = '当前离线缓存比页面版本旧，请联网检查并完成资源下载。';
    else if (!version && !this.registration?.installing) this.message = '暂时无法确认离线版本。请在正式网站联网检查，不必清除站点数据。';
    this.render();
  }
  async check() {
    if (this.busy || !navigator.onLine) return;
    this.busy = true; this.message = '正在检查更新…'; this.render();
    try {
      const registration = this.registration || await navigator.serviceWorker?.getRegistration();
      if (!registration) { this.message = '此页面尚未启用离线更新。请用手机浏览器打开正式 HTTPS 网址后重试。'; return; }
      await this.connect(registration); await registration.update(); this.watch(registration.installing);
      if (!registration.installing) await this.refresh();
    } catch { this.message = '检查失败，当前页面仍可使用。请检查网络后重试，不需要清除网站数据。'; }
    finally { this.busy = false; this.render(); }
  }
  apply() {
    if (!this.available) return;
    if (this.hasUnsaved()) { this.render(); return this.toast('先正式保存或暂存正在编辑的内容，再更新应用', 6500); }
    this.reload(this.available);
  }
}

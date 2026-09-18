import { safeImageURL } from './model.js?v=2.7.0';

// A viewer follows photo identities, never a stale index across async refreshes.
export class PhotoGallery {
  constructor({ getState, getEpoch, getRepository, isCloud, ownerName, updatePhoto, onError, toast, onVisibilityChange = () => {} }) {
    Object.assign(this, { getState, getEpoch, getRepository, isCloud, ownerName, updatePhoto, onError, toast, onVisibilityChange });
    this.root = document.querySelector('#photoViewer'); this.img = document.querySelector('#viewerImage');
    this.caption = document.querySelector('#viewerCaption'); this.retryButton = document.querySelector('#retryPhoto');
    this.previous = document.querySelector('#previousPhoto'); this.next = document.querySelector('#nextPhoto');
    this.closeButton = document.querySelector('#closePhotoViewer');
    this.photos = []; this.index = 0; this.generation = 0; this.failedURL = null; this.pending = false;
    this.closeButton.onclick = () => this.close(); this.previous.onclick = () => this.step(-1); this.next.onclick = () => this.step(1);
    this.retryButton.onclick = () => this.retry();
    this.root.addEventListener('keydown', event => this.keydown(event));
  }
  get visible() { return !this.root.classList.contains('hidden'); }
  open(id) {
    const state = this.getState(), photo = state.photos.find(p => p.id === id);
    if (!photo || !state.restaurants.some(r => r.id === photo.restaurant_id && !r.deleted_at)) return;
    this.generation++; this.pending = false; this.failedURL = null;
    this.returnFocus = document.activeElement;
    this.photos = state.photos.filter(p => p.restaurant_id === photo.restaurant_id);
    this.index = this.photos.findIndex(p => p.id === id);
    this.root.classList.remove('hidden'); this.onVisibilityChange(); this.render(); this.closeButton.focus({ preventScroll: true });
  }
  close(restoreFocus = true) {
    const wasVisible = this.visible;
    this.generation++; this.pending = false; this.failedURL = null; this.photos = []; this.index = 0;
    this.root.classList.add('hidden'); this.img.removeAttribute('src'); this.img.hidden = true;
    this.caption.textContent = ''; this.retryButton.classList.add('hidden'); this.retryButton.disabled = false;
    this.retryButton.textContent = '重新加载';
    this.onVisibilityChange();
    if (restoreFocus && wasVisible && this.returnFocus?.isConnected && this.returnFocus.getClientRects().length) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }
  sync() {
    if (!this.visible) return;
    const current = this.photos[this.index], state = this.getState();
    if (!current || !state.restaurants.some(r => r.id === current.restaurant_id && !r.deleted_at)) return this.close();
    const photos = state.photos.filter(p => p.restaurant_id === current.restaurant_id);
    if (!photos.length) return this.close();
    const same = photos.findIndex(p => p.id === current.id);
    this.photos = photos; this.index = same < 0 ? Math.min(this.index, photos.length - 1) : same;
    this.render();
  }
  render() {
    const photo = this.photos[this.index]; if (!photo || !this.visible) return;
    const url = safeImageURL(photo.url), failed = Boolean(url && this.failedURL === url);
    // Setting an unchanged src can cause another image load. Preserve decoded pixels.
    if (this.img.getAttribute('src') !== (url || null)) {
      this.failedURL = null;
      if (url) this.img.setAttribute('src', url); else this.img.removeAttribute('src');
    }
    this.img.hidden = !url || failed;
    this.caption.textContent = `${this.index + 1} / ${this.photos.length} · ${this.ownerName(photo.user_id)}${!url ? ' · 照片暂不可用，可以重新加载或补图' : failed ? ' · 加载失败，可重试' : ''}`;
    this.retryButton.classList.toggle('hidden', !this.isCloud() || Boolean(url && !failed));
    this.retryButton.disabled = this.pending; this.retryButton.textContent = this.pending ? '重新加载中…' : '重新加载';
    this.previous.disabled = this.index <= 0; this.next.disabled = this.index >= this.photos.length - 1;
  }
  failed() {
    if (!this.visible || !this.img.getAttribute('src')) return;
    this.failedURL = this.img.getAttribute('src'); this.render();
  }
  step(direction) {
    if (!this.visible) return;
    const index = Math.max(0, Math.min(this.photos.length - 1, this.index + direction));
    if (index === this.index) return;
    this.generation++; this.pending = false; this.failedURL = null; this.index = index; this.render();
  }
  keydown(event) {
    if (!this.visible) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); this.step(event.key === 'ArrowLeft' ? -1 : 1); }
    if (event.key === 'Tab') {
      const controls = [...this.root.querySelectorAll('button:not(:disabled)')].filter(button => button.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  async retry() {
    const repository = this.getRepository(), selected = this.photos[this.index];
    if (!this.visible || !repository || !selected || this.pending) return;
    const photo = { ...selected };
    const generation = ++this.generation, epoch = this.getEpoch(); this.pending = true; this.render();
    const currentRequest = () => this.visible && generation === this.generation && epoch === this.getEpoch() && repository === this.getRepository() && this.photos[this.index]?.id === photo.id;
    try {
      const [fresh] = await repository.signPhotos([photo], true);
      if (!currentRequest()) return;
      const current = this.getState().photos.find(p => p.id === photo.id);
      if (!current || current.path !== photo.path || current.url !== photo.url || fresh?.id !== photo.id || fresh?.path !== photo.path) return;
      this.failedURL = null;
      // Retry is explicit: retry a failed request even when signing returns the same URL.
      if (fresh.url && fresh.url === this.img.getAttribute('src')) this.img.removeAttribute('src');
      this.updatePhoto({ ...current, url: fresh.url, unavailable: fresh.unavailable }); this.sync();
      if (!fresh.url) this.toast('照片文件暂时无法读取。可在编辑记录中移除失效照片，再添加原图');
    } catch (error) { if (currentRequest()) this.onError(error); }
    finally { if (generation === this.generation) { this.pending = false; this.render(); } }
  }
}

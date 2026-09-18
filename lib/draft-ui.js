import { loadDraft, saveDraft, removeDraft, validateDraftPayload } from './drafts.js?v=2.5.2';
const $ = selector => document.querySelector(selector);
export class DraftUI {
  constructor({ getScope, getEpoch, getEditor, capture, restore, lock, afterStash, toast, message }) {
    Object.assign(this, { getScope, getEpoch, getEditor, capture, restore, lock, afterStash, toast, message });
    this.scope = null; this.saved = null; this.busy = false;
    $('#stashDraft').onclick = () => this.stash(); $('#resumeDraft').onclick = () => this.resume(); $('#profileDraft').onclick = () => this.resume(); $('#discardDraft').onclick = () => this.discard();
    window.addEventListener('focus', () => this.refresh());
  }
  render() { const scope = this.getScope(); if (scope !== this.scope) { this.scope = scope; this.saved = null; this.refresh(); } this.update(); }
  update() {
    $('#draftBanner').classList.toggle('hidden', !this.saved);
    $('#draftName').textContent = this.saved ? this.saved.payload.fields.restaurantName.trim() || '未命名的一顿' : '';
    $('#draftInfo').textContent = this.saved ? `${new Date(this.saved.savedAt).toLocaleString('zh-CN')} 暂存 · ${this.saved.payload.added.length} 张新照片 · 仅此设备` : '';
    $('#profileDraftStatus').textContent = this.saved ? `继续：${this.saved.payload.fields.restaurantName.trim() || '未命名草稿'}` : '暂无草稿；编辑时可暂存文字和照片';
    $('#profileDraft').disabled = !this.saved || this.busy; $('#resumeDraft').disabled = this.busy; $('#discardDraft').disabled = this.busy;
  }
  async refresh() {
    const scope = this.getScope(), epoch = this.getEpoch(); if (!scope || this.busy) return;
    try { const draft = await loadDraft(scope); if (this.getScope() !== scope || epoch !== this.getEpoch()) return; this.scope = scope; this.saved = draft; this.update(); }
    catch { /* Formal saves remain available when draft storage is unavailable. */ }
  }
  async stash() {
    if (this.busy || !this.getEditor()) return;
    const scope = this.getScope(), epoch = this.getEpoch(); if (!scope) return this.message('请先打开有效档案再暂存');
    this.busy = true; this.lock(true); this.update();
    try {
      const payload = this.capture(), current = await loadDraft(scope);
      if (scope !== this.getScope() || epoch !== this.getEpoch()) return;
      if (current && current.revision !== this.getEditor()?.draftRevision && !window.confirm('当前设备已有一份草稿。替换为正在编辑的内容？\n原草稿将被替换，正式记录不受影响。')) return;
      const saved = await saveDraft(scope, payload, current?.revision || null);
      if (scope !== this.getScope() || epoch !== this.getEpoch()) { if (scope.startsWith('cloud:')) await removeDraft(scope, saved.revision); return; }
      this.saved = saved; this.scope = scope; this.afterStash(); this.toast('草稿已暂存在此设备，尚未同步给另一半');
    } catch (e) { this.message(`${e.message}。编辑内容未丢失。`); }
    finally { this.busy = false; this.lock(false); this.update(); }
  }
  async resume() {
    if (this.busy) return; const scope = this.getScope(), epoch = this.getEpoch(); if (!scope) return;
    this.busy = true; this.update();
    try {
      const draft = await loadDraft(scope); if (scope !== this.getScope() || epoch !== this.getEpoch()) return;
      this.saved = draft;
      if (!draft) return this.toast('草稿不存在或已超过 7 天');
      validateDraftPayload(draft.payload); this.restore(draft);
    } catch (e) { this.toast(e.message, 6000); }
    finally { this.busy = false; this.update(); }
  }
  async discard() {
    if (this.busy || !this.saved || !window.confirm('删除这份本机草稿和其中暂存的新照片？\n已正式保存的记录不受影响。')) return;
    const scope = this.getScope(), revision = this.saved.revision; this.busy = true; this.update();
    try { await removeDraft(scope, revision); if (scope === this.getScope()) this.saved = null; this.toast('本机草稿已删除，不影响正式记录'); }
    catch (e) { this.toast(e.message); }
    finally { this.busy = false; await this.refresh(); this.update(); }
  }
  async committed(scope, id, revision) {
    if (!revision) return true;
    try { const current = await loadDraft(scope); if (current?.payload.id !== id || current.revision !== revision) return true; await removeDraft(scope, revision); if (scope === this.getScope()) { this.saved = null; this.update(); } return true; }
    catch { return false; }
  }
  reset() { this.scope = null; this.saved = null; this.update(); }
}

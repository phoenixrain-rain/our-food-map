// Modal ordering follows opening order, not the position of a sheet in the HTML.
const FOCUSABLE = 'button, input, select, textarea, a[href], summary, [tabindex]';
function usable(element) {
  return element instanceof HTMLElement && element.isConnected && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0;
}
export class DialogController {
  constructor({ getOverlay = () => null } = {}) {
    this.getOverlay = getOverlay; this.stack = []; this.app = document.querySelector('.app');
    this.wraps = [...document.querySelectorAll('.sheet-wrap')];
    for (const wrap of this.wraps) {
      const sheet = wrap.querySelector('.sheet'), title = sheet.querySelector('.sheet-head h3');
      sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.tabIndex = -1;
      if (title) { title.id ||= `${wrap.id}Title`; sheet.setAttribute('aria-labelledby', title.id); }
      for (const close of wrap.querySelectorAll('[data-close]')) if (!close.hasAttribute('aria-label')) close.setAttribute('aria-label', `关闭${title?.textContent || '窗口'}`);
    }
    document.addEventListener('keydown', event => this.keydown(event));
    document.addEventListener('focusin', event => {
      const modal = this.active();
      if (modal && !modal.contains(event.target)) this.focusFirst(modal);
    });
    this.sync();
  }
  top() { return this.stack.at(-1)?.wrap || null; }
  active() { return this.getOverlay() || this.top(); }
  controls(modal) { return [...modal.querySelectorAll(FOCUSABLE)].filter(element => element.tabIndex >= 0 && usable(element)); }
  focusFirst(modal) { (this.controls(modal)[0] || modal.querySelector('.sheet') || modal).focus({ preventScroll: true }); }
  open(id) {
    const wrap = document.getElementById(id); if (!wrap) return;
    const existing = this.stack.find(entry => entry.wrap === wrap);
    this.stack = this.stack.filter(entry => entry.wrap !== wrap);
    this.stack.push(existing || { wrap, opener: document.activeElement });
    wrap.classList.add('open'); this.sync(); this.focusFirst(wrap);
  }
  close(id) {
    const index = this.stack.findIndex(entry => entry.wrap.id === id); if (index < 0) return;
    const wasTop = index === this.stack.length - 1, [entry] = this.stack.splice(index, 1);
    entry.wrap.classList.remove('open'); this.sync();
    if (!wasTop || this.getOverlay()) return;
    const active = this.active();
    if (usable(entry.opener) && (!active || active.contains(entry.opener))) entry.opener.focus({ preventScroll: true });
    else if (active) this.focusFirst(active);
    else { const fallback = document.getElementById('mainAdd'); if (usable(fallback)) fallback.focus({ preventScroll: true }); }
  }
  sync() {
    const overlay = this.getOverlay(), top = this.top();
    if (this.app) this.app.inert = Boolean(overlay || top);
    for (const wrap of this.wraps) {
      const index = this.stack.findIndex(entry => entry.wrap === wrap);
      wrap.inert = Boolean(overlay) || wrap !== top;
      wrap.setAttribute('aria-hidden', String(wrap.inert));
      wrap.style.zIndex = index < 0 ? '' : String(100 + index);
    }
  }
  keydown(event) {
    if (event.key !== 'Tab' || event.defaultPrevented || this.getOverlay()) return;
    const modal = this.top(); if (!modal) return;
    const controls = this.controls(modal), first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); this.focusFirst(modal); return; }
    if (!modal.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}

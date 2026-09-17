const rendered = new WeakMap();
const nodeKey = node => node.nodeType !== 1 ? '' : node.id || node.getAttribute('data-record') || node.getAttribute('data-history') || node.getAttribute('data-photo') || (node.tagName === 'IMG' ? node.getAttribute('src') : '');
function compatible(a, b) { return a.nodeType === b.nodeType && a.nodeName === b.nodeName && nodeKey(a) === nodeKey(b); }
function patchNode(current, fresh) {
  if (current.nodeType !== 1) { if (current.nodeValue !== fresh.nodeValue) current.nodeValue = fresh.nodeValue; return; }
  // Keep a failed image's fallback visible until an explicit new URL is supplied.
  if (current.tagName === 'IMG' && current.hidden && current.getAttribute('src') === fresh.getAttribute('src')) fresh.hidden = true;
  if (current.tagName === 'DETAILS') fresh.open = current.open;
  for (const attr of [...current.attributes]) if (!fresh.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  for (const attr of [...fresh.attributes]) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  patchChildren(current, fresh);
  if (current.querySelector(':scope > img[hidden]')) current.querySelector(':scope > .photo-placeholder')?.classList.remove('hidden');
}
function patchChildren(current, fresh) {
  const existing = [...current.childNodes], used = new Set();
  let cursor = current.firstChild;
  for (const next of [...fresh.childNodes]) {
    const match = existing.find(node => !used.has(node) && compatible(node, next));
    if (match) {
      used.add(match);
      if (match !== cursor) {
        // State-preserving moves avoid image reloads on browsers that support them.
        if (current.moveBefore && match.isConnected && match.nodeType === 1) current.moveBefore(match, cursor);
        else current.insertBefore(match, cursor);
      }
      patchNode(match, next); cursor = match.nextSibling;
    } else { const copy = next.cloneNode(true); current.insertBefore(copy, cursor); }
  }
  for (const node of existing) if (!used.has(node)) node.remove();
}
// No-op for unchanged markup. Update text in place without detaching loaded images.
export function renderHTML(element, html) {
  if (rendered.get(element) === html) return false;
  const template = document.createElement('template'); template.innerHTML = html;
  patchChildren(element, template.content); rendered.set(element, html);
  return true;
}

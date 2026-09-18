// Drafts are explicit, device-local and account/space-scoped. They contain no sessions or signed URLs.
export const DRAFT_TTL = 7 * 86400000;
export const DRAFT_PHOTO_LIMIT = 8 * 5 * 1024 * 1024;
export function draftExpired(draft, now = Date.now()) { return !draft || !Number.isFinite(draft.savedAt) || now - draft.savedAt >= DRAFT_TTL || draft.savedAt > now + 60000; }
export function validateDraftPayload(payload) {
  if (!payload || typeof payload.id !== 'string' || !payload.id || !['eaten', 'wishlist'].includes(payload.status) || !payload.fields || !Array.isArray(payload.added) || !Array.isArray(payload.removed)) throw new Error('草稿内容不完整，请重新暂存');
  if (payload.added.length > 8 || payload.added.some(p => !(p.file instanceof Blob) || p.file.type !== 'image/jpeg' || p.file.size > 5 * 1024 * 1024) || payload.added.reduce((sum, p) => sum + p.file.size, 0) > DRAFT_PHOTO_LIMIT) throw new Error('草稿照片超出限制，请减少照片后重试');
  if (Object.values(payload.fields).some(v => typeof v !== 'string' || v.length > 20000)) throw new Error('草稿文字过长，请精简后重试');
  return payload;
}
let connection;
function db() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('our-food-map-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = null; }; resolve(request.result); };
    request.onerror = () => { connection = null; reject(new Error('无法读取本机草稿，请检查浏览器存储权限')); };
  });
  return connection;
}
async function transaction(scope, mutate) {
  if (!scope || !/^(local:local-me:|cloud:[^:]+:[^:]+)$/.test(scope)) throw new Error('请先打开有效档案再使用草稿');
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts'), get = store.get(scope); let result, failure;
    get.onsuccess = () => { try { const current = draftExpired(get.result) ? null : get.result; result = mutate(current); if (result === get.result) return; if (result) store.put(result, scope); else store.delete(scope); } catch (e) { failure = e; tx.abort(); } };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure || new Error('暂存失败，可能存储空间不足；当前编辑内容仍在'));
  });
}
export async function loadDraft(scope) { return transaction(scope, current => current); }
export async function saveDraft(scope, payload, expectedRevision = null) {
  validateDraftPayload(payload);
  return transaction(scope, current => {
    if ((current?.revision || null) !== expectedRevision) throw new Error('草稿已在另一页面更新，请检查最新草稿后重试');
    return { version: 1, scope, revision: crypto.randomUUID(), savedAt: Date.now(), payload };
  });
}
export async function removeDraft(scope, revision) { return transaction(scope, current => { if (current && current.revision !== revision) throw new Error('草稿已在另一页面更新，未删除新草稿'); return null; }); }
export async function clearAccountDrafts(userId) {
  if (!userId || userId.includes(':')) return;
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('drafts', 'readwrite'), cursor = tx.objectStore('drafts').openCursor(), prefix = `cloud:${userId}:`;
    cursor.onsuccess = () => { const entry = cursor.result; if (!entry) return; if (String(entry.key).startsWith(prefix)) entry.delete(); entry.continue(); };
    tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(new Error('本机草稿清理失败，请重试退出'));
  });
}

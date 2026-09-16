import { emptyData, validateBackup } from './model.js?v=2.0.0';
const OLD_KEY = 'couple_food_mobile_v2';
let dbPromise;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('our-food-map', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本机存储，请允许浏览器保存网站数据'));
  });
  return dbPromise;
}
export async function saveLocal(data) {
  const db = await database();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    transaction.objectStore('snapshots').put({ ...data, space: null, members: [] }, 'local');
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(new Error('本机保存失败，可能存储空间不足。请导出备份后清理空间'));
  });
}
export async function loadLocal() {
  const db = await database();
  const saved = await new Promise((resolve, reject) => {
    const req = db.transaction('snapshots').objectStore('snapshots').get('local'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  if (saved) return { ...emptyData(), ...saved, space: null, members: [] };
  const old = localStorage.getItem(OLD_KEY);
  if (!old) return emptyData();
  const data = validateBackup(JSON.parse(old));
  await saveLocal(data); // Original legacy storage is retained until the migration is safely committed.
  return data;
}

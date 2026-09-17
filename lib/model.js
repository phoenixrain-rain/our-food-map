export const CORE_DIMS = [['taste', '味道'], ['value', '性价比'], ['vibe', '环境']];
export const EXTRA_DIMS = [['service', '服务'], ['look', '颜值']];
export const DIMS = [...CORE_DIMS, ...EXTRA_DIMS];
export const WEIGHTS = { taste: .5, value: .3, vibe: .2 };
export const emptyData = () => ({ nickname: '我', partnerName: 'TA', avatar_url: '', partner_avatar_url: '', space: null, members: [], restaurants: [], trash: [], reviews: [], photos: [] });
export function numberOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function rating(value) { const n = numberOrNull(value); return n !== null && n >= 1 && n <= 10 ? n : null; }
export function mean(values) { const valid = values.filter(n => n !== null && Number.isFinite(n)); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; }
export function reviewScore(review) {
  if (!review || CORE_DIMS.some(([key]) => rating(review[key]) === null)) return null;
  return CORE_DIMS.reduce((sum, [key]) => sum + rating(review[key]) * WEIGHTS[key], 0);
}
export function isComplete(review) { return reviewScore(review) !== null; }
export function formatScore(n) { return n === null || n === undefined || !Number.isFinite(Number(n)) ? '未评' : Number(n).toFixed(1); }
export function formatPrice(n) { const value = numberOrNull(n); return value === null ? '未填人均' : `¥${Number(value.toFixed(2))}`; }
export function todayLocal(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function reviewsFor(data, id) {
  // There is one review per person. Keep the latest if an older local backup contains duplicates.
  const byUser = new Map();
  for (const r of data.reviews.filter(r => r.restaurant_id === id).sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''))) byUser.set(r.user_id, r);
  return [...byUser.values()];
}
export function summary(data, restaurant) {
  const rs = restaurant.status === 'eaten' ? reviewsFor(data, restaurant.id) : [];
  return {
    ...Object.fromEntries(DIMS.map(([key]) => [key, mean(rs.map(r => rating(r[key])))])),
    overall: mean(rs.map(reviewScore)),
    completeCount: rs.filter(isComplete).length,
    ratingCount: rs.filter(r => CORE_DIMS.some(([key]) => rating(r[key]) !== null)).length,
    bothFavorite: rs.length === 2 && rs.every(r => r.favorite === true),
    wouldReturn: rs.some(r => r.would_return === true)
  };
}
export function tasteMatch(data, selfId) {
  const diffs = data.restaurants.filter(r => r.status === 'eaten').flatMap(r => {
    const rs = reviewsFor(data, r.id), a = rating(rs.find(x => x.user_id === selfId)?.taste), b = rating(rs.find(x => x.user_id !== selfId)?.taste);
    return a !== null && b !== null ? [Math.abs(a - b)] : [];
  });
  return diffs.length ? { value: Math.round(100 * (1 - mean(diffs) / 9)), count: diffs.length } : { value: null, count: 0 };
}
export function sortRestaurants(rows, data, key = 'recent') {
  return [...rows].sort((a, b) => {
    if (key === 'visit') {
      // Calendar dates, not upload timestamps: undated visits stay at the bottom.
      const x = a.visit_date || '', y = b.visit_date || '';
      if (x !== y) return y.localeCompare(x);
    } else if (key !== 'recent') {
      const x = key === 'price' ? numberOrNull(a.price_per_person) : summary(data, a)[key];
      const y = key === 'price' ? numberOrNull(b.price_per_person) : summary(data, b)[key];
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      if (x !== null && y !== null && x !== y) return key === 'price' ? x - y : y - x;
    }
    return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || String(a.id).localeCompare(String(b.id));
  });
}
export const placeKey = r => `${r.space_id || ''}:${r.place_id || r.id}`;
export function groupRestaurants(data, rows = data.restaurants) {
  const groups = new Map();
  for (const r of new Map(rows.filter(r => !r.deleted_at).map(r => [r.id, r])).values()) {
    const key = placeKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups].map(([key, visits]) => { const sorted = sortRestaurants(visits, data, 'visit'); return { key, visits: sorted, latest: sorted.find(r => r.status === 'eaten') || sorted[0] }; });
}
export function visitsFor(data, restaurant) {
  return sortRestaurants(data.restaurants.filter(r => !r.deleted_at && placeKey(r) === placeKey(restaurant)), data, 'visit');
}
export const VISIT_TIERS = [
  { min: 0, name: '待初访', color: 'neutral' },
  { min: 1, name: '初见', color: 'sage' },
  { min: 2, name: '回头客', color: 'blue' },
  { min: 4, name: '熟客', color: 'violet' },
  { min: 8, name: '常客', color: 'amber' },
  { min: 15, name: '私藏宝店', color: 'rose' }
];
export function visitTier(data, restaurant) {
  const count = new Set(visitsFor(data, restaurant).filter(r => r.status === 'eaten').map(r => r.id)).size;
  const index = VISIT_TIERS.findLastIndex(tier => count >= tier.min);
  const tier = VISIT_TIERS[index], next = VISIT_TIERS[index + 1];
  return { ...tier, count, next: next?.name || null, remaining: next ? next.min - count : 0 };
}
export function visitLabel(data, restaurant) {
  if (restaurant.status === 'wishlist') return '想吃计划';
  const visits = visitsFor(data, restaurant).filter(r => r.status === 'eaten');
  if (visits.length < 2) return '首次打卡';
  if (visits.some(r => !r.visit_date)) return `多次到访 · 共 ${visits.length} 次`;
  const index = [...visits].reverse().findIndex(r => r.id === restaurant.id);
  return index === 0 ? '首次打卡' : `第 ${index + 1} 次打卡`;
}
export function rankedRestaurants(data, key = 'value') {
  // One place, one ranking slot. A newer unfinished visit does not replace the last joint review.
  const records = groupRestaurants(data).map(g => g.visits.find(r => r.status === 'eaten' && summary(data, r).completeCount === 2)).filter(Boolean);
  return sortRestaurants(records.filter(r => key === 'price' ? numberOrNull(r.price_per_person) !== null : summary(data, r)[key] !== null), data, key);
}
export function filterRestaurants(data, { filter = 'all', query = '', selfId = 'local-me' } = {}) {
  const q = query.trim().toLowerCase();
  return data.restaurants.filter(r => {
    const rs = reviewsFor(data, r.id), me = rs.find(x => x.user_id === selfId), partner = rs.find(x => x.user_id !== selfId);
    const stat = summary(data, r);
    const matches = { all: true, eaten: r.status === 'eaten', wishlist: r.status === 'wishlist', favorite: stat.bothFavorite,
      'mine-pending': r.status === 'eaten' && !isComplete(me), pending: r.status === 'eaten' && !isComplete(partner), again: stat.wouldReturn }[filter];
    const haystack = [r.name, r.city, r.category, r.address, ...(r.tags || []), ...rs.flatMap(x => [x.comment, x.favorite_dish])].join(' ').toLowerCase();
    return matches && (!q || haystack.includes(q));
  });
}
export function safeImageURL(url) {
  return typeof url === 'string' && (/^data:image\/(jpeg|png|webp|gif);base64,[a-z\d+/=\s]+$/i.test(url) || /^blob:/.test(url) || /^https:\/\//.test(url)) ? url : '';
}
export function validateRestaurant(r) {
  if (!r.name?.trim() || r.name.trim().length > 120) throw new Error('请填写 1–120 字的店名');
  if ((r.category || '').length > 40) throw new Error('分类最多填写 40 字');
  const price = numberOrNull(r.price_per_person);
  if (r.price_per_person !== null && (price === null || price < 0 || price > 99999999.99)) throw new Error('人均金额不正确');
  if (!['eaten', 'wishlist'].includes(r.status)) throw new Error('记录状态不正确');
  if (r.visit_date && (!/^\d{4}-\d{2}-\d{2}$/.test(r.visit_date) || new Date(`${r.visit_date}T12:00:00Z`).toISOString().slice(0, 10) !== r.visit_date)) throw new Error('日期不正确');
  return r;
}
export function validateBackup(raw) {
  const d = raw?.data || raw;
  if (!d || !Array.isArray(d.restaurants) || !Array.isArray(d.reviews) || !Array.isArray(d.photos)) throw new Error('这不是有效的美食档案备份');
  if (d.trash !== undefined && !Array.isArray(d.trash)) throw new Error('回收站备份格式不正确');
  if ((d.trash || []).some(r => !r.deleted_at || !Number.isFinite(Date.parse(r.deleted_at)))) throw new Error('回收站记录缺少有效的删除时间');
  if (d.restaurants.length + (d.trash || []).length > 10000 || d.reviews.length > 20000 || d.photos.length > 80000) throw new Error('备份记录数量超出范围');
  const text = (v, max = 2000) => String(v ?? '').slice(0, max);
  const ids = new Set();
  const restaurants = [...d.restaurants, ...(d.trash || [])].map(r => {
    if (!r.id || ids.has(r.id)) throw new Error('备份中存在缺失或重复的餐厅编号');
    ids.add(r.id);
    return validateRestaurant({ id: text(r.id, 100), place_id: text(r.place_id || r.id, 100), space_id: 'local-space', name: text(r.name, 120), city: text(r.city), category: text(r.category, 40), address: text(r.address), visit_date: r.visit_date || null, price_per_person: numberOrNull(r.price_per_person), tags: Array.isArray(r.tags) ? r.tags.slice(0, 20).map(t => text(t, 40)) : [], status: r.status, created_at: text(r.created_at), updated_at: text(r.updated_at), deleted_at: r.deleted_at ? text(r.deleted_at, 40) : null, deleted_by: r.deleted_by ? localOwnerForTrash(r.deleted_by) : null });
  });
  function localOwnerForTrash(id) { return id === (raw.self_id || 'local-me') || id === 'local-me' ? 'local-me' : 'local-partner'; }
  const self = raw.self_id || 'local-me';
  const localOwner = id => id === self || id === 'local-me' ? 'local-me' : 'local-partner';
  const reviews = d.reviews.map(r => {
    if (!ids.has(r.restaurant_id)) throw new Error('评价缺少对应的餐厅');
    return { id: text(r.id, 100), restaurant_id: r.restaurant_id, space_id: 'local-space', user_id: localOwner(r.user_id), ...Object.fromEntries(DIMS.map(([k]) => [k, rating(r[k])])), favorite_dish: text(r.favorite_dish), comment: text(r.comment), favorite: r.favorite === true, would_return: r.would_return === true, updated_at: text(r.updated_at) };
  });
  const photos = d.photos.map(p => {
    if (!p.id || !ids.has(p.restaurant_id)) throw new Error('照片缺少对应的餐厅');
    // Do not import expiring cloud links or active SVG content into an offline backup.
    const url = typeof p.url === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/i.test(p.url) ? safeImageURL(p.url) : '';
    return { id: text(p.id, 100), restaurant_id: p.restaurant_id, user_id: localOwner(p.user_id), url, unavailable: !url, created_at: text(p.created_at) };
  });
  const embeddedAvatar = value => typeof value === 'string' && value.length <= 1500000 && value.startsWith('data:') ? safeImageURL(value) : '';
  return { ...emptyData(), nickname: text(d.nickname || '我', 40), partnerName: text(d.partnerName || 'TA', 40), avatar_url: embeddedAvatar(d.avatar_url), partner_avatar_url: embeddedAvatar(d.partner_avatar_url), restaurants: restaurants.filter(r => !r.deleted_at), trash: restaurants.filter(r => r.deleted_at), reviews, photos };
}

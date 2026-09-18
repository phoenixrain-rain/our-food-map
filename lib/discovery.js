import { filterRestaurants, groupRestaurants, isComplete, mean, numberOrNull, placeKey, reviewsFor, sortRestaurants, summary, todayLocal } from './model.js?v=2.5.2';

const activeRows = data => [...new Map(data.restaurants.filter(r => !r.deleted_at).map(r => [r.id, r])).values()];
export function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0 && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value; }
export function validMonth(value) { return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) > 0; }
export function criteriaError(options = {}) {
  for (const value of [options.minPrice, options.maxPrice]) if (value !== '' && value !== null && value !== undefined && (numberOrNull(value) === null || Number(value) < 0 || Number(value) > 99999999.99)) return '请填写 0–99999999.99 之间的人均金额';
  const min = numberOrNull(options.minPrice), max = numberOrNull(options.maxPrice);
  if (min !== null && max !== null && min > max) return '最低人均不能高于最高人均';
  if ([options.from, options.to].some(value => value && !validDate(value))) return '日期格式不正确';
  if (options.from && options.to && options.from > options.to) return '开始日期不能晚于结束日期';
  if (options.onlyUndated && (options.from || options.to)) return '只看未填日期时，请先清空日期范围';
  return '';
}
function matchesCriteria(r, options, photoIds) {
  const min = numberOrNull(options.minPrice), max = numberOrNull(options.maxPrice), price = numberOrNull(r.price_per_person);
  return (!options.city || (r.city || '').trim() === options.city)
    && (!options.category || (r.category || '').trim() === options.category)
    && (min === null || (price !== null && price >= min)) && (max === null || (price !== null && price <= max))
    && (!options.from || (validDate(r.visit_date) && r.visit_date >= options.from))
    && (!options.to || (validDate(r.visit_date) && r.visit_date <= options.to))
    && (!options.onlyUndated || !validDate(r.visit_date)) && (!options.hasPhotos || photoIds.has(r.id));
}
export function filterRecords(data, options = {}) {
  if (criteriaError(options)) return [];
  const photoIds = new Set(data.photos.map(p => p.restaurant_id));
  return filterRestaurants({ ...data, restaurants: activeRows(data) }, options).filter(r => matchesCriteria(r, options, photoIds));
}
export function facetValues(data, field) { return [...new Set(activeRows(data).map(r => (r[field] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')); }

export function decisionCandidates(data, options = {}, today = todayLocal()) {
  if (criteriaError(options) || !validDate(today)) return [];
  const start = new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const source = options.source || 'mixed';
  return groupRestaurants(data, activeRows(data)).flatMap(group => {
    const latest = group.visits.find(r => r.status === 'eaten');
    const wish = sortRestaurants(group.visits.filter(r => r.status === 'wishlist'), data, 'recent')[0];
    const stat = latest ? summary(data, latest) : null;
    const r = source === 'wishlist' ? wish : source === 'again' ? (stat?.wouldReturn ? latest : null)
      : source === 'favorite' ? (stat?.bothFavorite ? latest : null) : source === 'all' ? (wish || latest)
        : source === 'mixed' ? (wish || (stat?.wouldReturn ? latest : null)) : null;
    if (!r || !matchesCriteria(r, options, new Set())) return [];
    if (options.avoidRecent && group.visits.some(v => v.status === 'eaten' && validDate(v.visit_date) && v.visit_date >= start && v.visit_date <= today)) return [];
    return [{ key: group.key, restaurant: r, reason: r.status === 'wishlist' ? '在想吃清单里' : stat.bothFavorite ? '最近一次是你们的共同最爱' : stat.wouldReturn ? '最近一次标记了想二刷' : '来自你们吃过的店', priceKind: r.status === 'wishlist' ? '预算人均' : '上次实付人均' }];
  });
}
export function drawCandidate(candidates, seen = [], random = Math.random) {
  const remaining = candidates.filter(c => !seen.includes(c.key));
  const pool = remaining.length ? remaining : candidates;
  if (!pool.length) return { candidate: null, seen: [], restarted: false };
  const sample = Number(random());
  const index = Number.isFinite(sample) ? Math.min(pool.length - 1, Math.max(0, Math.floor(sample * pool.length))) : 0;
  const candidate = pool[index];
  return { candidate, seen: [...(remaining.length ? seen : []), candidate.key], restarted: !remaining.length };
}
export function shiftMonth(month, direction) {
  if (!validMonth(month)) return todayLocal().slice(0, 7);
  const [year, part] = month.split('-').map(Number), index = year * 12 + part - 1 + direction;
  if (index < 12 || index > 9999 * 12 + 11) return month;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}
export function monthJournal(data, month, selfId = 'local-me') {
  if (!validMonth(month)) throw new Error('请选择有效月份，例如 2026-09');
  const eaten = activeRows(data).filter(r => r.status === 'eaten');
  const rows = sortRestaurants(eaten.filter(r => validDate(r.visit_date) && r.visit_date.startsWith(month + '-')), data, 'visit');
  const days = new Map(); rows.forEach(r => { if (!days.has(r.visit_date)) days.set(r.visit_date, []); days.get(r.visit_date).push(r); });
  const prices = rows.map(r => numberOrNull(r.price_per_person)).filter(p => p !== null);
  const [year, part] = month.split('-').map(Number), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return { month, rows, days: [...days].map(([date, visits]) => ({ date, visits })), placeCount: new Set(rows.map(placeKey)).size,
    averagePrice: mean(prices), pricedCount: prices.length, pendingCount: rows.filter(r => !isComplete(reviewsFor(data, r.id).find(rv => rv.user_id === selfId))).length,
    undatedCount: eaten.filter(r => !validDate(r.visit_date)).length, dayCount: days.size,
    calendarLength: [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][part - 1],
    offset: (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7 };
}
export function restaurantText(r) {
  return [r.name, [r.city, r.category].filter(Boolean).join(' · '), r.address ? `地址 / 分店：${r.address}` : '地址尚未填写'].filter(Boolean).join('\n');
}

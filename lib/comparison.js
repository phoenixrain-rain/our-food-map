import { groupRestaurants, numberOrNull, sortRestaurants, summary } from './model.js?v=2.9.0';

export const MAX_COMPARISON = 3;
export function comparisonPlaces(data) {
  return groupRestaurants(data).map(group => {
    const eaten = group.visits.filter(r => r.status === 'eaten');
    const latest = eaten[0] || null;
    const wish = sortRestaurants(group.visits.filter(r => r.status === 'wishlist'), data, 'recent')[0] || null;
    const joint = eaten.find(r => summary(data, r).completeCount === 2) || null;
    const restaurant = latest || wish;
    const amount = row => { const n = numberOrNull(row?.price_per_person); return n !== null && n >= 0 ? n : null; };
    return { key: group.key, restaurant, visits: group.visits, count: eaten.length, latest, wish, joint,
      scores: joint ? summary(data, joint) : null, price: amount(latest), budget: amount(wish) };
  }).filter(p => p.restaurant).sort((a, b) => a.restaurant.name.localeCompare(b.restaurant.name, 'zh-CN') || a.key.localeCompare(b.key));
}
export function selectedPlaces(places, keys) {
  const byKey = new Map(places.map(p => [p.key, p]));
  return [...new Set(keys)].filter(key => byKey.has(key)).slice(0, MAX_COMPARISON).map(key => byKey.get(key));
}
export function filterComparison(places, query = '', source = 'all') {
  const q = query.trim().toLocaleLowerCase();
  return places.filter(p => (source !== 'eaten' || p.latest) && (source !== 'wishlist' || p.wish)
    && (!q || p.visits.some(r => [r.name, r.city, r.category, r.address, ...(r.tags || [])].join(' ').toLocaleLowerCase().includes(q))));
}
export function comparisonLeaders(places, key) {
  if (!['taste', 'value', 'vibe', 'price'].includes(key)) return [];
  const values = places.map(p => ({ key: p.key, value: key === 'price' ? p.price : p.scores?.[key] ?? null })).filter(x => Number.isFinite(x.value));
  // One known value isn't a winner; equal values have no difference to highlight.
  if (values.length < 2 || new Set(values.map(x => x.value)).size < 2) return [];
  const best = key === 'price' ? Math.min(...values.map(x => x.value)) : Math.max(...values.map(x => x.value));
  return values.filter(x => x.value === best).map(x => x.key);
}

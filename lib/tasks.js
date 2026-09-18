import { isComplete, numberOrNull, reviewsFor, safeImageURL, sortRestaurants } from './model.js?v=2.6.0';
import { validDate } from './discovery.js?v=2.6.0';
export const TASK_KINDS = [
  ['mine', '我待评分'], ['partner', 'TA 待评分'], ['date', '补用餐日期'], ['price', '补人均'], ['photos', '检查照片']
];
export function recordTasks(data, selfId = 'local-me') {
  const active = [...new Map(data.restaurants.filter(r => !r.deleted_at).map(r => [r.id, r])).values()];
  const rows = sortRestaurants(active, data, 'visit').map(restaurant => {
    const reviews = reviewsFor(data, restaurant.id), tasks = [];
    if (restaurant.status === 'eaten') {
      if (!isComplete(reviews.find(r => r.user_id === selfId))) tasks.push('mine');
      // A cloud space with one member cannot have a partner review yet.
      if ((!data.space || data.members.length > 1) && !isComplete(reviews.find(r => r.user_id !== selfId))) tasks.push('partner');
      if (!validDate(restaurant.visit_date)) tasks.push('date');
    }
    if (numberOrNull(restaurant.price_per_person) === null) tasks.push('price');
    if (data.photos.some(p => p.restaurant_id === restaurant.id && !safeImageURL(p.url))) tasks.push('photos');
    return { restaurant, tasks };
  }).filter(row => row.tasks.length);
  return { rows, counts: Object.fromEntries(TASK_KINDS.map(([key]) => [key, rows.filter(row => row.tasks.includes(key)).length])) };
}

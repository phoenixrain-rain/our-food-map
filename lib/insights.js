import { CORE_DIMS, formatPrice, formatScore, mean, numberOrNull, placeKey, reviewsFor, sortRestaurants, summary } from './model.js?v=2.9.0';
import { validDate } from './discovery.js?v=2.9.0';

export function placeInsights(data, restaurant) {
  const visits = sortRestaurants([...new Map(data.restaurants.filter(r => !r.deleted_at && r.status === 'eaten' && placeKey(r) === placeKey(restaurant)).map(r => [r.id, r])).values()], data, 'visit');
  const dated = visits.filter(r => validDate(r.visit_date)), prices = visits.map(r => numberOrNull(r.price_per_person)).filter(n => n !== null && n >= 0);
  const complete = dated.filter(r => summary(data, r).completeCount === 2);
  const latest = complete[0] || null, previous = complete[1] || null;
  const dimensions = latest && previous ? CORE_DIMS.map(([key, label]) => {
    const from = summary(data, previous)[key], to = summary(data, latest)[key];
    return { key, label, from, to, change: Math.round((to - from) * 100) / 100 };
  }) : [];
  const dishes = new Map();
  for (const visit of visits) {
    // Keep a whole submitted dish phrase intact; don't invent automatic food-name parsing.
    const mentioned = new Set();
    for (const review of reviewsFor(data, visit.id)) {
      const text = typeof review.favorite_dish === 'string' ? review.favorite_dish.trim() : '', key = text.replace(/\s+/g, ' ').toLocaleLowerCase();
      if (!key || mentioned.has(key)) continue; mentioned.add(key);
      const dish = dishes.get(key) || { text, visits: 0, lastVisitId: visit.id };
      dish.visits++; dishes.set(key, dish);
    }
  }
  return { visits, datedCount: dated.length, firstDate: dated.at(-1)?.visit_date || null, lastDate: dated[0]?.visit_date || null,
    pricedCount: prices.length, averagePrice: mean(prices), minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null,
    latest, previous, dimensions, completeCount: complete.length, dishes: [...dishes.values()].slice(0, 6), dishCount: dishes.size };
}

export function insightsHTML(data, restaurant, esc) {
  const report = placeInsights(data, restaurant); if (report.visits.length < 2) return '';
  const changeLabel = change => change > 0 ? `上升 ${change.toFixed(1)}` : change < 0 ? `下降 ${Math.abs(change).toFixed(1)}` : '持平';
  return `<details class="visit-history place-insights" data-history="insights:${esc(placeKey(restaurant))}"><summary>复访小结 <span>${report.visits.length} 次吃过的回忆</span></summary><div class="insights-content">
    <div class="insights-stats"><div><strong>${report.visits.length}</strong><span>次实际打卡</span></div><div><strong>${report.averagePrice === null ? '—' : formatPrice(report.averagePrice)}</strong><span>平均每次人均</span></div></div>
    <p class="help-text">${report.datedCount ? `已填日期：${esc(report.firstDate)} 至 ${esc(report.lastDate)}` : '用餐日期还没有补齐'}${report.datedCount < report.visits.length ? ` · ${report.visits.length - report.datedCount} 次未填有效日期` : ''}。人均来自 ${report.pricedCount}/${report.visits.length} 次已填记录${report.pricedCount ? `，范围 ${formatPrice(report.minPrice)}–${formatPrice(report.maxPrice)}` : ''}，不是两人总花费；想吃预算不计入。</p>
    <h4>最近两次共同评分的变化</h4>
    ${report.dimensions.length ? `<div class="insights-dates"><button type="button" class="text-btn" data-detail="${esc(report.previous.id)}">较早：${esc(report.previous.visit_date)} ›</button><button type="button" class="text-btn" data-detail="${esc(report.latest.id)}">最近：${esc(report.latest.visit_date)} ›</button></div><div class="insights-comparison">${report.dimensions.map(d => `<div class="insight-dimension" data-dimension="${d.key}"><span>${d.label}</span><strong>${formatScore(d.from)} <i aria-hidden="true">→</i> ${formatScore(d.to)}</strong><small class="${d.change > 0 ? 'rise' : d.change < 0 ? 'fall' : 'same'}">${changeLabel(d.change)}</small></div>`).join('')}</div>` : '<p class="help-text">还需要两次有用餐日期、且双方都评完味道/性价比/环境的打卡，才显示变化。未评不当作 0 分。</p>'}
    <p class="help-text insights-rule">仅比较最近两次已填日期且双方评完的打卡，同日按上传时间；分项取两人平均。不会取历史最高分，也不会改变榜单。</p>
    ${report.dishes.length ? `<h4>记录里推荐过的菜</h4><div class="insights-dishes">${report.dishes.map(d => `<button type="button" data-detail="${esc(d.lastVisitId)}"><span>${esc(d.text)}</span><small>${d.visits} 次打卡提及 ›</small></button>`).join('')}</div><p class="help-text">每次打卡同一道推荐只计一次；按最近提及展示${report.dishCount > 6 ? '，这里只列前 6 项' : ''}。保留原文，不自动拆分菜名。</p>` : ''}
  </div></details>`;
}

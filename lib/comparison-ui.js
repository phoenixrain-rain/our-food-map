import { CORE_DIMS, formatPrice, formatScore, placeKey } from './model.js?v=2.8.0';
import { MAX_COMPARISON, comparisonPlaces, selectedPlaces, filterComparison, comparisonLeaders } from './comparison.js?v=2.8.0';

const $ = selector => document.querySelector(selector);
export class ComparisonUI {
  constructor({ getState, renderHTML, esc, openSheet, closeSheet, toast }) {
    Object.assign(this, { getState, renderHTML, esc, openSheet, closeSheet, toast }); this.keys = [];
    $('#compareSearch').addEventListener('input', () => this.render());
    $('#compareSource').addEventListener('change', () => this.render());
    $('#clearComparison').onclick = () => { this.keys = []; this.render(); $('#compareChooser').open = true; $('#compareChooser summary').focus(); };
    $('#showComparison').onclick = () => { $('#compareChooser').open = false; $('#compareResults').scrollIntoView({ block: 'start', behavior: 'instant' }); $('#compareResults').focus({ preventScroll: true }); };
    $('#compareSheet').addEventListener('click', event => {
      const button = event.target.closest('[data-compare-toggle], [data-compare-remove]');
      if (!button || button.disabled) return;
      const key = button.dataset.compareToggle || button.dataset.compareRemove;
      if (this.keys.includes(key)) this.keys = this.keys.filter(k => k !== key);
      else if (this.keys.length < MAX_COMPARISON) this.keys.push(key);
      else return this.toast('最多对比 3 家，请先移除一家');
      this.render();
      if (!button.isConnected) $('#compareChooser summary').focus({ preventScroll: true });
    });
  }
  add(id) {
    const row = this.getState().restaurants.find(r => r.id === id && !r.deleted_at); if (!row) return this.toast('这条记录已不存在');
    const key = placeKey(row); this.render();
    if (!this.keys.includes(key)) {
      if (this.keys.length >= MAX_COMPARISON) { this.openSheet('compareSheet'); return this.toast('最多对比 3 家，请先移除一家'); }
      this.keys.push(key);
    }
    this.openSheet('compareSheet');
  }
  render() {
    const places = comparisonPlaces(this.getState()), selected = selectedPlaces(places, this.keys), { esc, renderHTML } = this;
    const removed = this.keys.length > selected.length; this.keys = selected.map(p => p.key);
    for (const badge of document.querySelectorAll('[data-compare-count]')) badge.textContent = this.keys.length ? `已选 ${this.keys.length}/3 家 ›` : '选 2–3 家，一起看 ›';
    for (const button of document.querySelectorAll('[data-compare-add]')) {
      const row = this.getState().restaurants.find(r => r.id === button.dataset.compareAdd);
      button.textContent = row && this.keys.includes(placeKey(row)) ? '已加入 · 查看选店对比' : '加入选店对比';
    }
    if (!$('#compareSheet').classList.contains('open')) return;
    $('#compareStatus').textContent = `${removed ? '已移除不再存在的店铺。' : ''}已选 ${selected.length}/3 家；${selected.length < 2 ? '再选 ' + (2 - selected.length) + ' 家即可对比。' : '下面可以一起看差别。'}`;
    $('#clearComparison').disabled = !selected.length; $('#showComparison').disabled = selected.length < 2;
    renderHTML($('#compareSelected'), selected.map(p => `<button type="button" data-compare-remove="${esc(p.key)}" aria-label="从对比移除${esc(p.restaurant.name)}"><span>${esc(p.restaurant.name)}</span><span aria-hidden="true">×</span></button>`).join(''));
    const matches = filterComparison(places, $('#compareSearch').value, $('#compareSource').value);
    $('#compareMatches').textContent = `找到 ${matches.length} 家${matches.length > 30 ? '，先显示前 30 家，请搜索缩小范围' : ''}；每家店只出现一次。`;
    renderHTML($('#compareCandidates'), matches.slice(0, 30).map(p => {
      const active = this.keys.includes(p.key);
      return `<button type="button" class="comparison-candidate" data-compare-toggle="${esc(p.key)}" aria-pressed="${active}" ${!active && selected.length >= MAX_COMPARISON ? 'disabled' : ''}><span><strong>${esc(p.restaurant.name)}</strong><small>${esc([p.restaurant.city, p.restaurant.category].filter(Boolean).join(' · ') || '未填城市和分类')} · ${p.count ? `${p.count} 次吃过` : '想吃计划'}${p.count && p.wish ? ' · 有想吃计划' : ''}</small></span><b>${active ? '已选' : '＋'}</b></button>`;
    }).join('') || '<p class="help-text">没有符合条件的店，换个关键词或来源试试。</p>');
    renderHTML($('#compareResults'), selected.length < 2 ? '<div class="comparison-empty"><span aria-hidden="true">⇄</span><h4>把纠结的几家，放在一起看</h4><p>选 2–3 家店，对比三项主评分、人均和预算。</p></div>' : this.table(selected));
  }
  table(places) {
    const { esc } = this;
    const origin = row => row ? `<button type="button" class="text-btn" data-detail="${esc(row.id)}">${esc(row.visit_date || '未填用餐日期')} ›</button>` : '—';
    const row = (key, name, content) => `<tr data-compare-row="${key}"><th scope="row">${name}</th>${places.map(p => `<td>${content(p)}</td>`).join('')}</tr>`;
    const metric = (key, name) => {
      const leaders = comparisonLeaders(places, key);
      return row(key, name, p => `<strong class="comparison-number">${key === 'price' ? p.latest ? formatPrice(p.price) : '未打卡' : p.scores ? formatScore(p.scores[key]) : '待双方评完'}</strong>${leaders.includes(p.key) ? `<small class="comparison-highlight">${leaders.length > 1 ? '并列' : '本组'}${key === 'price' ? '较低' : '较高'}</small>` : ''}`);
    };
    return `<p class="help-text comparison-scroll-hint">左右滑动看全部店铺 ↔ · 较高/较低仅比较本组已填数据，不代表营业状态或当前价格。</p><div class="comparison-scroll" role="region" aria-label="选店对比表，可左右滑动" tabindex="0"><table class="comparison-table"><caption class="visually-hidden">按同一口径对比 ${places.length} 家店：评分来自各店最近一次双方评完的打卡，人均来自最近一次吃过记录。</caption><thead><tr><th scope="col">一起选店</th>${places.map((p, i) => `<th scope="col"><small>候选 ${i + 1}</small><button type="button" data-detail="${esc(p.restaurant.id)}">${esc(p.restaurant.name)} ›</button></th>`).join('')}</tr></thead><tbody>
      ${CORE_DIMS.map(([key, label]) => metric(key, label)).join('')}
      ${metric('price', '实付人均')}
      ${row('budget', '想吃预算', p => p.wish ? p.budget === null ? '未填预算' : `${formatPrice(p.budget)} / 人` : '无想吃计划')}
      ${row('review-source', '评分取自', p => p.joint ? `${origin(p.joint)}<small>同一顿 · 双方完整评分${p.latest.id !== p.joint.id ? '；最近一次尚未评完' : ''}</small>` : '<small>没有双方评完的打卡，未评不当 0</small>')}
      ${row('price-source', '人均取自', p => p.latest ? `${origin(p.latest)}<small>最近一次吃过；未填不取旧值</small>` : '还没吃过')}
      ${row('budget-source', '预算取自', p => p.wish ? `<button type="button" class="text-btn" data-detail="${esc(p.wish.id)}">查看想吃计划 ›</button>` : '—')}
      ${row('count', '实际到访', p => `${p.count} 次`)}
      ${row('category', '分类', p => esc(p.restaurant.category || '未填'))}
      ${row('city', '城市', p => esc(p.restaurant.city || '未填'))}
      ${row('address', '地址', p => esc(p.restaurant.address || '未填'))}
    </tbody></table></div><p class="help-text">评分沿用榜单口径：同一顿双方的平均值，用餐日期最近且已评完的打卡优先；未填日期排后，同日按上传时间。人均和评分可能来自不同打卡，可点日期核对。想吃预算不算实付，不参与人均高低提示。</p>`;
  }
  reset() {
    this.keys = []; this.closeSheet('compareSheet', true);
    $('#compareSearch').value = ''; $('#compareSource').value = 'all'; $('#compareChooser').open = true;
    for (const id of ['compareSelected', 'compareCandidates', 'compareResults']) this.renderHTML($('#' + id), '');
    for (const id of ['compareStatus', 'compareMatches']) $('#' + id).textContent = '';
  }
}

import { criteriaError, decisionCandidates, drawCandidate, facetValues, monthJournal, restaurantText, shiftMonth, validMonth } from './discovery.js?v=2.9.0';
import { formatPrice, todayLocal } from './model.js?v=2.9.0';

const $ = selector => document.querySelector(selector);
const fields = ['City', 'Category', 'MinPrice', 'MaxPrice', 'From', 'To', 'Undated', 'Photos'];
export class DiscoveryUI {
  constructor({ getState, selfId, renderHTML, esc, cardHTML, photoHTML, openSheet, closeSheet, renderRecords, switchPage, toast, getEpoch }) {
    Object.assign(this, { getState, selfId, renderHTML, esc, cardHTML, photoHTML, openSheet, closeSheet, renderRecords, switchPage, toast, getEpoch });
    this.seen = []; this.selection = null; this.day = null;
    $('#journalMonth').value = todayLocal().slice(0, 7);
    for (const suffix of fields) $('#filter' + suffix).addEventListener('change', () => {
      if (suffix === 'Undated' && $('#filterUndated').checked) { $('#filterFrom').value = ''; $('#filterTo').value = ''; }
      if (['From', 'To'].includes(suffix) && ($('#filterFrom').value || $('#filterTo').value)) $('#filterUndated').checked = false;
      renderRecords();
    });
    for (const suffix of ['MinPrice', 'MaxPrice']) $('#filter' + suffix).addEventListener('input', renderRecords);
    $('#resetRecordFilters').onclick = () => { this.resetRecordFilters(); renderRecords(); };
    for (const id of ['decisionSource', 'decisionCity', 'decisionCategory', 'decisionMaxPrice', 'decisionAvoidRecent']) $('#' + id).addEventListener('change', () => { this.seen = []; this.selection = null; this.renderDecision(); });
    $('#decisionMaxPrice').addEventListener('input', () => { this.seen = []; this.selection = null; this.renderDecision(); });
    $('#drawDinner').onclick = () => this.drawDinner();
    $('#journalMonth').onchange = () => { this.day = null; this.renderJournal(); };
    $('#previousMonth').onclick = () => this.moveMonth(-1);
    $('#nextMonth').onclick = () => this.moveMonth(1);
    $('#currentMonth').onclick = () => { $('#journalMonth').value = todayLocal().slice(0, 7); this.day = null; this.renderJournal(); };
    $('#showWholeMonth').onclick = () => { this.day = null; this.renderJournal(); };
    $('#journalCalendar').onclick = event => { const date = event.target.closest('[data-journal-day]')?.dataset.journalDay; if (date) { this.day = this.day === date ? null : date; this.renderJournal(); $('#journalMeals').scrollIntoView({ block: 'start', behavior: 'instant' }); } };
    $('#journalUndated').onclick = () => { this.closeSheet('journalSheet'); this.resetRecordFilters(); $('#filterUndated').checked = true; $('#advancedFilters').open = true; $('#filterBar [data-filter="eaten"]').click(); this.switchPage('records'); };
    $('#copyPlaceText').onclick = () => this.copyPlace();
  }
  recordOptions() {
    return { city: $('#filterCity').value, category: $('#filterCategory').value, minPrice: $('#filterMinPrice').value, maxPrice: $('#filterMaxPrice').value,
      from: $('#filterFrom').value, to: $('#filterTo').value, onlyUndated: $('#filterUndated').checked, hasPhotos: $('#filterPhotos').checked };
  }
  resetRecordFilters() {
    for (const suffix of fields) { const element = $('#filter' + suffix); if (element.type === 'checkbox') element.checked = false; else element.value = ''; }
    $('#searchInput').value = '';
  }
  updateRecordStatus() {
    const options = this.recordOptions(), count = Object.values(options).filter(Boolean).length;
    $('#advancedFilterCount').textContent = count ? `${count} 项已选` : '城市 · 分类 · 人均 · 日期';
    $('#recordFilterError').textContent = criteriaError(options);
    $('#recordFilterError').classList.toggle('hidden', !criteriaError(options));
    $('#resetRecordFilters').disabled = !count && !$('#searchInput').value;
  }
  populateFacets(prefix) {
    for (const field of ['City', 'Category']) {
      const element = $('#' + prefix + field), selected = element.value;
      const options = facetValues(this.getState(), field.toLowerCase());
      if (selected && !options.includes(selected)) options.push(selected);
      this.renderHTML(element, `<option value="">所有${field === 'City' ? '城市' : '分类'}</option>` + options.map(value => `<option value="${this.esc(value)}">${this.esc(value)}</option>`).join(''));
      element.value = selected;
    }
  }
  render() {
    this.populateFacets('filter');
    if ($('#decisionSheet').classList.contains('open')) { this.populateFacets('decision'); this.renderDecision(); }
    if ($('#journalSheet').classList.contains('open')) this.renderJournal();
    if ($('#placeCopySheet').classList.contains('open')) {
      const row = this.getState().restaurants.find(r => r.id === this.copyId && !r.deleted_at);
      if (!row) { this.copyId = null; $('#placeCopyText').value = ''; this.closeSheet('placeCopySheet', true); }
      else $('#placeCopyText').value = restaurantText(row);
    }
    const month = monthJournal(this.getState(), todayLocal().slice(0, 7), this.selfId());
    $('#journalHomeSummary').textContent = month.rows.length ? `本月 ${month.rows.length} 次打卡 · ${month.placeCount} 家店，去回看 ›` : '按月份收藏每一顿的回忆 ›';
  }
  openDecision() {
    this.seen = []; this.selection = null; this.populateFacets('decision');
    this.openSheet('decisionSheet'); this.renderDecision();
  }
  decisionOptions() { return { source: $('#decisionSource').value, city: $('#decisionCity').value, category: $('#decisionCategory').value, maxPrice: $('#decisionMaxPrice').value, avoidRecent: $('#decisionAvoidRecent').checked }; }
  renderDecision() {
    const options = this.decisionOptions(), error = criteriaError(options), candidates = decisionCandidates(this.getState(), options);
    this.seen = this.seen.filter(key => candidates.some(c => c.key === key));
    this.selection = candidates.find(c => c.key === this.selection?.key) || null;
    $('#decisionCount').textContent = error || `${candidates.length} 家符合条件，每家店只有一张签。`;
    $('#drawDinner').disabled = !!error || !candidates.length;
    $('#drawDinner').textContent = this.selection ? '换一家试试' : '帮我们抽一家';
    const candidate = this.selection;
    this.renderHTML($('#decisionResult'), candidate ? `<div class="decision-chosen"><small>今晚，要不要去这里？</small><h3>${this.esc(candidate.restaurant.name)}</h3><p>${this.esc(candidate.reason)} · ${candidate.priceKind} ${formatPrice(candidate.restaurant.price_per_person)}</p><button type="button" class="secondary" data-detail="${this.esc(candidate.restaurant.id)}">看看这家店 ›</button></div>` : `<div class="decision-empty"><span aria-hidden="true">✧</span><h3>${candidates.length ? '把纠结交给一张签' : '暂时没有合适的店'}</h3><p>${candidates.length ? '从你们已有的清单里挑选，不会新增记录。' : '试试放宽预算、换个分类，或先添加想吃的店。'}</p></div>`);
    $('#decisionProgress').textContent = candidate ? `这一轮已看 ${this.seen.length}/${candidates.length} 家，抽完后才开始新一轮。` : '';
  }
  drawDinner() {
    const result = drawCandidate(decisionCandidates(this.getState(), this.decisionOptions()), this.seen);
    this.selection = result.candidate; this.seen = result.seen; this.renderDecision();
    if (result.restarted) this.toast('这一轮已看完，开始新一轮');
  }
  openJournal() { this.openSheet('journalSheet'); this.renderJournal(); }
  moveMonth(direction) {
    $('#journalMonth').value = shiftMonth($('#journalMonth').value, direction); this.day = null; this.renderJournal();
  }
  renderJournal() {
    const month = $('#journalMonth').value;
    $('#journalError').textContent = validMonth(month) ? '' : '请选择有效月份，例如 2026-09';
    $('#journalContent').classList.toggle('hidden', !validMonth(month));
    if (!validMonth(month)) return;
    const state = this.getState(), report = monthJournal(state, month, this.selfId()), { esc, renderHTML, cardHTML, photoHTML } = this;
    if (!report.days.some(d => d.date === this.day)) this.day = null;
    $('#previousMonth').disabled = shiftMonth(month, -1) === month; $('#nextMonth').disabled = shiftMonth(month, 1) === month;
    renderHTML($('#journalStats'), `<div><b>${report.rows.length}</b><span>次打卡</span></div><div><b>${report.placeCount}</b><span>家店</span></div><div><b>${report.dayCount}</b><span>个用餐日</span></div><div><b>${formatPrice(report.averagePrice)}</b><span>平均每次人均</span></div>`);
    $('#journalPriceNote').textContent = `人均来自 ${report.pricedCount} 次已填实付的打卡，不是两人总花费；想吃计划不计入。${report.pendingCount ? ` 还有 ${report.pendingCount} 次待我评分。` : ''}`;
    const countFor = day => report.days.find(d => d.date === day)?.visits.length || 0;
    renderHTML($('#journalCalendar'), ['一', '二', '三', '四', '五', '六', '日'].map(day => `<span class="calendar-weekday">${day}</span>`).join('') + '<span aria-hidden="true"></span>'.repeat(report.offset) + Array.from({ length: report.calendarLength }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`, count = countFor(date);
      return `<button type="button" data-journal-day="${date}" class="calendar-day ${count ? 'has-meal' : ''} ${this.day === date ? 'selected' : ''} ${date === todayLocal() ? 'today' : ''}" ${count ? '' : 'disabled'} aria-pressed="${this.day === date}" aria-label="${date}，${count} 次打卡"><span>${i + 1}</span>${count ? `<small>${count} 次</small>` : ''}</button>`;
    }).join(''));
    $('#journalMealsTitle').textContent = this.day ? `${this.day.slice(5)} 的食记` : '这个月的每一顿';
    $('#showWholeMonth').classList.toggle('hidden', !this.day);
    const days = this.day ? report.days.filter(d => d.date === this.day) : report.days;
    renderHTML($('#journalMeals'), days.map(day => `<section class="journal-day-group"><h4>${esc(day.date)} <small>${day.visits.length} 次打卡</small></h4>${day.visits.map(r => cardHTML(r)).join('')}</section>`).join('') || '<div class="empty"><h3>这个月的食记，还是空白</h3><p>记一顿吃过的店，并填上用餐日期，这里就会留下足迹。</p></div>');
    const rows = days.flatMap(day => day.visits), photos = rows.flatMap(r => state.photos.filter(p => p.restaurant_id === r.id).map(p => ({ ...p, title: r.name })));
    $('#journalPhotoSection').classList.toggle('hidden', !photos.length);
    renderHTML($('#journalPhotos'), photos.slice(0, 12).map(p => photoHTML(p, p.title)).join(''));
    $('#journalPhotoCount').textContent = `${photos.length} 张 · 预览前 ${Math.min(12, photos.length)} 张，点开看这一顿全部照片`;
    $('#journalUndated').classList.toggle('hidden', !report.undatedCount);
    $('#journalUndated').textContent = `另有 ${report.undatedCount} 次未填有效用餐日期，去补充 ›`;
  }
  openCopy(r) {
    this.copyId = r.id;
    $('#placeCopyText').value = restaurantText(r); $('#placeCopyMessage').textContent = '只复制店名、城市、分类和地址，不包含私人评价、照片或邀请码。';
    this.openSheet('placeCopySheet');
  }
  async copyPlace() {
    const epoch = this.getEpoch(), id = this.copyId;
    const r = this.getState().restaurants.find(row => row.id === id && !row.deleted_at);
    if (!r) { this.closeSheet('placeCopySheet'); return this.toast('这条记录已不存在，请刷新'); }
    const text = restaurantText(r); $('#placeCopyText').value = text;
    try { await navigator.clipboard.writeText(text); if (epoch === this.getEpoch() && id === this.copyId) $('#placeCopyMessage').textContent = '已复制，可以粘贴到聊天中发给对方。'; }
    catch { if (epoch !== this.getEpoch() || id !== this.copyId) return; $('#placeCopyText').focus(); $('#placeCopyText').select(); $('#placeCopyMessage').textContent = '浏览器未允许自动复制，请长按上方文字选择复制。'; }
  }
  reset() {
    this.seen = []; this.selection = null; this.day = null; this.copyId = null; this.resetRecordFilters();
    $('#decisionSource').value = 'mixed'; $('#decisionCity').value = ''; $('#decisionCategory').value = ''; $('#decisionMaxPrice').value = ''; $('#decisionAvoidRecent').checked = false;
    $('#journalMonth').value = todayLocal().slice(0, 7); $('#placeCopyText').value = ''; $('#placeCopyMessage').textContent = '';
    for (const id of ['decisionSheet', 'journalSheet', 'placeCopySheet']) this.closeSheet(id, true);
    // Clear hidden content as well: never leave a previous account's private summaries in the DOM.
    for (const id of ['decisionResult', 'journalMeals', 'journalPhotos', 'journalStats', 'journalCalendar']) this.renderHTML($('#' + id), '');
    for (const id of ['decisionCount', 'decisionProgress', 'journalPriceNote', 'journalPhotoCount', 'journalUndated', 'journalError']) $('#' + id).textContent = '';
    for (const prefix of ['filter', 'decision']) for (const suffix of ['City', 'Category']) this.renderHTML($('#' + prefix + suffix), `<option value="">所有${suffix === 'City' ? '城市' : '分类'}</option>`);
  }
}

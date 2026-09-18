import { CORE_DIMS, EXTRA_DIMS, DIMS, emptyData, rating, mean, reviewScore, isComplete, formatScore, formatPrice, todayLocal, reviewsFor, summary, tasteMatch, sortRestaurants, rankedRestaurants, filterRestaurants, safeImageURL, validateRestaurant, validateBackup, placeKey, groupRestaurants, visitsFor, visitLabel } from './lib/model.js?v=2.5.2';
import { compressPhoto, blobDataURL, MAX_PHOTOS } from './lib/photos.js?v=2.5.2';
import { loadLocal, mutateLocal } from './lib/local-store.js?v=2.5.2';
import { CloudRepository } from './lib/cloud.js?v=2.5.2';
import { loadAvatar, drawAvatar, avatarFile } from './lib/avatar.js?v=2.5.2';
import { renderHTML } from './lib/dom.js?v=2.5.2';
import { visitTier, VISIT_TIERS } from './lib/model.js?v=2.5.2';
import { filterRecords } from './lib/discovery.js?v=2.5.2';
import { DiscoveryUI } from './lib/discovery-ui.js?v=2.5.2';
import { DraftUI } from './lib/draft-ui.js?v=2.5.2';
import { clearAccountDrafts } from './lib/drafts.js?v=2.5.2';
import { recordTasks, TASK_KINDS } from './lib/tasks.js?v=2.5.2';
import { PhotoGallery } from './lib/gallery.js?v=2.5.2';
import { DialogController } from './lib/dialogs.js?v=2.5.2';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const DEFAULT_CONFIG = { url: 'https://ednkwzwxcowxboxmptvs.supabase.co', key: 'sb_publishable_gWqoh1ETeyGIxYMtNywdeg_mWQOOj3m' };
const LOGIN_EMAIL_KEY = 'couple_food_pending_login_email_v1';
const CATEGORIES = ['家常菜', '川湘菜', '粤菜', '江浙菜', '东北菜', '西北菜', '火锅', '烧烤烤肉', '海鲜', '小吃快餐', '面馆粉店', '日料', '韩餐', '西餐', '东南亚菜', '自助餐', '甜品烘焙', '咖啡茶饮', '其他'];
let state = emptyData(), user = null, client = null, repository = null;
let mode = 'loading', syncStatus = 'loading', activePage = 'home', activeFilter = 'all', rankKey = 'value', recordView = 'places';
let authEpoch = 0, syncChain = Promise.resolve(), syncTimer, realtimeChannel, subscribedSpace, deferredInstallPrompt;
let editor = null, saving = false, photosBusy = false, detailId = null, cooldownUntil = 0;
let toastTimer, sessionKnown = false;
let identity = null, avatarBusy = false, profileSaving = false;
let activeTask = 'mine';
const selfId = () => user?.id || 'local-me';
const myReview = id => reviewsFor(state, id).find(r => r.user_id === selfId());
const partnerReview = id => reviewsFor(state, id).find(r => r.user_id !== selfId());
const initials = name => [...(String(name || 'TA').trim())].slice(0, 2).join('');
const ownerName = id => id === selfId() ? `${state.nickname || '我'}（我）` : state.members.find(m => m.user_id === id)?.nickname || state.partnerName || 'TA';
const avatarURL = id => mode === 'cloud' ? state.members.find(m => m.user_id === id)?.avatar_url : id === selfId() ? state.avatar_url : state.partner_avatar_url;
function avatarHTML(url, name) {
  const safe = safeImageURL(url);
  return `<span class="avatar-fallback" aria-hidden="true">${esc(initials(name))}</span>${safe ? `<img src="${esc(safe)}" data-avatar alt="${esc(name)}的头像" decoding="async">` : ''}`;
}
function memberAvatar(id, name, className = 'review-avatar') { return `<span class="avatar ${className}">${avatarHTML(avatarURL(id), name)}</span>`; }
function toast(message, duration = 4000) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), duration); }
function friendly(error) {
  const message = (error?.message || String(error)).replace('每人每家', '每人每次打卡');
  if (/fetch|network|networkerror|load failed/i.test(message)) return '网络连接失败，内容仍保留。请检查网络后重试';
  if (error?.code === 'otp_expired' || /invalid.*otp|token has expired or is invalid/i.test(message)) return '验证码无效或已过期，请重新发送';
  if (/row.level|permission|JWT|token.*expired/i.test(message)) return '登录或空间权限已变化，请刷新后重试';
  if (/rate limit|too many|security purposes/i.test(message)) return '请求太频繁，请稍等一分钟再试';
  return message || '操作失败，请重试';
}
function showFormMessage(message = '') { $('#saveMessage').textContent = message; $('#saveMessage').classList.toggle('hidden', !message); }
function openSheet(id) {
  dialogs.open(id);
  if (id === 'identitySheet') openIdentity();
  if (id === 'coupleSheet' && user) scheduleSync();
  if (id === 'installSheet') updateInstallUI();
  if (id === 'journalSheet') discovery.renderJournal();
  if (id === 'tasksSheet') renderTasks();
}
function closeSheet(id, force = false) {
  if (!$('#' + id).classList.contains('open')) return;
  if (id === 'identitySheet' && !force) {
    if (avatarBusy || profileSaving) return toast('正在处理头像，请稍候');
    if (identity?.dirty && !window.confirm('放弃尚未保存的头像和昵称修改？')) return;
    discardIdentity();
  }
  if (id === 'editSheet' && !force) {
    if (saving || photosBusy || drafts.busy) return toast('正在处理，请稍候');
    if (editor?.dirty && !window.confirm('放弃这次尚未保存的修改？')) return;
    discardEditor();
  }
  dialogs.close(id);
  if (id === 'detailSheet') detailId = null;
}
function discardEditor() {
  if (editor) {
    repository?.queueCleanup(editor.added.filter(p => p.path).map(p => p.path), editor.ownerId);
    editor.added.forEach(p => URL.revokeObjectURL(p.preview));
  }
  editor = null;
  if (user) repository?.cleanup(user.id);
}
function emptyCard(title, text, action = '记录一家店') {
  return `<div class="empty"><div class="emoji">🍽️</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action ? `<button type="button" class="primary" data-add>${esc(action)}</button>` : ''}</div>`;
}
function photoHTML(photo, label = '餐厅照片') {
  const url = safeImageURL(photo?.url);
  if (!photo) return '<div class="photo-placeholder">🍽️<span>还没有照片</span></div>';
  return `<button type="button" class="photo-button" data-photo="${esc(photo.id)}" aria-label="查看${esc(label)}">${url ? `<img src="${esc(url)}" data-image="${esc(photo.id)}" alt="${esc(label)}" loading="lazy" decoding="async">` : ''}<span class="photo-placeholder ${url ? 'hidden' : ''}">▧<span>照片暂不可用</span></span></button>`;
}
function firstPhoto(id) { const photos = state.photos.filter(p => p.restaurant_id === id); return photos.find(p => p.url) || photos[0]; }
function metricHTML(stat, price, budget = false) {
  return `<div class="food-metrics">${CORE_DIMS.map(([key, label]) => `<div class="metric ${key}"><span>${label}</span><b>${formatScore(stat[key])}</b></div>`).join('')}<div class="metric price"><span>${budget ? '预算人均' : '实付人均'}</span><b>${formatPrice(price)}</b></div></div>`;
}
function visitHistoryHTML(rows, selectedId = null) {
  if (rows.length < 2) return '';
  return `<details class="visit-history" data-history="${esc(placeKey(rows[0]))}"><summary>查看 ${rows.filter(r => r.status === 'eaten').length} 次打卡${rows.some(r => r.status === 'wishlist') ? '与想吃计划' : ''}</summary><div>${rows.map(r => {
    const stat = summary(state, r);
    return `<div class="visit-row ${r.id === selectedId ? 'current' : ''}"><div class="visit-thumbnail">${photoHTML(firstPhoto(r.id), r.name)}</div><button type="button" class="visit-open" data-detail="${esc(r.id)}"><strong>${esc(r.visit_date || '未填用餐日期')} · ${esc(visitLabel(state, r))}</strong><span>味道 ${formatScore(stat.taste)} · 性价比 ${formatScore(stat.value)} · 环境 ${formatScore(stat.vibe)}</span><small>${formatPrice(r.price_per_person)} / 人 · ${stat.completeCount}/2 人已评${r.id === selectedId ? ' · 当前展示' : ''}</small></button></div>`;
  }).join('')}</div></details>`;
}
function openHistories(selector) { return new Set($$(selector + ' .visit-history[open]').map(el => el.dataset.history)); }
function restoreHistories(selector, keys) { $$(selector + ' .visit-history').forEach(el => { el.open = keys.has(el.dataset.history); }); }
function renderHistoryList(selector, html) { const opened = openHistories(selector); renderHTML($(selector), html); restoreHistories(selector, opened); }
function tierHTML(r, progress = false) {
  const tier = visitTier(state, r);
  return `<span class="visit-tier tier-${tier.color}" title="${esc(tier.next ? `再去 ${tier.remaining} 次成为${tier.next}` : '已经是你们的私藏宝店')}" aria-label="${esc(tier.name)}，去过 ${tier.count} 次">${tier.name}<i></i>${tier.count} 次</span>${progress ? `<div class="tier-progress"><p>${tier.next ? `再去 ${tier.remaining} 次，点亮「${tier.next}」` : '一次次重逢，变成了你们的私藏宝店。'}</p><details><summary>到访徽章怎么算？</summary><div class="tier-legend">${VISIT_TIERS.slice(1).map(t => `<span class="visit-tier tier-${t.color}">${t.name} · ${t.min} 次起</span>`).join('')}</div><p>按同一家店未删除的吃过记录计数，双方评价不重复计次；想吃计划不计入。这是你们的到访纪念，不是商家的付费会员。</p></details></div>` : ''}`;
}
function cardHTML(r, rank = null, grouped = false) {
  const s = summary(state, r), me = myReview(r.id), other = partnerReview(r.id);
  const visits = visitsFor(state, r);
  const reviewText = r.status === 'wishlist' ? '想吃清单 · 还没去过' : `我${isComplete(me) ? '已评' : '待评'} · ${esc(state.partnerName || 'TA')}${isComplete(other) ? '已评' : '待评'}`;
  const favoriteDish = [me?.favorite_dish, other?.favorite_dish].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / ');
  return `<article class="food-card" data-record="${esc(r.id)}" data-place="${esc(r.place_id || r.id)}"><div class="food-card-top"><div class="food-photo">${photoHTML(firstPhoto(r.id), r.name)}${rank !== null ? `<span class="rank-marker">${rank + 1}</span>` : ''}</div><button type="button" class="food-content" data-detail="${esc(r.id)}"><div class="food-line"><h3 class="food-title">${esc(r.name)}</h3><span class="record-state">${r.status === 'wishlist' ? '想吃' : '吃过'}</span></div><div class="food-meta">${esc([r.city, r.category].filter(Boolean).join(' · ') || '未填写位置')}</div>${favoriteDish ? `<div class="dish-line">推荐 ${esc(favoriteDish)}</div>` : `<div class="dish-line subtle">${esc(r.address || '点开记录这一顿')}</div>`}<div class="tagline">${(r.tags || []).slice(0, 2).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${s.bothFavorite ? '<span class="tag loved">♥ 共同最爱</span>' : ''}${s.wouldReturn ? '<span class="tag return">想二刷</span>' : ''}</div></button></div><div class="visit-context">${tierHTML(r)}<span>${esc(visitLabel(state, r))}</span><span>${rank !== null ? '入榜打卡 ' : ''}${esc(r.visit_date || '未填用餐日期')}</span></div><button type="button" class="card-metrics-button" data-detail="${esc(r.id)}">${metricHTML(s, r.price_per_person, r.status === 'wishlist')}</button><div class="card-footer"><span>${reviewText}</span><button type="button" class="text-btn" data-detail="${esc(r.id)}">查看这一顿 ›</button></div>${grouped ? `<div class="place-actions"><span>${rank !== null ? '显示最近一次双方评完的打卡' : '显示最近一次符合筛选的记录'}</span><button type="button" class="text-btn" data-repeat="${esc(r.id)}">＋ 再来一次</button></div>${visitHistoryHTML(visits, r.id)}` : ''}</article>`;
}
function render() {
  discovery.render();
  drafts.render(); renderTasks();
  renderHeader(); renderHome(); renderRecords(); renderRank(); renderProfile(); renderTrash(); renderCategories();
  if (detailId) renderDetail(detailId);
  photoGallery.sync();
  if (editor?.original && state.trash.some(r => r.id === editor.id)) showFormMessage('这条记录已被移到回收站，请先关闭编辑并恢复记录。未保存的内容仍在此处。');
}
function renderCategories() {
  const categories = [...new Set([...state.restaurants, ...state.trash].map(r => r.category).filter(Boolean).concat(CATEGORIES))];
  $('#categoryOptions').innerHTML = categories.map(name => `<option value="${esc(name)}"></option>`).join('');
}
function renderTrash() {
  $('#trashSummary').textContent = state.trash.length ? `${state.trash.length} 条已删除记录 · 可恢复` : '删除的记录可在这里恢复';
  $('#trashList').innerHTML = [...state.trash].sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at)).map(r => `<article class="trash-record"><div><h3>${esc(r.name)}</h3><p>${esc([r.city, r.category].filter(Boolean).join(' · '))}</p><small>${esc(new Date(r.deleted_at).toLocaleDateString('zh-CN'))} 移入 · 评价和照片保留</small></div><button type="button" class="secondary" data-restore="${esc(r.id)}">恢复</button></article>`).join('') || emptyCard('回收站是空的', '删除的记录会保留在这里，需要时可恢复。', '');
}
function renderHeader() {
  const connected = mode === 'cloud' && state.space && syncStatus === 'ready' && navigator.onLine;
  $('#syncDot').className = `sync-dot ${connected ? 'cloud' : 'local'}`;
  $('#helloLine').textContent = mode === 'loading' ? '正在读取档案…' : !navigator.onLine ? '当前离线' : mode === 'local' ? '本机档案 · 仅保存在这台设备' : !state.space ? '已登录 · 等待加入空间' : connected ? '双人空间 · 已同步' : '云同步待重试';
  $('#pageTitle').textContent = { home: '今天吃什么？', records: '我们的记录', rank: '美食榜单', profile: '我们的小档案' }[activePage];
  $('#spaceName').textContent = state.space?.name || '我们的美食地图';
  renderHTML($('#faceMe'), avatarHTML(avatarURL(selfId()), state.nickname)); renderHTML($('#profileFace'), avatarHTML(avatarURL(selfId()), state.nickname));
  renderHTML($('#facePartner'), avatarHTML(avatarURL(state.members.find(m => m.user_id !== selfId())?.user_id || 'local-partner'), state.partnerName));
  const match = tasteMatch(state, selfId());
  $('#matchScore').textContent = match.value === null ? '—' : `${match.value}%`;
  $('#matchScore').title = match.count ? `基于 ${match.count} 次双方都填写味道分的打卡` : '双方给同一顿的味道评分后生成';
  $('#heroMembers').textContent = mode !== 'cloud' ? '登录后和 TA 一起记录 ›' : !state.space ? '创建或加入情侣空间 ›' : state.members.length === 2 ? `${state.nickname} 和 ${state.partnerName} · 两人已加入 ›` : '1/2 位成员 · 等待另一半加入 ›';
  const warning = !navigator.onLine ? (mode === 'cloud' ? '当前离线，云端记录暂时不能保存；已加载的内容仍可查看。' : '当前离线，本机记录仍可保存。') : syncStatus === 'error' ? '同步失败，已显示的内容会保留。请点右上角 ↻ 重试。' : mode === 'cloud' && !state.space && syncStatus === 'ready' ? '请先在“我们 → 情侣空间”创建或加入空间，再添加共同记录。' : '';
  $('#connectionBanner').textContent = warning; $('#connectionBanner').classList.toggle('hidden', !warning);
}
function renderHome() {
  const eaten = sortRestaurants(state.restaurants.filter(r => r.status === 'eaten'), state);
  const wish = sortRestaurants(state.restaurants.filter(r => r.status === 'wishlist'), state);
  renderHTML($('#homeStats'), `<button data-filter-go="eaten"><b>${groupRestaurants(state, eaten).length}</b><span>一起吃过的店</span></button><button data-filter-go="wishlist"><b>${groupRestaurants(state, wish).length}</b><span>想去的店</span></button><button data-filter-go="mine-pending"><b>${eaten.filter(r => !isComplete(myReview(r.id))).length}</b><span>等我来评分</span></button>`);
  $('#recordCountText').textContent = eaten.length ? `${eaten.length} 条记录 · 按上传时间从新到旧` : '按上传时间从新到旧 · 记下你们喜欢的一家店';
  renderHTML($('#homeCards'), eaten.slice(0, 4).map(r => cardHTML(r)).join('') || emptyCard('第一顿，从这里开始', '记下味道、性价比、环境和人均。'));
  renderHTML($('#wishCards'), wish.slice(0, 2).map(r => cardHTML(r)).join('') || '<div class="empty"><h3>下次约会想吃什么？</h3><p>先记店名和预算，吃过之后再评分。</p><button type="button" class="primary" data-add-wish>加一家想吃的</button></div>');
  const photos = sortRestaurants(state.restaurants.filter(r => state.photos.some(p => p.restaurant_id === r.id)), state).slice(0, 8);
  renderHTML($('#storyRow'), photos.map(r => `<button type="button" class="story" data-detail="${esc(r.id)}"><div class="story-ring"><div>${safeImageURL(firstPhoto(r.id)?.url) ? `<img src="${esc(firstPhoto(r.id).url)}" alt="${esc(r.name)}" loading="lazy">` : '🍴'}</div></div><span>${esc(r.name)}</span></button>`).join('') || '<p class="help-text">添加照片后，这里会留下你们的美食相册。</p>');
}
function renderRecords() {
  discovery.updateRecordStatus();
  const matched = filterRecords(state, { filter: activeFilter, query: $('#searchInput').value, selfId: selfId(), ...discovery.recordOptions() }), groups = groupRestaurants(state, matched);
  const sortKey = $('#recordSort').value;
  const rows = sortRestaurants(recordView === 'places' ? groups.map(g => sortKey === 'recent' ? sortRestaurants(g.visits, state, 'recent')[0] : g.latest) : matched, state, sortKey);
  $('#resultsCount').textContent = `${groups.length} 家店 · ${matched.length} 条记录`;
  $('#recordViewHelp').textContent = recordView === 'places' ? '每店一张卡，显示最近一次符合筛选的打卡；展开可回看全部历史。未填用餐日期的记录排在最后。' : '逐次展示每一顿；同店标注第几次打卡。默认按用餐日期倒序，未填日期的排在最后。';
  $$('#recordViews button').forEach(b => b.classList.toggle('active', b.dataset.recordView === recordView));
  renderHistoryList('#recordList', rows.map(r => cardHTML(r, null, recordView === 'places')).join('') || emptyCard('没有符合条件的记录', '试试其他筛选条件或关键词。', ''));
  $$('#filterBar [data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === activeFilter));
}
function renderRank() {
  const labels = { value: '性价比', taste: '味道', vibe: '环境', price: '人均', overall: '综合' };
  const rows = rankedRestaurants(state, rankKey);
  const pending = state.restaurants.filter(r => r.status === 'eaten' && summary(state, r).completeCount < 2).length;
  $('#rankExplanation').textContent = '每家店只排一次，采用用餐日期最近、双方三个主评分齐全的一次打卡；新打卡未评完前保留上次成绩。' + (rankKey === 'price' ? '按这次实付人均从低到高，未填金额不入此榜。' : rankKey === 'overall' ? '双人平均：味道 50% + 性价比 30% + 环境 20%。' : `${labels[rankKey]}取双方平均，从高到低。`) + (pending ? ` ${pending} 次打卡仍待评。` : '');
  renderHistoryList('#rankList', rows.map((r, i) => cardHTML(r, i, true)).join('') || emptyCard(`还没有${labels[rankKey]}榜单`, '双方在同一次打卡中完成三个主评分后，这家店才会入榜。', ''));
  $$('#rankTabs [data-rank]').forEach(b => b.classList.toggle('active', b.dataset.rank === rankKey));
  const eaten = state.restaurants.filter(r => r.status === 'eaten'), costs = eaten.map(r => r.price_per_person).filter(p => p !== null), match = tasteMatch(state, selfId());
  renderHTML($('#statsGrid'), `<div class="stat"><small>吃过的店铺</small><strong>${groupRestaurants(state, eaten).length}</strong><p>共 ${eaten.length} 次打卡，复访不多算店铺</p></div><div class="stat"><small>每次打卡平均人均</small><strong>${formatPrice(mean(costs))}</strong><p>来自 ${costs.length} 次已填人均的打卡</p></div><div class="stat"><small>双方完成主评分</small><strong>${eaten.filter(r => summary(state, r).completeCount === 2).length}</strong><p>次打卡 · 每次双方三个主评分齐全</p></div><div class="stat"><small>口味接近度</small><strong>${match.value === null ? '—' : `${match.value}%`}</strong><p>基于 ${match.count} 次双方的味道分</p></div>`);
  const counts = new Map(); eaten.forEach(r => counts.set(r.category || '其他', (counts.get(r.category || '其他') || 0) + 1));
  const categories = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 7), max = categories[0]?.[1] || 1;
  renderHTML($('#categoryBars'), categories.map(([name, count]) => `<div class="bar-row"><span>${esc(name)}</span><div class="bar"><i style="width:${count / max * 100}%"></i></div><b>${count}</b></div>`).join('') || '<p class="help-text">记录后会显示你们常吃的分类。</p>');
}
function renderProfile() {
  $('#profileName').textContent = state.nickname || '我'; $('#profileSub').textContent = user?.email || '本机档案 · 登录后可使用双人空间';
  $('#cloudBadge').textContent = user ? (syncStatus === 'error' ? '待重试' : '已登录') : mode === 'loading' ? '加载中' : '本机模式';
  $('#cloudBadge').className = `mode-badge ${user && syncStatus !== 'error' ? 'online' : ''}`;
  $('#coupleSummary').textContent = state.space ? `${state.space.name} · ${state.members.length}/2 位成员` : '创建或通过邀请码加入';
  $('#coupleLoggedOut').classList.toggle('hidden', !!user); $('#coupleLoggedIn').classList.toggle('hidden', !user);
  $('#spaceSetup').classList.toggle('hidden', !!state.space); $('#currentSpaceBox').classList.toggle('hidden', !state.space);
  if (state.space) {
    $('#currentSpaceName').textContent = state.space.name; $('#currentInviteCode').textContent = state.space.invite_code;
    $('#memberStatus').textContent = state.members.length === 2 ? '两人已加入' : '等待另一半加入';
    $('#memberStatus').className = `mode-badge ${state.members.length === 2 ? 'online' : ''}`;
    renderHTML($('#memberList'), state.members.map(m => `<div class="member">${memberAvatar(m.user_id, m.nickname, 'member-avatar')}<div><strong>${esc(m.nickname)}${m.user_id === selfId() ? '（我）' : ''}</strong><small>${m.role === 'owner' ? '空间创建者' : '已加入空间'}</small></div><span>✓ 已加入</span></div>`).join('') + (state.members.length < 2 ? '<div class="member waiting"><span class="member-avatar">＋</span><div><strong>等另一半来</strong><small>把下面的邀请码发给 TA</small></div></div>' : ''));
  } else {
    $('#currentSpaceName').textContent = ''; $('#currentInviteCode').textContent = ''; $('#memberStatus').textContent = ''; renderHTML($('#memberList'), '');
  }
  $('#authStatus').textContent = user ? `当前账号：${user.email}。${state.space ? '已连接情侣空间。' : '登录成功，请创建或加入情侣空间。'}` : '用自己的邮箱登录，收到验证码后回到当前页面输入。';
  $('#loginForm').classList.toggle('hidden', !!user); $('#logoutBtn').classList.toggle('hidden', !user);
  $('#importInput').disabled = !!user; $('#importLabel').disabled = !!user; $('#importLabel').classList.toggle('disabled', !!user);
  $('#backupHelp').textContent = user ? '当前为云端模式，可导出完整备份。为避免混入其他空间，导入只在退出登录后的本机模式开放。' : '导入会合并到本机档案，不会替换已存在的同编号记录，也不会自动上传到云端。';
  updateInstallUI();
}
function switchPage(page) {
  activePage = page; $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === page));
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
  $('main').scrollTop = 0; renderHeader();
}

function renderDetail(id) {
  const r = state.restaurants.find(x => x.id === id); if (!r) { closeSheet('detailSheet', true); return; }
  const openedHistory = openHistories('#detailBody');
  const rs = reviewsFor(state, id), s = summary(state, r), photos = state.photos.filter(p => p.restaurant_id === id);
  const persons = [selfId(), ...state.members.filter(m => m.user_id !== selfId()).map(m => m.user_id)];
  if (persons.length === 1 && rs.some(rv => rv.user_id !== selfId())) persons.push(rs.find(rv => rv.user_id !== selfId()).user_id);
  const cards = r.status === 'eaten' ? persons.map(person => {
    const review = rs.find(rv => rv.user_id === person);
    return `<div class="person-card"><div class="who">${memberAvatar(person, ownerName(person))}<span>${esc(ownerName(person))}</span></div>${CORE_DIMS.map(([key, label]) => `<div class="person-metric"><span>${label}</span><b>${formatScore(rating(review?.[key]))}</b></div>`).join('')}<div class="dimline"><span>综合</span><b>${formatScore(reviewScore(review))}</b></div>${EXTRA_DIMS.filter(([key]) => rating(review?.[key]) !== null).map(([key, label]) => `<div class="dimline"><span>${label}</span><b>${formatScore(review[key])}</b></div>`).join('')}${review?.favorite_dish ? `<div class="quote">推荐菜：${esc(review.favorite_dish)}</div>` : ''}${review?.comment ? `<div class="quote">${esc(review.comment)}</div>` : ''}<div class="tagline">${review?.favorite ? '<span class="tag loved">♥ 我的最爱</span>' : ''}${review?.would_return ? '<span class="tag return">想二刷</span>' : ''}</div></div>`;
  }).join('') : '<p class="help-text">还没去过，先记录预算和期待。吃过后再留下评分。</p>';
  const detailVisits = `<div class="detail-visits">${tierHTML(r, true)}<p class="help-text">${esc(visitLabel(state, r))} · 同一家店的每次打卡独立保存。</p>${visitHistoryHTML(visitsFor(state, r), id)}<button type="button" class="secondary repeat-visit" data-repeat="${esc(id)}">${r.status === 'wishlist' ? '去打卡，写下这一顿' : '＋ 再来一次，新增打卡'}</button></div>`;
  const detailMarkup = `<div class="detail-cover">${photoHTML(firstPhoto(id), r.name)}</div><h2 class="detail-title">${esc(r.name)}</h2><p class="detail-meta">${esc([r.city, r.category, r.address, r.visit_date ? `用餐 ${r.visit_date}` : ''].filter(Boolean).join(' · ') || '还没有补充地址')}</p><p class="help-text">上传于 ${esc(r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '未记录时间')}</p><button type="button" class="copy-place-btn" data-copy-place="${esc(id)}">复制店名与地址 ↗</button>${metricHTML(s, r.price_per_person, r.status === 'wishlist')}<div class="compare">${cards}</div><p class="help-text">${r.status === 'eaten' ? '分项为已填写分数的平均值；每人的评价独立保存，双方评完后共同入榜。' : '预算仅供挑选餐厅参考，不计入实付统计。'}</p>${photos.length ? `<div class="section-head"><h2>这一顿的照片 <small>${photos.length}</small></h2></div><div class="photo-wall">${photos.map(p => photoHTML(p, `${r.name} · ${ownerName(p.user_id)}`)).join('')}</div>` : ''}${detailVisits}<button type="button" class="save-btn" style="margin-top:18px" data-edit="${esc(id)}">${r.status === 'wishlist' ? '编辑 / 我们吃过了' : '编辑记录 / 写我的评价'}</button><button type="button" class="delete-record" data-delete="${esc(id)}">删除这条记录</button><p class="help-text">只删除这一顿，不影响同店其他打卡。可到“我们 → 回收站”恢复。</p>`;
  renderHTML($('#detailBody'), detailMarkup);
  restoreHistories('#detailBody', openedHistory);
}
async function setRecordDeleted(id, deleted, button) {
  const row = (deleted ? state.restaurants : state.trash).find(r => r.id === id);
  if (!row || mode === 'loading') return;
  if (deleted && !window.confirm(`将“${row.name}”移入回收站？\n两人的列表和榜单都会移除它，评价和照片会保留，可在“我们 → 回收站”恢复。`)) return;
  const epoch = authEpoch, operationMode = mode;
  await buttonAction(button, async () => {
    if (operationMode === 'cloud') {
      if (!navigator.onLine) throw new Error('当前离线，恢复网络后再操作');
      await repository.setDeleted(row, deleted);
      if (epoch !== authEpoch) return;
      try { await refreshCloud(); } catch { toast('操作已成功，列表同步暂时失败，请点击 ↻ 刷新', 6000); return; }
    } else {
      const next = await mutateLocal(data => {
        const source = data[deleted ? 'restaurants' : 'trash'].find(r => r.id === id);
        if (!source) return;
        if (source.updated_at !== row.updated_at) throw new Error('记录刚刚被修改，请刷新后再操作');
        const now = new Date().toISOString();
        data.restaurants = data.restaurants.filter(r => r.id !== id); data.trash = data.trash.filter(r => r.id !== id);
        data[deleted ? 'trash' : 'restaurants'].push({ ...source, deleted_at: deleted ? now : null, deleted_by: deleted ? 'local-me' : null, updated_at: now });
      }, state);
      if (epoch !== authEpoch) return; state = next; render();
    }
    toast(deleted ? '已移入回收站，可在“我们 → 回收站”恢复' : '记录已恢复，双方评价和照片仍在');
  }, deleted ? '正在删除…' : '正在恢复…');
}
function showDetail(id) { closeSheet('decisionSheet', true); closeSheet('journalSheet', true); closeSheet('tasksSheet', true); detailId = id; renderDetail(id); openSheet('detailSheet'); }
function openEditor(id = null, status = 'eaten', repeatId = null) {
  if (mode === 'loading') return toast('档案仍在加载，请稍候');
  if (mode === 'cloud' && (!state.space || syncStatus !== 'ready')) {
    toast(state.space ? '请先刷新并恢复云同步' : '先加入情侣空间，再添加共同记录'); openSheet('coupleSheet'); return;
  }
  if (editor) discardEditor();
  const r = id ? state.restaurants.find(x => x.id === id) : null, rv = r ? myReview(id) : null;
  const source = repeatId ? state.restaurants.find(x => x.id === repeatId) : null, place = r || source;
  editor = { id: r?.id || crypto.randomUUID(), ownerId: selfId(), original: r ? structuredClone(r) : null, status: r?.status || status, added: [], removed: new Set(), dirty: false, scope: `${mode}:${selfId()}:${state.space?.id || ''}` };
  editor.placeId = place?.place_id || place?.id || editor.id; editor.createPlace = !place; editor.newPlaceId = place ? crypto.randomUUID() : editor.id;
  const groups = groupRestaurants(state);
  $('#recordPlace').innerHTML = '<option value="new">＋ 新店 / 作为独立店铺</option>' + groups.map(g => `<option value="${esc(g.latest.place_id || g.latest.id)}">${esc([g.latest.name, g.latest.city, g.latest.address].filter(Boolean).join(' · '))}（${g.visits.filter(v => v.status === 'eaten').length} 次打卡）</option>`).join('');
  $('#recordPlace').value = place ? editor.placeId : 'new';
  $('#editId').value = editor.id; $('#editTitle').textContent = r ? '编辑这次打卡 / 我的评价' : source ? '再来一次 · 新打卡' : status === 'wishlist' ? '加入想吃清单' : '记下这一顿';
  $('#editSub').textContent = r ? '只修改这一顿；选择已有店铺可以调整归属，不会覆盖其他打卡。' : source ? '沿用店铺信息，日期、人均、评分和照片重新记录。' : mode === 'cloud' ? '选已有店铺可新增打卡；给另一半的同一顿补评价，请打开那条记录。' : '当前记录保存在本机，暂不同步到另一台设备。';
  $('#restaurantName').value = place?.name || ''; $('#city').value = place?.city || ''; $('#category').value = place?.category || '其他';
  renderCategories();
  $('#address').value = place?.address || ''; $('#visitDate').value = r ? r.visit_date || '' : status === 'eaten' ? todayLocal() : '';
  $('#price').value = r?.price_per_person ?? ''; $('#tags').value = (r?.tags || []).join('，');
  $('#favoriteDish').value = rv?.favorite_dish || ''; $('#reviewText').value = rv?.comment || '';
  $('#favoriteToggle').classList.toggle('on', !!rv?.favorite); $('#againToggle').classList.toggle('on', !!rv?.would_return);
  const rateRow = ([key, label]) => `<div class="rate-row"><label for="rate-${key}">${label}</label><input id="rate-${key}" type="range" min="0" max="10" step="0.5" value="${rating(rv?.[key]) ?? 0}" data-rate="${key}" aria-label="${label}评分"><output data-rate-value="${key}">${formatScore(rating(rv?.[key]))}</output></div>`;
  $('#rateRows').innerHTML = CORE_DIMS.map(rateRow).join(''); $('#extraRateRows').innerHTML = EXTRA_DIMS.map(rateRow).join('');
  setStatus(editor.status, false); updateOverall(); renderEditorPhotos(); updatePlaceHint(); $('#photoStatus').textContent = ''; showFormMessage();
  $('#saveRecordBtn').textContent = mode === 'cloud' ? '保存到我们的档案' : '保存到本机档案';
  openSheet('editSheet'); $('#editSheet .sheet').scrollTop = 0;
}
function beginRepeat(id) {
  const row = state.restaurants.find(r => r.id === id); if (!row) return;
  closeSheet('detailSheet', true);
  if (row.status === 'wishlist') { openEditor(id); setStatus('eaten'); $('#visitDate').value = todayLocal(); updatePlaceHint(); }
  else openEditor(null, 'eaten', id);
}
function selectPlace() {
  if (!editor) return;
  const selected = $('#recordPlace').value;
  editor.placeId = selected === 'new' ? editor.newPlaceId : selected; editor.createPlace = selected === 'new'; editor.dirty = true;
  const source = sortRestaurants(state.restaurants.filter(r => (r.place_id || r.id) === selected), state, 'visit')[0];
  if (source && !editor.original) {
    $('#restaurantName').value = source.name; $('#city').value = source.city || ''; $('#address').value = source.address || ''; $('#category').value = source.category || '其他';
  }
  updatePlaceHint();
}
function updatePlaceHint() {
  if (!editor) return;
  $('#placeHint').textContent = editor.createPlace ? '这次会建立独立的店铺档案。同品牌的不同分店请分别建店。' : editor.original ? '仅调整这一顿的店铺归属和内容；其他打卡的照片、评价不改变。' : '本次归入已有店铺，旧打卡保留；请填写这次的人均、评价和照片。';
  const sameDate = !editor.original && !editor.createPlace && state.restaurants.find(r => r.status === 'eaten' && (r.place_id || r.id) === editor.placeId && r.visit_date && r.visit_date === $('#visitDate').value);
  const similar = editor.createPlace && state.restaurants.some(r => r.id !== editor.id && r.name.trim().toLowerCase() === $('#restaurantName').value.trim().toLowerCase());
  $('#placeSuggestion').classList.toggle('hidden', !sameDate && !similar);
  $('#placeSuggestion').innerHTML = sameDate ? `这家店这一天已有打卡。如果是同一顿，请打开原记录补评价；不同顿可以继续保存。<button type="button" class="text-btn" data-existing-visit="${esc(sameDate.id)}">打开当天已有打卡 ›</button>` : similar ? '发现同名店铺：如果是同一家分店，请在上方选择已有店铺，避免建立重复档案。' : '';
}
function setStatus(status, markDirty = true) {
  if (!editor) return;
  if (status === 'wishlist' && editor.original && reviewsFor(state, editor.id).length) return toast('这家店已有评价，保留为“已吃过”以免隐藏评分');
  editor.status = status; if (markDirty) editor.dirty = true;
  $$('[data-status]').forEach(b => b.classList.toggle('on', b.dataset.status === status));
  $('#ratingSection').classList.toggle('hidden', status === 'wishlist');
  $('#priceLabel').textContent = status === 'wishlist' ? '预算人均 ¥' : '实付人均 ¥';
  $('#visitDateLabel').textContent = status === 'wishlist' ? '计划日期（可选）' : '用餐日期（可选）';
  if (markDirty && !editor.original && status === 'eaten' && !$('#visitDate').value) $('#visitDate').value = todayLocal();
}
function updateOverall() { const review = Object.fromEntries(DIMS.map(([key]) => [key, rating($(`[data-rate="${key}"]`)?.value)])); $('#overallScore').textContent = formatScore(reviewScore(review)); }
function existingEditorPhotos() { return state.photos.filter(p => p.restaurant_id === editor?.id && !editor.removed.has(p.id)); }
function renderEditorPhotos() {
  if (!editor) return;
  const existing = existingEditorPhotos(), mine = existing.filter(p => p.user_id === selfId());
  $('#photoCount').textContent = `我的 ${mine.length + editor.added.length}/${MAX_PHOTOS}`;
  $('#photoPreviews').innerHTML = existing.map(p => `<div class="preview">${photoHTML(p)}${p.user_id === selfId() ? `<button type="button" class="remove-photo" data-remove-existing="${esc(p.id)}" aria-label="移除我的照片">×</button>` : '<span class="photo-owner">TA 的照片</span>'}</div>`).join('') + editor.added.map((p, i) => `<div class="preview"><img src="${esc(p.preview)}" alt="待保存的照片"><button type="button" class="remove-photo" data-remove-new="${i}" aria-label="移除新照片">×</button><span class="photo-owner">待保存</span></div>`).join('');
  if (editor.removed.size) $('#photoPreviews').insertAdjacentHTML('beforeend', '<button type="button" class="undo-photos" id="undoPhotoRemoval">撤销移除</button>');
}
async function addPhotos(files) {
  if (!editor || photosBusy || saving) return;
  const draft = editor, capacity = Math.max(0, MAX_PHOTOS - existingEditorPhotos().filter(p => p.user_id === selfId()).length - editor.added.length);
  if (!capacity) return toast(`每人每次打卡最多 ${MAX_PHOTOS} 张照片，先移除几张再添加`);
  photosBusy = true; $('#saveRecordBtn').disabled = true; $('#photoInput').disabled = true; $('#choosePhotos').disabled = true; $('#stashDraft').disabled = true;
  const selected = [...files].slice(0, capacity), errors = [];
  for (let i = 0; i < selected.length; i++) {
    $('#photoStatus').textContent = `正在处理照片 ${i + 1}/${selected.length}…`;
    try {
      const source = selected[i], fingerprint = `${source.name}:${source.size}:${source.lastModified}`;
      if (draft.added.some(p => p.fingerprint === fingerprint)) continue;
      const file = await compressPhoto(source);
      if (draft !== editor) break;
      draft.added.push({ file, fingerprint, preview: URL.createObjectURL(file), path: null, uploaded: false }); draft.dirty = true; renderEditorPhotos();
    } catch (error) { errors.push(`${selected[i].name}：${friendly(error)}`); }
  }
  photosBusy = false; $('#saveRecordBtn').disabled = false; $('#photoInput').disabled = false; $('#choosePhotos').disabled = false; $('#stashDraft').disabled = false; $('#photoInput').value = '';
  $('#photoStatus').textContent = errors.length ? errors.join('；') : `${draft.added.length} 张新照片已就绪，点击底部保存。${files.length > capacity ? `最多还能添加 ${capacity} 张，本次其余照片未添加。` : ''}`;
}
function collectDraft() {
  if (existingEditorPhotos().filter(p => p.user_id === selfId()).length + editor.added.length > MAX_PHOTOS) throw new Error(`每人每次打卡最多 ${MAX_PHOTOS} 张照片，请移除多出的照片`);
  if (state.trash.some(r => r.id === editor.id)) throw new Error('记录已删除，请先从回收站恢复');
  const restaurant = validateRestaurant({ id: editor.id, place_id: editor.placeId, create_place: editor.createPlace, space_id: state.space?.id || 'local-space', name: $('#restaurantName').value.trim(), city: $('#city').value.trim(), category: $('#category').value.trim() || '其他', address: $('#address').value.trim(), visit_date: $('#visitDate').value || null, price_per_person: $('#price').value.trim() === '' ? null : Number($('#price').value), tags: [...new Set($('#tags').value.split(/[，,]/).map(s => s.trim()).filter(Boolean))].slice(0, 20), status: editor.status });
  const review = editor.status === 'eaten' ? { ...Object.fromEntries(DIMS.map(([key]) => [key, rating($(`[data-rate="${key}"]`).value)])), favorite_dish: $('#favoriteDish').value.trim(), comment: $('#reviewText').value.trim(), favorite: $('#favoriteToggle').classList.contains('on'), would_return: $('#againToggle').classList.contains('on') } : null;
  const hasReview = review && (myReview(editor.id) || DIMS.some(([key]) => review[key] !== null) || review.favorite_dish || review.comment || review.favorite || review.would_return);
  return { restaurant, review: hasReview ? review : null, added: editor.added, removed: [...editor.removed], expected: editor.original?.updated_at };
}
async function saveRecord(event) {
  event.preventDefault(); if (!editor || saving || photosBusy || drafts.busy) return;
  if (editor.scope !== `${mode}:${selfId()}:${state.space?.id || ''}`) return showFormMessage('登录状态已变化，请重新打开记录再保存');
  if (mode === 'cloud' && !navigator.onLine) return showFormMessage('当前离线，内容仍保留。恢复网络后再保存');
  let draft; try { draft = collectDraft(); } catch (error) { showFormMessage(friendly(error)); return; }
  if (editor.original && (editor.original.place_id || editor.original.id) !== draft.restaurant.place_id && !window.confirm('确定调整这一次打卡的店铺归属？\n只移动这一顿，双方评价与照片保留，不修改其他打卡。')) return;
  saving = true; showFormMessage(); $$('#recordForm input, #recordForm button, #recordForm textarea, #recordForm select').forEach(el => el.disabled = true);
  const epoch = authEpoch, saveMode = mode, savedEditor = editor, updateProgress = text => $('#saveRecordBtn').textContent = text;
  try {
    if (mode === 'cloud') await repository.save(draft, user.id, updateProgress);
    else {
      updateProgress('正在保存照片和记录…');
      const dataURLs = await Promise.all(draft.added.map(p => blobDataURL(p.file)));
      const next = await mutateLocal(data => {
        if (data.trash.some(r => r.id === draft.restaurant.id)) throw new Error('记录已删除，请先从回收站恢复');
        const current = data.restaurants.find(r => r.id === draft.restaurant.id);
        if (current && current.updated_at !== draft.expected) throw new Error('记录刚刚被修改，请重新打开后再保存');
        if (!draft.restaurant.create_place && ![...data.restaurants, ...data.trash].some(r => (r.place_id || r.id) === draft.restaurant.place_id)) throw new Error('店铺不存在，请重新选择');
        const now = new Date().toISOString(), r = { ...draft.restaurant, created_at: current?.created_at || now, updated_at: now };
        delete r.create_place;
        const reviewId = data.reviews.find(x => x.restaurant_id === r.id && x.user_id === 'local-me')?.id;
        data.restaurants = [r, ...data.restaurants.filter(x => x.id !== r.id)];
        if (draft.review) data.reviews = [...data.reviews.filter(x => !(x.restaurant_id === r.id && x.user_id === 'local-me')), { ...draft.review, id: reviewId || crypto.randomUUID(), restaurant_id: r.id, space_id: 'local-space', user_id: 'local-me', updated_at: now }];
        data.photos = [...data.photos.filter(p => !draft.removed.includes(p.id) || p.user_id !== 'local-me'), ...dataURLs.map(url => ({ id: crypto.randomUUID(), restaurant_id: r.id, user_id: 'local-me', url, created_at: now }))];
      }, state);
      if (epoch === authEpoch) state = next;
    }
    const draftClean = await drafts.committed(savedEditor.scope, savedEditor.id, savedEditor.draftRevision);
    savedEditor.added.forEach(p => URL.revokeObjectURL(p.preview)); editor = null;
    closeSheet('editSheet', true);
    if (epoch !== authEpoch) { render(); toast(saveMode === 'cloud' ? '记录已保存到原账号空间，当前登录状态已变化' : '本机记录已保存，当前登录状态已变化'); }
    else if (mode === 'cloud') {
      try { await refreshCloud(); toast('记录、评价和照片已保存'); } catch { toast('保存已成功，列表同步暂时失败，请点击 ↻ 刷新', 6000); }
    } else { render(); toast('已保存到本机档案'); }
    if (!draftClean && epoch === authEpoch) toast('记录已保存，但旧草稿清理未成功，可在首页删除草稿', 7000);
  } catch (error) { showFormMessage(`${friendly(error)}。本次内容仍在，可重试保存。`); }
  finally { saving = false; $$('#recordForm input, #recordForm button, #recordForm textarea, #recordForm select').forEach(el => el.disabled = false); $('#saveRecordBtn').textContent = mode === 'cloud' ? '保存到我们的档案' : '保存到本机档案'; }
}

async function changeSession(session) {
  const nextUser = session?.user || null;
  if (sessionKnown && user?.id === nextUser?.id) { if (nextUser) scheduleSync(); return; }
  const previousUser = user?.id;
  discardIdentity(); closeSheet('identitySheet', true);
  drafts.reset(); activeTask = 'mine'; closeSheet('tasksSheet', true); renderHTML($('#taskList'), ''); renderHTML($('#taskTabs'), ''); $('#taskSummary').textContent = '';
  discovery.reset(); activeFilter = 'all'; recordView = 'places'; $('#recordSort').value = 'visit';
  sessionKnown = true; authEpoch++; user = nextUser; const epoch = authEpoch;
  if (previousUser && previousUser !== nextUser?.id) clearAccountDrafts(previousUser).catch(() => toast('退出已完成，但本机旧草稿清理未成功，请重新登录后在首页删除草稿', 7000));
  if (realtimeChannel) client.removeChannel(realtimeChannel); realtimeChannel = null; subscribedSpace = null; repository?.urls.clear();
  state = emptyData(); syncStatus = 'loading'; mode = nextUser ? 'cloud' : 'loading';
  if (editor && !saving) { discardEditor(); closeSheet('editSheet', true); }
  // Remove hidden private DOM too, not only the currently visible cards.
  renderHTML($('#detailBody'), ''); photoGallery.close(false);
  for (const id of [...DRAFT_FIELDS, 'editId', 'nicknameInput', 'joinCode', 'newSpaceName']) $('#' + id).value = '';
  for (const id of ['photoPreviews', 'recordPlace', 'rateRows', 'extraRateRows', 'avatarPreview']) $('#' + id).replaceChildren();
  $('#avatarCrop').getContext('2d').clearRect(0, 0, $('#avatarCrop').width, $('#avatarCrop').height);
  $('#photoInput').value = ''; $('#avatarInput').value = ''; $('#favoriteToggle').classList.remove('on'); $('#againToggle').classList.remove('on');
  $('#photoStatus').textContent = ''; $('#avatarMessage').textContent = ''; $('#overallScore').textContent = '未评'; showFormMessage();
  detailId = null; closeSheet('detailSheet', true); $('#photoViewer').classList.add('hidden'); render();
  if (nextUser) {
    try { await refreshCloud(); } catch { /* Banner provides retry. */ }
  } else {
    try { const local = await loadLocal(); if (epoch !== authEpoch) return; state = local; mode = 'local'; syncStatus = 'ready'; }
    catch (error) { if (epoch !== authEpoch) return; mode = 'local'; syncStatus = 'error'; toast(friendly(error)); }
    render();
  }
}
function refreshCloud() {
  if (!user || !repository) return Promise.resolve();
  const account = user.id, epoch = authEpoch, repo = repository;
  const operation = async () => {
    if (epoch !== authEpoch) return;
    try {
      const next = await repo.load(account);
      if (epoch !== authEpoch) return;
      const me = next.members.find(m => m.user_id === account), other = next.members.find(m => m.user_id !== account);
      const incoming = { ...emptyData(), ...next, nickname: me?.nickname || state.nickname || '我', partnerName: other?.nickname || 'TA' };
      const changed = JSON.stringify(incoming) !== JSON.stringify(state), recovered = syncStatus !== 'ready';
      state = incoming; syncStatus = 'ready';
      if (changed || recovered) render(); else renderHeader();
      subscribeRealtime(); repo.cleanup(account); repo.cleanupAvatars(account);
    } catch (error) { if (epoch === authEpoch) { syncStatus = 'error'; renderHeader(); renderProfile(); } throw error; }
  };
  syncChain = syncChain.catch(() => {}).then(operation); return syncChain;
}
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => refreshCloud().catch(() => {}), 200); }
function subscribeRealtime() {
  if (!state.space || !user || subscribedSpace === state.space.id) return;
  if (realtimeChannel) client.removeChannel(realtimeChannel);
  subscribedSpace = state.space.id;
  realtimeChannel = client.channel(`food-map-${subscribedSpace}`);
  const epoch = authEpoch;
  for (const table of ['restaurants', 'reviews', 'food_photos', 'space_members']) realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `space_id=eq.${subscribedSpace}` }, scheduleSync);
  // Joining the socket precedes the Postgres listener becoming ready. Refetch across that gap.
  realtimeChannel.on('system', {}, () => { if (epoch === authEpoch) scheduleSync(); });
  realtimeChannel.subscribe(status => { if (epoch === authEpoch && ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) scheduleSync(); });
}
async function initCloud() {
  try {
    let cfg = DEFAULT_CONFIG;
    try { cfg = { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem('couple_food_supabase_config_v1') || '{}') }; } catch { /* Use deployed defaults. */ }
    if (!window.supabase) throw new Error('登录组件加载失败，请刷新页面');
    client = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    repository = new CloudRepository(client);
    const { data, error } = await client.auth.getSession(); if (error) throw error;
    await changeSession(data.session);
    client.auth.onAuthStateChange((_event, session) => { setTimeout(() => changeSession(session), 0); });
  } catch (error) { toast(friendly(error)); if (!sessionKnown) { mode = 'loading'; syncStatus = 'error'; renderHeader(); } }
}
async function buttonAction(button, fn, busyText = '请稍候…') {
  if (button.disabled) return;
  const text = button.textContent; button.disabled = true; button.textContent = busyText;
  try { return await fn(); } catch (error) { toast(friendly(error), 5500); }
  finally { button.disabled = false; button.textContent = text; }
}
async function sendEmailCode() {
  if (!client) return toast('登录组件尚未就绪，请刷新');
  if (Date.now() < cooldownUntil) return;
  const email = $('#loginEmail').value.trim(); if (!email || !$('#loginEmail').reportValidity()) return toast('请输入有效邮箱');
  await buttonAction($('#sendEmailCode'), async () => {
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }); if (error) throw error;
    sessionStorage.setItem(LOGIN_EMAIL_KEY, email); $('#otpLoginBox').classList.remove('hidden'); $('#loginOtp').value = ''; $('#loginOtp').focus(); cooldownUntil = Date.now() + 60000; toast('验证码已发送，请查看邮箱');
  }, '正在发送…'); updateCooldown();
}
function updateCooldown() {
  const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  if (seconds || $('#sendEmailCode').dataset.cooldown === 'yes') {
    $('#sendEmailCode').disabled = seconds > 0; $('#sendEmailCode').textContent = seconds ? `${seconds} 秒后可重发` : '重新发送验证码'; $('#sendEmailCode').dataset.cooldown = seconds ? 'yes' : 'no';
  }
}
async function verifyEmailCode() {
  const email = $('#loginEmail').value.trim(), token = $('#loginOtp').value.trim();
  if (!client || !email || !/^\d{6,8}$/.test(token)) return toast('请输入邮箱和邮件中的完整数字验证码');
  await buttonAction($('#verifyEmailCode'), async () => {
    const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' }); if (error) throw error;
    sessionStorage.removeItem(LOGIN_EMAIL_KEY); await changeSession(data.session); closeSheet('cloudSheet'); toast('登录成功'); if (!state.space) openSheet('coupleSheet');
  }, '正在登录…');
}
async function spaceAction(join) {
  if (!client || !user) return openSheet('cloudSheet');
  await buttonAction($(join ? '#joinSpaceBtn' : '#createSpaceBtn'), async () => {
    const args = join ? { p_code: $('#joinCode').value.trim().toUpperCase(), p_nickname: state.nickname || '我' } : { p_name: $('#newSpaceName').value.trim() || '我们的美食地图', p_nickname: state.nickname || '我' };
    if (join && !args.p_code) throw new Error('请输入邀请码');
    const { error } = await client.rpc(join ? 'join_space_by_code' : 'create_space', args); if (error) throw error;
    await refreshCloud(); toast(join ? '已加入共同空间' : '空间已创建，把邀请码发给另一半');
  });
}
function discardIdentity() {
  if (!identity) return;
  identity.crop?.dispose();
  if (identity.path) repository?.queueAvatarCleanup(identity.path, identity.ownerId);
  identity = null;
}
function openIdentity() {
  discardIdentity();
  identity = { ownerId: selfId(), spaceId: state.space?.id, epoch: authEpoch, expectedPath: state.members.find(m => m.user_id === selfId())?.avatar_path || null, expectedName: state.nickname, expectedLocal: state.avatar_url || '', dirty: false, removed: false };
  $('#nicknameInput').value = state.nickname || '';
  $('#avatarPreview').innerHTML = avatarHTML(avatarURL(selfId()), state.nickname);
  $('#avatarPreview').classList.remove('hidden'); $('#avatarCrop').classList.add('hidden'); $('#avatarControls').classList.add('hidden');
  $('#avatarMessage').textContent = ''; $('#avatarInput').value = '';
  $('#avatarPrivacy').textContent = mode === 'cloud' ? '头像仅在你们的私有空间内使用；先加入空间即可保存。' : '当前为本机模式，头像仅保存在这台设备；不会自动上传。';
}
function lockIdentity(locked) { $$('#identitySheet input, #identitySheet button').forEach(el => { el.disabled = locked; }); }
async function chooseAvatar(file) {
  if (!file || !identity || avatarBusy || profileSaving) return;
  const draft = identity; avatarBusy = true; lockIdentity(true); $('#avatarMessage').textContent = '正在处理照片…';
  try {
    const crop = await loadAvatar(file);
    if (identity !== draft || draft.epoch !== authEpoch) { crop.dispose(); return; }
    draft.crop?.dispose(); draft.crop = crop; draft.removed = false; draft.dirty = true;
    $('#avatarZoom').value = '1'; $('#avatarX').value = $('#avatarY').value = '.5';
    $('#avatarPreview').classList.add('hidden'); $('#avatarCrop').classList.remove('hidden'); $('#avatarControls').classList.remove('hidden');
    updateAvatarCrop(); $('#avatarMessage').textContent = '预览已就绪，调整好后点击“保存头像与昵称”。';
  } catch (error) { if (identity === draft) $('#avatarMessage').textContent = friendly(error); }
  finally { avatarBusy = false; lockIdentity(false); $('#avatarInput').value = ''; }
}
function invalidateAvatarUpload() {
  if (!identity) return;
  if (identity.path) repository?.queueAvatarCleanup(identity.path, identity.ownerId);
  identity.path = null; identity.file = null; identity.uploaded = false;
}
function updateAvatarCrop() {
  if (!identity?.crop) return;
  invalidateAvatarUpload(); identity.dirty = true;
  drawAvatar($('#avatarCrop'), identity.crop.image, Number($('#avatarZoom').value), Number($('#avatarX').value), Number($('#avatarY').value));
  $('#avatarZoomValue').textContent = `${Number($('#avatarZoom').value).toFixed(1)}×`;
}
function removeAvatar() {
  if (!identity || profileSaving || avatarBusy) return;
  invalidateAvatarUpload(); identity.crop?.dispose(); identity.crop = null; identity.removed = true; identity.dirty = true;
  $('#avatarPreview').innerHTML = avatarHTML('', $('#nicknameInput').value); $('#avatarPreview').classList.remove('hidden');
  $('#avatarCrop').classList.add('hidden'); $('#avatarControls').classList.add('hidden');
  $('#avatarMessage').textContent = '保存后将恢复为昵称头像。';
}
async function saveNickname() {
  if (!identity || avatarBusy || profileSaving || mode === 'loading') return;
  const draft = identity, name = $('#nicknameInput').value.trim(), operationMode = mode;
  if (!name || name.length > 40) return toast('请输入 1–40 字的昵称');
  profileSaving = true; lockIdentity(true); $('#avatarMessage').textContent = '正在保存…';
  try {
    if (draft.crop && !draft.file) draft.file = await avatarFile($('#avatarCrop'));
    if (draft.epoch !== authEpoch) return;
    if (operationMode === 'cloud') {
      if (!draft.spaceId) throw new Error('请先加入情侣空间，再设置云端头像');
      if (!navigator.onLine) throw new Error('当前离线，照片已保留，请联网后重试保存');
      await repository.saveProfile(draft, name, draft.ownerId);
      if (draft.epoch !== authEpoch) return;
      draft.path = null; discardIdentity(); closeSheet('identitySheet', true);
      try { await refreshCloud(); } catch { toast('头像和昵称已保存，显示同步待重试，请点右上角刷新', 6000); return; }
    } else {
      const url = draft.removed ? '' : draft.file ? await blobDataURL(draft.file) : draft.expectedLocal;
      const next = await mutateLocal(data => {
        if (data.nickname !== draft.expectedName || (data.avatar_url || '') !== draft.expectedLocal) throw new Error('头像或昵称已在另一页面修改，请关闭后重新打开设置');
        data.nickname = name; data.avatar_url = url;
      }, state);
      if (draft.epoch !== authEpoch) return;
      state = next; discardIdentity(); closeSheet('identitySheet', true); render();
    }
    toast('头像和昵称已保存');
  } catch (error) { if (identity === draft) $('#avatarMessage').textContent = `${friendly(error)}。本次修改仍保留，可重试。`; }
  finally { profileSaving = false; lockIdentity(false); }
}
async function refreshManual() {
  await buttonAction($('#refreshBtn'), async () => {
    if (!sessionKnown) await initCloud();
    else if (mode === 'cloud') { repository.urls.clear(); await refreshCloud(); }
    else { state = await loadLocal(); syncStatus = 'ready'; render(); }
    toast('成员、记录和照片已刷新');
  }, '…');
}
async function copyInvite() {
  try { await navigator.clipboard.writeText(state.space.invite_code); toast('邀请码已复制'); }
  catch { toast(`邀请码：${state.space?.invite_code || ''}，可长按上方邀请码复制`, 6500); }
}
async function exportBackup() {
  await buttonAction($('#exportBtn'), async () => {
    const snapshot = structuredClone(state), exportSelf = selfId(); let unavailable = 0;
    snapshot.avatar_url = avatarURL(exportSelf) || '';
    snapshot.partner_avatar_url = avatarURL(state.members.find(m => m.user_id !== exportSelf)?.user_id || 'local-partner') || '';
    for (const key of ['avatar_url', 'partner_avatar_url']) {
      if (!snapshot[key] || snapshot[key].startsWith('data:')) continue;
      try { const res = await fetch(snapshot[key]); if (!res.ok) throw new Error('Missing avatar'); snapshot[key] = await blobDataURL(await res.blob()); }
      catch { snapshot[key] = ''; unavailable++; }
    }
    snapshot.members.forEach(m => { delete m.avatar_url; delete m.avatar_path; });
    for (const p of snapshot.photos) {
      try { if (!p.url) throw new Error('Missing photo'); if (!p.url.startsWith('data:')) { const res = await fetch(p.url); if (!res.ok) throw new Error('Missing photo'); p.url = await blobDataURL(await res.blob()); } }
      catch { p.url = ''; p.unavailable = true; unavailable++; }
    }
    const content = { version: 2, kind: 'food-map-backup', self_id: exportSelf, exported_at: new Date().toISOString(), unavailable_photos: unavailable, data: snapshot };
    const url = URL.createObjectURL(new Blob([JSON.stringify(content)], { type: 'application/json' })), a = document.createElement('a');
    a.href = url; a.download = `美食地图-${todayLocal()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast(unavailable ? `备份已导出；${unavailable} 张照片无法读取，备份保留了对应记录但没有图片内容` : '完整备份已导出', 7000);
  }, '正在打包记录和照片…');
}
async function importBackup(file) {
  if (!file) return;
  try {
    if (mode !== 'local' || user) throw new Error('请在退出登录后的本机模式导入');
    if (file.size > 100 * 1024 * 1024) throw new Error('备份文件不能超过 100 MB');
    const imported = validateBackup(JSON.parse(await file.text()));
    if (mode !== 'local' || user) throw new Error('登录状态已变化，请重新导入');
    const epoch = authEpoch;
    const merge = (a, b, key) => { const known = new Set(a.map(key)); return [...a, ...b.filter(x => { const id = key(x); if (known.has(id)) return false; known.add(id); return true; })]; };
    const next = await mutateLocal(data => {
      const knownRecords = new Set([...data.restaurants, ...data.trash].map(r => r.id));
      data.restaurants = merge(data.restaurants, imported.restaurants.filter(r => !knownRecords.has(r.id)), r => r.id);
      data.trash = merge(data.trash, imported.trash.filter(r => !knownRecords.has(r.id)), r => r.id);
      data.reviews = merge(data.reviews, imported.reviews, r => `${r.restaurant_id}:${r.user_id}`);
      data.photos = merge(data.photos, imported.photos, p => p.id);
      if (!data.avatar_url) data.avatar_url = imported.avatar_url;
      if (!data.partner_avatar_url) data.partner_avatar_url = imported.partner_avatar_url;
    }, state);
    if (epoch !== authEpoch) return; state = next; render(); toast('备份已合并到本机，原有同编号记录保持不变');
  } catch (error) { toast(friendly(error), 6500); } finally { $('#importInput').value = ''; }
}
function randomPick() {
  discovery.openDecision();
}
function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function updateInstallUI() {
  const installed = isStandalone(), apple = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('#installBadge').textContent = installed ? '已安装' : '添加桌面';
  $('#installStatus').textContent = installed ? '当前已经通过桌面图标独立运行。' : deferredInstallPrompt ? '可以直接安装，之后从桌面图标打开。' : apple ? '在 Safari 的分享菜单里选择“添加到主屏幕”。' : '在 Chrome 菜单中选择“安装应用”或“添加到主屏幕”。';
  $('#installAppBtn').textContent = installed ? '已经安装' : deferredInstallPrompt ? '立即安装' : '查看安装方法'; $('#installAppBtn').disabled = installed;
}
async function installApp() {
  if (!deferredInstallPrompt) return toast('请按照下方对应手机的步骤添加到桌面');
  await deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; updateInstallUI();
}

const DRAFT_FIELDS = ['restaurantName', 'city', 'category', 'address', 'visitDate', 'price', 'tags', 'favoriteDish', 'reviewText'];
function captureEditorDraft() {
  if (!editor || saving || photosBusy) throw new Error('照片或记录仍在处理，请稍候');
  return { id: editor.id, original: editor.original, status: editor.status, placeId: editor.placeId, newPlaceId: editor.newPlaceId, createPlace: editor.createPlace,
    fields: Object.fromEntries(DRAFT_FIELDS.map(id => [id, $('#' + id).value])), rates: Object.fromEntries(DIMS.map(([key]) => [key, $(`[data-rate="${key}"]`).value])),
    favorite: $('#favoriteToggle').classList.contains('on'), again: $('#againToggle').classList.contains('on'), removed: [...editor.removed], added: editor.added.map(p => ({ file: p.file, fingerprint: p.fingerprint })) };
}
function restoreEditorDraft(saved) {
  if (editor?.dirty && !window.confirm('放弃当前编辑内容，继续已暂存的草稿？')) return;
  const draft = saved.payload, current = state.restaurants.find(r => r.id === draft.id);
  openEditor(current?.id || null, draft.status); if (!editor) return;
  Object.assign(editor, { id: draft.id, original: draft.original, placeId: draft.placeId, newPlaceId: draft.newPlaceId, createPlace: draft.createPlace, removed: new Set(draft.removed), dirty: true, draftRevision: saved.revision });
  editor.added = draft.added.map(p => ({ file: p.file, fingerprint: p.fingerprint, preview: URL.createObjectURL(p.file), path: null, uploaded: false }));
  $('#editId').value = draft.id;
  if (!draft.createPlace && ![...$('#recordPlace').options].some(o => o.value === draft.placeId)) $('#recordPlace').add(new Option('原草稿关联的店铺（当前不可用）', draft.placeId));
  $('#recordPlace').value = draft.createPlace ? 'new' : draft.placeId;
  DRAFT_FIELDS.forEach(id => $('#' + id).value = draft.fields[id] || '');
  DIMS.forEach(([key]) => { const value = rating(draft.rates?.[key]); $(`[data-rate="${key}"]`).value = value ?? 0; $(`[data-rate-value="${key}"]`).textContent = formatScore(value); });
  $('#favoriteToggle').classList.toggle('on', !!draft.favorite); $('#againToggle').classList.toggle('on', !!draft.again);
  setStatus(draft.status, false); updateOverall(); renderEditorPhotos(); updatePlaceHint();
  $('#editTitle').textContent = '继续未完成的草稿';
  const stale = draft.original && (!current || draft.original.updated_at !== current.updated_at);
  showFormMessage(stale ? '原记录已变化或被删除，草稿内容已恢复供查看，但不能直接覆盖新版本。请保留需要的文字，重新打开最新记录后修改。' : '已恢复本机草稿。点击正式保存后才会写入档案；关闭编辑不会删除这份暂存版本。');
}
function renderTasks() {
  const report = recordTasks(state, selfId()), labels = Object.fromEntries(TASK_KINDS);
  $('#taskHomeSummary').textContent = report.rows.length ? `${report.rows.length} 条待完善 · ${report.counts.mine} 次等我评分` : '食记已整理好，去回味下一顿 ›';
  if (!$('#tasksSheet').classList.contains('open')) return;
  renderHTML($('#taskTabs'), [['all', '全部'], ...TASK_KINDS].map(([key, title]) => `<button type="button" data-task-filter="${key}" aria-pressed="${activeTask === key}" class="${activeTask === key ? 'on' : ''}">${title}<b>${key === 'all' ? report.rows.length : report.counts[key]}</b></button>`).join(''));
  const rows = report.rows.filter(row => activeTask === 'all' || row.tasks.includes(activeTask));
  $('#taskSummary').textContent = `${rows.length} 条记录。每条可有多个待补项；人均 0 元算已填写。只提示、不代填、不向对方发送消息。照片提示包含暂时无法签名的情况，可先刷新重试。`;
  renderHTML($('#taskList'), rows.map(({ restaurant: r, tasks }) => `<article class="task-card" data-task-record="${esc(r.id)}"><h4>${esc(r.name)}</h4><p>${esc([r.visit_date || (r.status === 'wishlist' ? '想吃计划' : '未填日期'), r.city, r.category].filter(Boolean).join(' · '))}</p><div class="task-badges">${tasks.map(key => `<span>${labels[key]}</span>`).join('')}</div><div class="task-actions"><button type="button" class="text-btn" data-detail="${esc(r.id)}">查看这一顿</button>${activeTask === 'partner' ? '' : `<button type="button" class="secondary" data-task-edit="${esc(r.id)}">${activeTask === 'mine' || (activeTask === 'all' && tasks.includes('mine')) ? '补我的评价' : '补充记录'}</button>`}</div></article>`).join('') || '<div class="empty"><h3>这一项已经整理好</h3><p>有新的待补内容时，会自动出现在这里。</p></div>');
}
const discovery = new DiscoveryUI({ getState: () => state, selfId, renderHTML, esc, cardHTML, photoHTML, openSheet, closeSheet, renderRecords, switchPage, toast, getEpoch: () => authEpoch });
const photoGallery = new PhotoGallery({ getState: () => state, getEpoch: () => authEpoch, getRepository: () => repository,
  isCloud: () => mode === 'cloud', ownerName, toast, onError: error => toast(friendly(error)), onVisibilityChange: () => dialogs.sync(),
  updatePhoto: photo => { state.photos = state.photos.map(p => p.id === photo.id ? photo : p); render(); } });
const dialogs = new DialogController({ getOverlay: () => photoGallery.visible ? photoGallery.root : null });
const drafts = new DraftUI({ getScope: () => mode === 'local' ? 'local:local-me:' : mode === 'cloud' && state.space && user ? `cloud:${user.id}:${state.space.id}` : null,
  getEpoch: () => authEpoch, getEditor: () => !saving && !photosBusy ? editor : null, capture: captureEditorDraft, restore: restoreEditorDraft,
  lock: value => $$('#recordForm input, #recordForm button, #recordForm textarea, #recordForm select').forEach(el => el.disabled = value),
  afterStash: () => { discardEditor(); closeSheet('editSheet', true); closeSheet('detailSheet', true); switchPage('home'); }, toast, message: showFormMessage });
document.addEventListener('click', event => {
  const target = event.target.closest('button, [data-open], [data-close], [data-filter-go], [data-go]'); if (!target || target.disabled) return;
  if (target.dataset.photo) return photoGallery.open(target.dataset.photo);
  if (target.dataset.taskFilter) { activeTask = target.dataset.taskFilter; return renderTasks(); }
  if (target.dataset.taskEdit) { closeSheet('tasksSheet', true); return openEditor(target.dataset.taskEdit); }
  if (target.dataset.copyPlace) { const r = state.restaurants.find(row => row.id === target.dataset.copyPlace); if (r) discovery.openCopy(r); return; }
  if (target.dataset.detail) return showDetail(target.dataset.detail);
  if (target.dataset.repeat) return beginRepeat(target.dataset.repeat);
  if (target.dataset.existingVisit) {
    if (editor?.dirty && !window.confirm('放弃当前未保存的内容，打开已有打卡？')) return;
    discardEditor(); closeSheet('editSheet', true); return showDetail(target.dataset.existingVisit);
  }
  if (target.dataset.recordView) { recordView = target.dataset.recordView; return renderRecords(); }
  if (target.dataset.delete) return setRecordDeleted(target.dataset.delete, true, target);
  if (target.dataset.restore) return setRecordDeleted(target.dataset.restore, false, target);
  if (target.dataset.edit) { const id = target.dataset.edit; closeSheet('detailSheet'); return openEditor(id); }
  if (target.hasAttribute('data-add')) return openEditor();
  if (target.hasAttribute('data-add-wish')) return openEditor(null, 'wishlist');
  if (target.dataset.nav) return switchPage(target.dataset.nav);
  if (target.dataset.go) return switchPage(target.dataset.go);
  if (target.dataset.filterGo) { discovery.resetRecordFilters(); activeFilter = target.dataset.filterGo; renderRecords(); return switchPage('records'); }
  if (target.dataset.filter) { activeFilter = target.dataset.filter; return renderRecords(); }
  if (target.dataset.rank) { rankKey = target.dataset.rank; return renderRank(); }
  if (target.dataset.close) return closeSheet(target.dataset.close);
  if (target.dataset.open) return openSheet(target.dataset.open + 'Sheet');
  if (target.hasAttribute('data-open-cloud')) { closeSheet('coupleSheet'); return openSheet('cloudSheet'); }
  if (target.dataset.quick) return ({ add: () => openEditor(), wish: () => openEditor(null, 'wishlist'), random: randomPick, stats: () => switchPage('rank') })[target.dataset.quick]?.();
  if (target.dataset.status) return setStatus(target.dataset.status);
  if (target.dataset.removeExisting && editor) { editor.removed.add(target.dataset.removeExisting); editor.dirty = true; return renderEditorPhotos(); }
  if (target.dataset.removeNew !== undefined && editor) { const [p] = editor.added.splice(Number(target.dataset.removeNew), 1); URL.revokeObjectURL(p.preview); if (p.path) repository?.queueCleanup([p.path], selfId()); editor.dirty = true; return renderEditorPhotos(); }
  if (target.id === 'undoPhotoRemoval' && editor) { editor.removed.clear(); return renderEditorPhotos(); }
});
document.addEventListener('error', event => {
  const img = event.target; if (img.tagName !== 'IMG') return;
  if (img.id === 'viewerImage') photoGallery.failed();
  else if (img.dataset.image) { img.hidden = true; img.parentElement.querySelector('.photo-placeholder')?.classList.remove('hidden'); }
  else { img.hidden = true; }
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (photoGallery.visible) photoGallery.close();
    else { const open = dialogs.top(); if (open) closeSheet(open.id); }
  }
  if (['Enter', ' '].includes(event.key) && event.target.matches('[data-open]:not(button)')) { event.preventDefault(); event.target.click(); }
});
$$('.setting-row[data-open]').forEach(row => { row.setAttribute('role', 'button'); row.tabIndex = 0; });
$$('.sheet-wrap').forEach(wrap => wrap.addEventListener('click', event => { if (event.target === wrap) closeSheet(wrap.id); }));
$('#mainAdd').onclick = () => openEditor(); $('#syncBtn').onclick = () => openSheet('cloudSheet'); $('#refreshBtn').onclick = refreshManual;
$('#searchInput').oninput = renderRecords; $('#recordSort').onchange = renderRecords;
$('#searchInput').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } };
$('#recordPlace').onchange = selectPlace;
$('#recordForm').onsubmit = saveRecord;
$('#recordForm').addEventListener('input', event => {
  if (!editor) return; editor.dirty = true;
  if (['restaurantName', 'visitDate'].includes(event.target.id)) updatePlaceHint();
  if (event.target.dataset.rate) { const input = event.target; if (Number(input.value) > 0 && Number(input.value) < 1) input.value = 1; $(`[data-rate-value="${input.dataset.rate}"]`).textContent = formatScore(rating(input.value)); updateOverall(); }
});
$('#photoInput').onchange = event => addPhotos(event.target.files);
$('#choosePhotos').onclick = () => $('#photoInput').click();
$('#chooseAvatar').onclick = () => $('#avatarInput').click();
$('#avatarInput').onchange = event => chooseAvatar(event.target.files[0]);
$('#removeAvatar').onclick = removeAvatar;
['avatarZoom', 'avatarX', 'avatarY'].forEach(id => $('#' + id).oninput = updateAvatarCrop);
$('#nicknameInput').oninput = () => { if (identity) identity.dirty = true; };
['favoriteToggle', 'againToggle'].forEach(id => $('#' + id).onclick = () => { $('#' + id).classList.toggle('on'); if (editor) editor.dirty = true; });
$('#sendEmailCode').onclick = sendEmailCode; $('#verifyEmailCode').onclick = verifyEmailCode; $('#loginOtp').onkeydown = event => { if (event.key === 'Enter') verifyEmailCode(); };
$('#createSpaceBtn').onclick = () => spaceAction(false); $('#joinSpaceBtn').onclick = () => spaceAction(true); $('#saveNickname').onclick = saveNickname; $('#copyInviteBtn').onclick = copyInvite;
$('#refreshMembers').onclick = () => buttonAction($('#refreshMembers'), async () => { await refreshCloud(); toast('成员状态已更新'); });
$('#logoutBtn').onclick = () => buttonAction($('#logoutBtn'), async () => { if (saving || profileSaving || drafts.busy) throw new Error('请等待保存完成后再退出'); await clearAccountDrafts(user?.id); const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; await changeSession(null); closeSheet('cloudSheet'); toast('已退出此设备，切换到本机档案'); });
$('#exportBtn').onclick = exportBackup; $('#importInput').onchange = event => importBackup(event.target.files[0]);
$('#importLabel').onclick = () => $('#importInput').click();
$('#installAppBtn').onclick = installApp;
window.addEventListener('beforeunload', event => { if (saving || photosBusy || editor?.dirty || profileSaving || avatarBusy || identity?.dirty || drafts.busy) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', () => { renderHeader(); if (user) scheduleSync(); }); window.addEventListener('offline', renderHeader);
document.addEventListener('visibilitychange', () => { if (!document.hidden && user && navigator.onLine) scheduleSync(); });
// Keep visible pages current even if the WebSocket silently misses an event or reconnects.
setInterval(() => { if (!document.hidden && user && navigator.onLine) scheduleSync(); }, 20000);
setInterval(updateCooldown, 1000);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; updateInstallUI(); });
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; updateInstallUI(); toast('已添加到手机桌面'); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./service-worker.js').then(reg => reg.update()).catch(() => {});
const pending = sessionStorage.getItem(LOGIN_EMAIL_KEY); if (pending) { $('#loginEmail').value = pending; $('#otpLoginBox').classList.remove('hidden'); }
render(); initCloud();

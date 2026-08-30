'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  data: null,
  selectedTags: new Set(),
  filterMode: 'and',
  listFilter: 'all',
  search: '',
  sort: 'recent',
  viewMode: localStorage.getItem('comic_view_mode') === 'single' ? 'single' : 'series', // 默认全集
  detailId: null,
  seriesDetail: null,
  backToSeries: null,
  settingsOpen: false,
  tagsOpen: false,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

// ---------- 数据加载 ----------
async function load() {
  try {
    state.data = await api('/api/state');
    render();
  } catch (e) {
    showToast('加载失败：' + e.message);
  }
}

// ---------- 工具 ----------
function comicTitle(c) {
  return c.series ? c.series + '-' + c.name : c.name;
}

function seriesByName(name) {
  return (state.data.series || []).find((s) => s.name === name) || { name, tags: [] };
}

function seriesVolumes(name) {
  return state.data.comics
    .filter((c) => c.series === name)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

// 视图项：单本 = 每个单卷；全集 = 系列聚合卡片 + 独立单本
function buildItems() {
  if (!state.data) return [];
  if (state.viewMode === 'single') {
    return state.data.comics.map((c) => ({ kind: 'comic', comic: c }));
  }
  const items = [];
  const bySeries = new Map();
  for (const c of state.data.comics) {
    if (c.series) {
      if (!bySeries.has(c.series)) bySeries.set(c.series, []);
      bySeries.get(c.series).push(c);
    } else {
      items.push({ kind: 'comic', comic: c });
    }
  }
  for (const [name, vols] of bySeries) {
    vols.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    items.push({ kind: 'series', series: seriesByName(name), first: vols[0], volumes: vols });
  }
  return items;
}

function itemTitle(it) {
  if (it.kind === 'comic') return comicTitle(it.comic);
  return it.series.name + '-' + it.first.name; // 用第一本的名称展示
}

function itemTags(it) {
  if (it.kind === 'comic') return it.comic.tags;
  const set = new Set();
  for (const v of it.volumes) for (const t of v.tags) set.add(t);
  return [...set];
}

function itemSearchText(it) {
  if (it.kind === 'comic') {
    const c = it.comic;
    return (comicTitle(c) + ' ' + (c.series || '') + ' ' + c.name).toLowerCase();
  }
  return (it.series.name + ' ' + it.volumes.map((v) => v.name).join(' ') + ' ' + itemTitle(it)).toLowerCase();
}

function itemRecent(it) {
  if (it.kind === 'comic') return it.comic.addedAt || '';
  return it.series.addedAt || '';
}

function filteredItems() {
  let list = buildItems();
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter((it) => itemSearchText(it).includes(q));
  if (state.listFilter === 'untagged') list = list.filter((it) => itemTags(it).length === 0);
  if (state.selectedTags.size > 0) {
    const sel = [...state.selectedTags];
    list = list.filter((it) => {
      const tags = itemTags(it);
      return state.filterMode === 'and'
        ? sel.every((t) => tags.includes(t))
        : sel.some((t) => tags.includes(t));
    });
  }
  if (state.sort === 'name') {
    list = [...list].sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), 'zh-CN'));
  } else {
    list = [...list].sort((a, b) => itemRecent(b).localeCompare(itemRecent(a)));
  }
  return list;
}

// 当前视图下的标签统计（用于标签栏与计数）
function tagStats() {
  const items = buildItems();
  const map = new Map();
  let untagged = 0;
  let seriesCount = 0;
  for (const it of items) {
    if (it.kind === 'series') seriesCount++;
    const tags = itemTags(it);
    if (!tags.length) untagged++;
    for (const t of tags) map.set(t, (map.get(t) || 0) + 1);
  }
  return { map, untagged, total: items.length, seriesCount };
}

// ---------- 渲染 ----------
function render() {
  const d = state.data;
  if (!d) return;
  if (!d.configured) {
    renderSetup();
    renderModalRoot();
    return;
  }
  renderViewToggle();
  renderTagbar();
  renderGrid();
  renderCountline();
  renderModalRoot();
}

function renderDynamic() {
  if (!state.data || !state.data.configured) return;
  renderViewToggle();
  renderTagbar();
  renderGrid();
  renderCountline();
}

function renderViewToggle() {
  for (const btn of document.querySelectorAll('.view-toggle [data-view]')) {
    btn.classList.toggle('on', btn.dataset.view === state.viewMode);
  }
}

function renderSetup() {
  $('#tagbar').innerHTML = '';
  $('#countline').textContent = '';
  $('#grid').innerHTML = `
    <div class="setup-panel">
      <div class="setup-icon">📚</div>
      <h2>还没有设置漫画库路径</h2>
      <p>点击「设置」，粘贴你保存漫画的总文件夹完整路径。</p>
      <button class="btn primary" id="goto-settings">打开设置</button>
    </div>`;
  $('#empty').classList.add('hidden');
}

function renderTagbar() {
  const d = state.data;
  const stats = tagStats();
  const chips = [
    `<button class="chip${state.listFilter === 'all' ? ' on' : ''}" data-filter="all">全部</button>`,
    `<button class="chip${state.listFilter === 'untagged' ? ' on' : ''}" data-filter="untagged">未分类 (${stats.untagged})</button>`,
  ];
  for (const t of d.tags) {
    const count = stats.map.get(t.name) || 0;
    chips.push(
      `<button class="chip${state.selectedTags.has(t.name) ? ' on' : ''}" data-tag="${esc(t.name)}">${esc(t.name)} (${count})</button>`
    );
  }
  const mode = `
    <div class="mode-toggle">
      <span class="mode-label">筛选</span>
      <button class="seg${state.filterMode === 'and' ? ' on' : ''}" data-mode="and">AND</button>
      <button class="seg${state.filterMode === 'or' ? ' on' : ''}" data-mode="or">OR</button>
    </div>`;
  $('#tagbar').innerHTML = chips.join('') + mode;
}

function renderGrid() {
  const list = filteredItems();
  const grid = $('#grid');
  const empty = $('#empty');
  if (list.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = state.data.comics.length
      ? '没有符合筛选条件的漫画。'
      : '漫画库还是空的。把漫画文件夹放进库里后，点右上角 ⟳ 刷新。';
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = list.map((it) => it.kind === 'series' ? renderSeriesCard(it) : renderComicCard(it.comic)).join('');
}

function renderComicCard(c) {
  const tags = c.tags.slice(0, 3).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('');
  const more = c.tags.length > 3 ? `<span class="mini-tag more">+${c.tags.length - 3}</span>` : '';
  const thumb = c.hasCover
    ? `<img class="thumb" loading="lazy" src="/api/cover?id=${encodeURIComponent(c.id)}" alt="">`
    : '<div class="thumb placeholder">📕</div>';
  return `
    <div class="card" data-id="${esc(c.id)}">
      <div class="card-cover">${thumb}</div>
      <div class="card-name">${esc(comicTitle(c))}</div>
      <div class="card-tags">${tags}${more}</div>
    </div>`;
}

function renderSeriesCard(it) {
  const all = itemTags(it);
  const tags = all.slice(0, 3).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('');
  const more = all.length > 3 ? `<span class="mini-tag more">+${all.length - 3}</span>` : '';
  const thumb = it.first.hasCover
    ? `<img class="thumb" loading="lazy" src="/api/cover?id=${encodeURIComponent(it.first.id)}" alt="">`
    : '<div class="thumb placeholder">📕</div>';
  return `
    <div class="card series-card" data-series="${esc(it.series.name)}">
      <div class="card-cover">
        ${thumb}
        <div class="series-badge" title="连载全集，点击管理全系列">📚 连载 · ${it.volumes.length}集</div>
      </div>
      <div class="card-name">${esc(itemTitle(it))}</div>
      <div class="card-tags">${tags}${more}</div>
    </div>`;
}

function renderCountline() {
  const d = state.data;
  if (!d || !d.configured) return;
  const shown = filteredItems().length;
  const stats = tagStats();
  if (state.viewMode === 'single') {
    $('#countline').textContent = `共 ${d.comics.length} 本 · 未分类 ${stats.untagged} 本 · 当前显示 ${shown} 本`;
  } else {
    const singleCount = d.comics.filter((c) => !c.series).length;
    $('#countline').textContent = `系列 ${stats.seriesCount} 部 · 单本 ${singleCount} 本 · 合计 ${stats.total} 项 · 未分类 ${stats.untagged} · 当前显示 ${shown}`;
  }
}

function renderModalRoot() {
  const root = $('#modal-root');
  if (state.detailId) return renderDetail(root);
  if (state.seriesDetail) return renderSeriesDetail(root);
  if (state.settingsOpen) return renderSettings(root);
  if (state.tagsOpen) return renderTagsMgr(root);
  root.innerHTML = '';
}

function renderDetail(root) {
  const c = state.data.comics.find((x) => x.id === state.detailId);
  if (!c) {
    state.detailId = null;
    return renderModalRoot();
  }
  const fullPath = state.data.libraryRoot.replace(/[\\/]+$/, '') + '\\' + c.id.replace(/\//g, '\\');
  const seriesTags = c.series ? new Set(seriesByName(c.series).tags) : new Set();
  const chips = c.tags.map((t) => {
    if (seriesTags.has(t)) {
      return `<span class="tag-chip big series-tag" title="系列标签：在系列详情中修改，自动应用到全系列"><span class="series-mark">系列</span><span>${esc(t)}</span></span>`;
    }
    return `<span class="tag-chip big"><span>${esc(t)}</span><button class="tag-x" data-remove="${esc(t)}" title="删除标签">×</button></span>`;
  }).join('');
  const img = c.hasCover
    ? `<img src="/api/cover?id=${encodeURIComponent(c.id)}" alt="">`
    : '<div class="thumb placeholder">📕</div>';
  const seriesLink = c.series ? `
    <div class="detail-actions">
      <button class="btn" data-action="open-folder">📂 打开文件夹</button>
      <button class="btn" data-action="rename">✏️ 重命名</button>
      <button class="btn" data-action="open-series">📚 编辑系列标签</button>
      ${state.backToSeries ? '<button class="btn ghost" data-action="back-series">← 返回系列</button>' : ''}
      <button class="btn ghost" data-action="close">关闭</button>
    </div>` : `
    <div class="detail-actions">
      <button class="btn" data-action="open-folder">📂 打开文件夹</button>
      <button class="btn" data-action="rename">✏️ 重命名</button>
      <button class="btn ghost" data-action="close">关闭</button>
    </div>`;
  root.innerHTML = `
    <div class="overlay">
      <div class="modal detail">
        <div class="detail-cover">${img}</div>
        <div class="detail-info">
          <h2>${esc(comicTitle(c))}</h2>
          <div class="detail-path">${esc(fullPath)}</div>
          ${seriesLink}
          <h3>标签${c.series ? ' <span class="hint">（带「系列」标记的标签改一个全系列生效）</span>' : ''}</h3>
          <div class="detail-tags">${chips || '<span class="hint">暂无标签</span>'}</div>
          <form class="add-tag" id="add-tag-form">
            <input id="add-tag-input" list="tag-list" placeholder="输入新标签，或从已有标签选择" autocomplete="off">
            <datalist id="tag-list">${state.data.tags.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>
            <button class="btn primary" type="submit">添加</button>
          </form>
          <p class="hint">标签全部由你手动维护，不会自动生成。</p>
        </div>
      </div>
    </div>`;
}

function renderSeriesDetail(root) {
  const name = state.seriesDetail;
  const s = seriesByName(name);
  const vols = seriesVolumes(name);
  if (!vols.length) {
    state.seriesDetail = null;
    return renderModalRoot();
  }
  const first = vols[0];
  const fullPath = state.data.libraryRoot.replace(/[\\/]+$/, '') + '\\' + name;
  const img = first.hasCover
    ? `<img src="/api/cover?id=${encodeURIComponent(first.id)}" alt="">`
    : '<div class="thumb placeholder">📕</div>';
  const chips = s.tags.map((t) => `
    <span class="tag-chip big">
      <span>${esc(t)}</span>
      <button class="tag-x" data-sremove="${esc(t)}" title="从整个系列删除">×</button>
    </span>`).join('');
  const rows = vols.map((v, i) => `
    <div class="vol-row" data-vol="${esc(v.id)}" title="点击编辑该单集标签">
      <div class="vol-idx">${i + 1}</div>
      <div class="vol-thumb">${v.hasCover
        ? `<img loading="lazy" src="/api/cover?id=${encodeURIComponent(v.id)}" alt="">`
        : '<div class="thumb placeholder">📕</div>'}</div>
      <div class="vol-main">
        <div class="vol-name">${esc(comicTitle(v))}</div>
        <div class="vol-tags">${v.tags.slice(0, 4).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('') || '<span class="hint">无标签</span>'}</div>
      </div>
      <button class="btn small" data-vol-edit="${esc(v.id)}">编辑</button>
    </div>`).join('');
  root.innerHTML = `
    <div class="overlay">
      <div class="modal detail">
        <div class="detail-cover">
          ${img}
          <div class="series-badge static">📚 连载全集 · ${vols.length} 集</div>
        </div>
        <div class="detail-info">
          <h2>${esc(name)}</h2>
          <div class="detail-path">${esc(fullPath)}</div>
          <div class="detail-actions">
            <button class="btn" data-action="open-folder">📂 打开文件夹</button>
            <button class="btn ghost" data-action="close">关闭</button>
          </div>
          <h3>系列标签 <span class="hint">（改一个，全系列 ${vols.length} 集都生效）</span></h3>
          <div class="detail-tags">${chips || '<span class="hint">暂无标签</span>'}</div>
          <form class="add-tag" id="series-add-tag-form">
            <input id="series-add-tag-input" list="series-tag-list" placeholder="输入新标签，或从已有标签选择" autocomplete="off">
            <datalist id="series-tag-list">${state.data.tags.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>
            <button class="btn primary" type="submit">添加</button>
          </form>
          <h3>单集列表（${vols.length}）</h3>
          <div class="vol-list">${rows}</div>
        </div>
      </div>
    </div>`;
}

function renderSettings(root) {
  const d = state.data;
  root.innerHTML = `
    <div class="overlay">
      <div class="modal settings">
        <h2>设置</h2>
        <label for="root-input">漫画库文件夹路径</label>
        <div class="path-row">
          <input id="root-input" type="text" value="${esc(d.libraryRoot)}" placeholder="例如 D:\\Comics">
          <button class="btn primary" id="save-root">保存</button>
        </div>
        <p class="hint">请粘贴漫画库所在文件夹的完整路径（可在资源管理器地址栏复制）。保存后会自动扫描。支持两级结构：根目录下既可以是单本文件夹，也可以是「连载系列文件夹」——系列下的子文件夹会被当作单本展示。切换「全集」视图会把系列聚合为一张卡片，系列标签一键应用到全部单集。</p>
        <div class="settings-actions">
          <button class="btn" id="open-tags-mgr">🏷 标签管理</button>
          <button class="btn" id="rescan-btn">⟳ 重新扫描</button>
        </div>
        <p class="hint">数据文件：${esc(d.dataFile)}（复制它即可备份标签）</p>
        <button class="btn ghost close-btn">关闭</button>
      </div>
    </div>`;
}

function renderTagsMgr(root) {
  const d = state.data;
  const rows = d.tags.map((t) => `
    <div class="tag-row">
      <span class="tag-name">${esc(t.name)}</span>
      <span class="tag-count">${t.count} 本</span>
      <span class="tag-actions">
        <button class="btn small" data-tag-rename="${esc(t.name)}">改名</button>
        <button class="btn small danger" data-tag-delete="${esc(t.name)}">删除</button>
      </span>
    </div>`).join('');
  root.innerHTML = `
    <div class="overlay">
      <div class="modal tags-mgr">
        <h2>标签管理</h2>
        <p class="hint">改名会把该标签同步到所有漫画和系列；改名成已有标签 = 合并；删除会从所有漫画和系列移除。</p>
        <div class="tag-list">${rows || '<span class="hint">还没有任何标签。</span>'}</div>
        <button class="btn ghost close-btn">关闭</button>
      </div>
    </div>`;
}

// ---------- 交互 ----------
function toggleTag(t) {
  if (state.selectedTags.has(t)) state.selectedTags.delete(t);
  else state.selectedTags.add(t);
  renderDynamic();
}

function closeModal() {
  state.detailId = null;
  state.seriesDetail = null;
  state.backToSeries = null;
  state.settingsOpen = false;
  state.tagsOpen = false;
  renderModalRoot();
}

async function handleAction(a) {
  if (a === 'close') return closeModal();
  if (a === 'open-folder') {
    const id = state.detailId || state.seriesDetail;
    if (!id) return;
    try {
      await api('/api/open-folder', { method: 'POST', body: { id } });
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (a === 'rename') {
    if (!state.detailId) return;
    const c = state.data.comics.find((x) => x.id === state.detailId);
    const name = prompt('输入新的文件夹名称：', c.name);
    if (!name || name.trim() === c.name) return;
    try {
      const r = await api('/api/comics/rename', { method: 'POST', body: { id: c.id, to: name.trim() } });
      state.detailId = r.to;
      await load();
    } catch (e) {
      alert(e.message);
    }
  }
  if (a === 'open-series') {
    const c = state.data.comics.find((x) => x.id === state.detailId);
    if (c && c.series) {
      state.backToSeries = null;
      state.seriesDetail = c.series;
      state.detailId = null;
      renderModalRoot();
    }
    return;
  }
  if (a === 'back-series') {
    state.detailId = null;
    state.seriesDetail = state.backToSeries;
    state.backToSeries = null;
    renderModalRoot();
    return;
  }
}

async function removeTag(id, tag) {
  try {
    await api('/api/comics/tags/delete', { method: 'POST', body: { id, tag } });
    await load();
  } catch (e) {
    alert(e.message);
  }
}

async function removeSeriesTag(name, tag) {
  try {
    await api('/api/series/tags/delete', { method: 'POST', body: { name, tag } });
    await load();
  } catch (e) {
    alert(e.message);
  }
}

async function renameTagGlobal(from) {
  const to = prompt(`将标签「${from}」改名为：`, from);
  if (!to || to.trim() === from) return;
  try {
    await api('/api/tags/rename', { method: 'POST', body: { from, to: to.trim() } });
    await load();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteTagGlobal(tag) {
  if (!confirm(`确定从所有漫画中删除标签「${tag}」吗？`)) return;
  try {
    await api('/api/tags/delete', { method: 'POST', body: { tag } });
    await load();
  } catch (e) {
    alert(e.message);
  }
}

async function saveRoot() {
  const v = $('#root-input').value.trim();
  try {
    state.data = await api('/api/config', { method: 'POST', body: { libraryRoot: v } });
    state.settingsOpen = false;
    render();
    showToast(v ? '已保存并扫描' : '已清空路径');
  } catch (e) {
    alert(e.message);
  }
}

async function doRescan() {
  try {
    const r = await api('/api/rescan', { method: 'POST' });
    showToast(r.added.length ? `发现 ${r.added.length} 本新漫画` : '没有新漫画');
    await load();
  } catch (e) {
    alert(e.message);
  }
}

function showToast(msg) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- 事件 ----------
document.addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-tag]');
  if (chip) return toggleTag(chip.dataset.tag);

  const filterBtn = e.target.closest('[data-filter]');
  if (filterBtn) {
    state.listFilter = filterBtn.dataset.filter;
    return renderDynamic();
  }

  const modeBtn = e.target.closest('[data-mode]');
  if (modeBtn) {
    state.filterMode = modeBtn.dataset.mode;
    return renderDynamic();
  }

  const viewBtn = e.target.closest('[data-view]');
  if (viewBtn) {
    state.viewMode = viewBtn.dataset.view;
    localStorage.setItem('comic_view_mode', state.viewMode);
    return renderDynamic();
  }

  const card = e.target.closest('.card[data-id]');
  if (card) {
    state.detailId = card.dataset.id;
    state.seriesDetail = null;
    state.backToSeries = null;
    state.settingsOpen = false;
    state.tagsOpen = false;
    return render();
  }

  const seriesCard = e.target.closest('.card[data-series]');
  if (seriesCard) {
    state.seriesDetail = seriesCard.dataset.series;
    state.detailId = null;
    state.backToSeries = null;
    state.settingsOpen = false;
    state.tagsOpen = false;
    return render();
  }

  const volRow = e.target.closest('[data-vol]');
  if (volRow) {
    state.backToSeries = state.seriesDetail;
    state.detailId = volRow.dataset.vol;
    state.seriesDetail = null;
    return renderModalRoot();
  }

  const action = e.target.closest('[data-action]');
  if (action) return handleAction(action.dataset.action);

  const srem = e.target.closest('[data-sremove]');
  if (srem) return removeSeriesTag(state.seriesDetail, srem.dataset.sremove);

  const x = e.target.closest('[data-remove]');
  if (x) return removeTag(state.detailId, x.dataset.remove);

  const renameBtn = e.target.closest('[data-tag-rename]');
  if (renameBtn) return renameTagGlobal(renameBtn.dataset.tagRename);

  const delBtn = e.target.closest('[data-tag-delete]');
  if (delBtn) return deleteTagGlobal(delBtn.dataset.tagDelete);

  if (e.target.closest('#save-root')) return saveRoot();
  if (e.target.closest('#open-tags-mgr')) {
    state.settingsOpen = false;
    state.tagsOpen = true;
    return renderModalRoot();
  }
  if (e.target.closest('#rescan-btn')) return doRescan();
  if (e.target.closest('#goto-settings')) {
    state.settingsOpen = true;
    return render();
  }
  if (e.target.classList.contains('overlay')) return closeModal();
  if (e.target.closest('.close-btn')) return closeModal();
});

document.addEventListener('submit', (e) => {
  const volForm = e.target.closest('#add-tag-form');
  const seriesForm = e.target.closest('#series-add-tag-form');
  if (!volForm && !seriesForm) return;
  e.preventDefault();
  if (seriesForm) {
    const input = $('#series-add-tag-input');
    const val = input.value.trim();
    if (!val) return;
    (async () => {
      try {
        await api('/api/series/tags', { method: 'POST', body: { name: state.seriesDetail, tags: [val] } });
        input.value = '';
        await load();
      } catch (err) {
        alert(err.message);
      }
    })();
    return;
  }
  const input = $('#add-tag-input');
  const val = input.value.trim();
  if (!val) return;
  (async () => {
    try {
      await api('/api/comics/tags', { method: 'POST', body: { id: state.detailId, tags: [val] } });
      input.value = '';
      await load();
    } catch (err) {
      alert(err.message);
    }
  })();
});

$('#search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderDynamic();
});
$('#sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderDynamic();
});
$('#btn-rescan').addEventListener('click', doRescan);
$('#btn-settings').addEventListener('click', () => {
  state.settingsOpen = true;
  state.detailId = null;
  state.seriesDetail = null;
  state.tagsOpen = false;
  render();
});

load();

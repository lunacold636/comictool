'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  data: null,
  selectedTags: new Set(),
  filterMode: 'and',
  listFilter: 'all',
  search: '',
  sort: 'recent',
  detailName: null,
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

// ---------- 筛选 ----------
function filteredComics() {
  let list = state.data.comics;
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
  if (state.listFilter === 'untagged') list = list.filter((c) => !c.tags.length);
  if (state.selectedTags.size > 0) {
    const sel = [...state.selectedTags];
    list = list.filter((c) => (
      state.filterMode === 'and'
        ? sel.every((t) => c.tags.includes(t))
        : sel.some((t) => c.tags.includes(t))
    ));
  }
  if (state.sort === 'name') {
    list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  } else {
    list = [...list].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  }
  return list;
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
  renderTagbar();
  renderGrid();
  renderCountline();
  renderModalRoot();
}

function renderDynamic() {
  if (!state.data || !state.data.configured) return;
  renderTagbar();
  renderGrid();
  renderCountline();
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
  const untagged = d.comics.filter((c) => !c.tags.length).length;
  const chips = [
    `<button class="chip${state.listFilter === 'all' ? ' on' : ''}" data-filter="all">全部</button>`,
    `<button class="chip${state.listFilter === 'untagged' ? ' on' : ''}" data-filter="untagged">未分类 (${untagged})</button>`,
  ];
  for (const t of d.tags) {
    chips.push(
      `<button class="chip${state.selectedTags.has(t.name) ? ' on' : ''}" data-tag="${esc(t.name)}">${esc(t.name)} (${t.count})</button>`
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
  const list = filteredComics();
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
  grid.innerHTML = list.map((c) => {
    const tags = c.tags.slice(0, 3).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('');
    const more = c.tags.length > 3 ? `<span class="mini-tag more">+${c.tags.length - 3}</span>` : '';
    const thumb = c.hasCover
      ? `<img class="thumb" loading="lazy" src="/api/cover?folder=${encodeURIComponent(c.name)}" alt="">`
      : `<div class="thumb placeholder">📕</div>`;
    return `
      <div class="card" data-name="${esc(c.name)}">
        <div class="card-cover">${thumb}</div>
        <div class="card-name">${esc(c.name)}</div>
        <div class="card-tags">${tags}${more}</div>
      </div>`;
  }).join('');
}

function renderCountline() {
  const d = state.data;
  if (!d || !d.configured) return;
  const shown = filteredComics().length;
  const untagged = d.comics.filter((c) => !c.tags.length).length;
  $('#countline').textContent = `共 ${d.comics.length} 本 · 未分类 ${untagged} 本 · 当前显示 ${shown} 本`;
}

function renderModalRoot() {
  const root = $('#modal-root');
  if (state.detailName) return renderDetail(root);
  if (state.settingsOpen) return renderSettings(root);
  if (state.tagsOpen) return renderTagsMgr(root);
  root.innerHTML = '';
}

function renderDetail(root) {
  const c = state.data.comics.find((x) => x.name === state.detailName);
  if (!c) {
    state.detailName = null;
    return renderModalRoot();
  }
  const fullPath = state.data.libraryRoot + '\\' + c.name;
  const chips = c.tags.map((t) => `
    <span class="tag-chip big">
      <span>${esc(t)}</span>
      <button class="tag-x" data-remove="${esc(t)}" title="删除标签">×</button>
    </span>`).join('');
  const img = c.hasCover
    ? `<img src="/api/cover?folder=${encodeURIComponent(c.name)}" alt="">`
    : `<div class="thumb placeholder">📕</div>`;
  root.innerHTML = `
    <div class="overlay">
      <div class="modal detail">
        <div class="detail-cover">${img}</div>
        <div class="detail-info">
          <h2>${esc(c.name)}</h2>
          <div class="detail-path">${esc(fullPath)}</div>
          <div class="detail-actions">
            <button class="btn" data-action="open-folder">📂 打开文件夹</button>
            <button class="btn" data-action="rename">✏️ 重命名</button>
            <button class="btn ghost" data-action="close">关闭</button>
          </div>
          <h3>标签</h3>
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
        <p class="hint">请粘贴漫画库所在文件夹的完整路径（可在资源管理器地址栏复制）。保存后会自动扫描。</p>
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
        <p class="hint">改名会把该标签同步到所有漫画；改名成已有标签 = 合并；删除会从所有漫画移除。</p>
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
  state.detailName = null;
  state.settingsOpen = false;
  state.tagsOpen = false;
  renderModalRoot();
}

async function handleAction(a) {
  if (a === 'close') return closeModal();
  if (a === 'open-folder') {
    try {
      await api('/api/open-folder', { method: 'POST', body: { name: state.detailName } });
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (a === 'rename') {
    const c = state.data.comics.find((x) => x.name === state.detailName);
    const name = prompt('输入新的文件夹名称：', c.name);
    if (!name || name.trim() === c.name) return;
    try {
      await api('/api/comics/rename', { method: 'POST', body: { from: c.name, to: name.trim() } });
      state.detailName = name.trim();
      await load();
    } catch (e) {
      alert(e.message);
    }
  }
}

async function removeTag(name, tag) {
  try {
    await api(`/api/comics/${encodeURIComponent(name)}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
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

  const card = e.target.closest('.card[data-name]');
  if (card) {
    state.detailName = card.dataset.name;
    state.settingsOpen = false;
    state.tagsOpen = false;
    return render();
  }

  const action = e.target.closest('[data-action]');
  if (action) return handleAction(action.dataset.action);

  const x = e.target.closest('[data-remove]');
  if (x) return removeTag(state.detailName, x.dataset.remove);

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
  const form = e.target.closest('#add-tag-form');
  if (!form) return;
  e.preventDefault();
  const input = $('#add-tag-input');
  const val = input.value.trim();
  if (!val) return;
  (async () => {
    try {
      await api(`/api/comics/${encodeURIComponent(state.detailName)}/tags`, { method: 'POST', body: { tags: [val] } });
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
  state.detailName = null;
  state.tagsOpen = false;
  render();
});

load();
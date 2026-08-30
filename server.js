'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'comics.json');
const PORT = Number(process.env.PORT) || 38417;
const HOST = '127.0.0.1';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.jfif']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

// ---------- 数据读写 ----------
function loadData() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (raw && typeof raw === 'object') return raw;
  } catch (_) { /* 首次运行 */ }
  return { version: 1, libraryRoot: '', comics: {}, series: {} };
}

function saveData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- 文件系统 ----------
function isValidRoot(p) {
  if (!p) return false;
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function listFolders(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch (_) { return []; }
}

function listImages(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .sort(naturalCompare);
  } catch (_) { return []; }
}

// 自然排序：1.jpg < 2.jpg < 10.jpg
function naturalCompare(a, b) {
  const A = a.toLowerCase().split(/(\d+)/);
  const B = b.toLowerCase().split(/(\d+)/);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const ca = A[i] ?? '';
    const cb = B[i] ?? '';
    if (ca === cb) continue;
    if (/^\d+$/.test(ca) && /^\d+$/.test(cb)) {
      const d = BigInt(ca) - BigInt(cb);
      if (d !== 0n) return d > 0n ? 1 : -1;
      continue;
    }
    return ca < cb ? -1 : 1;
  }
  return 0;
}

// 封面：优先 cover.*，否则第一张（已按文件名自然排序）
function pickCover(images) {
  const cover = images.find(f => /^cover\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f));
  return cover || images[0];
}

function validFolderName(name) {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..'
    && !/[\\/]/.test(name) && !name.includes(':') && !name.startsWith('.');
}

function cleanTags(arr) {
  const seen = new Set();
  const out = [];
  for (const t of (Array.isArray(arr) ? arr : [])) {
    if (typeof t !== 'string') continue;
    const s = t.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ---------- 递归扫描 ----------
// 规则：一个目录只要含图片就视为「一本」（停止下探）；
//       无图但有子文件夹则视为「连载容器」，递归扫描子文件夹；
//       两者皆无则忽略（空文件夹）。
// id 用相对库根的路径（/ 分隔），如「连载A/第01卷」；根级单本 id = 文件夹名。
function scanNode(absDir, relPath, out) {
  const images = listImages(absDir);
  if (images.length > 0) {
    out.push({ id: relPath, absDir });
    return;
  }
  for (const sub of listFolders(absDir)) {
    const subRel = relPath ? relPath + '/' + sub : sub;
    scanNode(path.join(absDir, sub), subRel, out);
  }
}

function scanLibrary(root) {
  const out = [];
  for (const top of listFolders(root)) {
    scanNode(path.join(root, top), top, out);
  }
  return out;
}

// 校验 id 并解析为库内绝对路径；非法返回 null
function resolveId(data, id) {
  if (typeof id !== 'string' || !id) return null;
  const root = (data.libraryRoot || '').trim();
  if (!isValidRoot(root)) return null;
  const parts = id.split('/');
  if (parts.some(part => !validFolderName(part))) return null;
  const abs = path.resolve(root, ...parts);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

// id 的父级（'' 表示库根）
function parentId(id) {
  const i = id.lastIndexOf('/');
  return i === -1 ? '' : id.slice(0, i);
}

// ---------- 状态汇总 ----------
function collectComics(data) {
  const root = (data.libraryRoot || '').trim();
  if (!isValidRoot(root)) {
    return { configured: false, libraryRoot: root, comics: [], series: [], authors: [], tags: [], dataFile: DATA_FILE };
  }
  if (!data.series) data.series = {};
  const now = new Date().toISOString();
  let changed = false;
  const comics = [];
  for (const node of scanLibrary(root)) {
    const { id, absDir } = node;
    let entry = data.comics[id];
    if (!entry) {
      entry = { tags: [], authors: [], addedAt: now, updatedAt: now };
      data.comics[id] = entry;
      changed = true;
    }
    const slash = id.indexOf('/');
    const series = slash === -1 ? '' : id.slice(0, slash);
    if (series && !data.series[series]) {
      data.series[series] = { tags: [], authors: [], addedAt: now, updatedAt: now };
      changed = true;
    }
    const own = entry.tags || [];
    // 单卷有效标签 = 系列标签 + 该卷自身标签（系列标签自动应用到全系列）
    const eff = series ? cleanTags([...(data.series[series].tags || []), ...own]) : own.slice();
    const ownA = entry.authors || [];
    const effA = series ? cleanTags([...(data.series[series].authors || []), ...ownA]) : cleanTags(ownA);
    comics.push({
      id,
      series,
      name: id.slice(slash === -1 ? 0 : slash + 1),
      tags: eff,
      authors: effA,
      addedAt: entry.addedAt || null,
      updatedAt: entry.updatedAt || null,
      hasCover: listImages(absDir).length > 0,
    });
  }
  if (changed) saveData(data);
  // 系列列表：只保留当前仍有卷的系列
  const present = new Set();
  for (const c of comics) if (c.series) present.add(c.series);
  const seriesList = [];
  for (const name of [...present].sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    const se = data.series[name];
    seriesList.push({
      name,
      tags: cleanTags(se ? se.tags : []),
      authors: cleanTags(se ? (se.authors || []) : []),
      addedAt: se ? (se.addedAt || null) : null,
      updatedAt: se ? (se.updatedAt || null) : null,
    });
  }
  const tagMap = new Map();
  for (const c of comics) for (const t of c.tags) tagMap.set(t, (tagMap.get(t) || 0) + 1);
  const tags = [...tagMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  const authorMap = new Map();
  for (const c of comics) for (const a of (c.authors || [])) authorMap.set(a, (authorMap.get(a) || 0) + 1);
  const authors = [...authorMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  return { configured: true, libraryRoot: root, comics, series: seriesList, authors, tags, dataFile: DATA_FILE };
}

// ---------- HTTP 工具 ----------
function sendJSON(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2e6) throw new Error('请求体过大');
  }
  if (!raw) return {};
  return JSON.parse(raw);
}

// ---------- API ----------
async function handleApi(req, res, u, p) {
  const data = loadData();
  const method = req.method;

  if (p === '/api/state' && method === 'GET') {
    return sendJSON(res, 200, collectComics(data));
  }

  if (p === '/api/rescan' && method === 'POST') {
    const root = (data.libraryRoot || '').trim();
    if (!isValidRoot(root)) return sendJSON(res, 400, { error: '漫画库路径未设置或不存在' });
    const now = new Date().toISOString();
    const ids = scanLibrary(root).map(n => n.id);
    const added = [];
    let changed = false;
    for (const id of ids) {
      if (!data.comics[id]) {
        data.comics[id] = { tags: [], addedAt: now, updatedAt: now };
        added.push(id);
        changed = true;
      }
    }
    const removed = Object.keys(data.comics).filter(n => !ids.includes(n));
    // 清理已不存在的系列（系列 = id 第一段）
    const presentSeries = new Set();
    for (const id of ids) {
      const slash = id.indexOf('/');
      if (slash !== -1) presentSeries.add(id.slice(0, slash));
    }
    if (!data.series) data.series = {};
    const removedSeries = Object.keys(data.series).filter(n => !presentSeries.has(n));
    if (removedSeries.length) {
      for (const n of removedSeries) delete data.series[n];
      changed = true;
    }
    if (changed) saveData(data);
    return sendJSON(res, 200, { added, removed, removedSeries });
  }

  if (p === '/api/config' && method === 'POST') {
    const body = await readBody(req);
    const root = String(body.libraryRoot || '').trim();
    if (root && !isValidRoot(root)) return sendJSON(res, 400, { error: '路径不存在或不是文件夹：' + root });
    data.libraryRoot = root;
    saveData(data);
    return sendJSON(res, 200, collectComics(data));
  }

  if (p === '/api/tags/rename' && method === 'POST') {
    const body = await readBody(req);
    const from = String(body.from || '').trim();
    const to = String(body.to || '').trim();
    if (!from || !to) return sendJSON(res, 400, { error: '缺少参数 from/to' });
    let changed = false;
    if (from !== to) {
      for (const c of Object.values(data.comics)) {
        if ((c.tags || []).includes(from)) {
          c.tags = cleanTags((c.tags || []).map(t => t === from ? to : t));
          c.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
      for (const sd of Object.values(data.series || {})) {
        if ((sd.tags || []).includes(from)) {
          sd.tags = cleanTags((sd.tags || []).map(t => t === from ? to : t));
          sd.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
    }
    if (changed) saveData(data);
    return sendJSON(res, 200, { ok: true, changed });
  }

  // 全局作者改名 / 删除（同步到所有漫画与系列）
  if (p === '/api/authors/rename' && method === 'POST') {
    const body = await readBody(req);
    const from = String(body.from || '').trim();
    const to = String(body.to || '').trim();
    if (!from || !to) return sendJSON(res, 400, { error: '缺少参数 from/to' });
    let changed = false;
    if (from !== to) {
      for (const c of Object.values(data.comics)) {
        if ((c.authors || []).includes(from)) {
          c.authors = cleanTags((c.authors || []).map(t => t === from ? to : t));
          c.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
      for (const sd of Object.values(data.series || {})) {
        if ((sd.authors || []).includes(from)) {
          sd.authors = cleanTags((sd.authors || []).map(t => t === from ? to : t));
          sd.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
    }
    if (changed) saveData(data);
    return sendJSON(res, 200, { ok: true, changed });
  }

  if (p === '/api/authors/delete' && method === 'POST') {
    const body = await readBody(req);
    const author = String(body.author || body.tag || '').trim();
    if (!author) return sendJSON(res, 400, { error: '缺少参数 author' });
    let changed = false;
    for (const c of Object.values(data.comics)) {
      if ((c.authors || []).includes(author)) {
        c.authors = (c.authors || []).filter(t => t !== author);
        c.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    for (const sd of Object.values(data.series || {})) {
      if ((sd.authors || []).includes(author)) {
        sd.authors = (sd.authors || []).filter(t => t !== author);
        sd.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) saveData(data);
    return sendJSON(res, 200, { ok: true, changed });
  }

  if (p === '/api/tags/delete' && method === 'POST') {
    const body = await readBody(req);
    const tag = String(body.tag || '').trim();
    if (!tag) return sendJSON(res, 400, { error: '缺少参数 tag' });
    let changed = false;
    for (const c of Object.values(data.comics)) {
      if ((c.tags || []).includes(tag)) {
        c.tags = c.tags.filter(t => t !== tag);
        c.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    for (const sd of Object.values(data.series || {})) {
      if ((sd.tags || []).includes(tag)) {
        sd.tags = sd.tags.filter(t => t !== tag);
        sd.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) saveData(data);
    return sendJSON(res, 200, { ok: true, changed });
  }

  // 系列标签：整体替换 / 新增 / 删除（系列标签自动应用到该系列全部单集）
  if (p === '/api/series/tags' && method === 'PUT') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const se = data.series && data.series[name];
    if (!se) return sendJSON(res, 404, { error: '未找到系列：' + name });
    se.tags = cleanTags(body.tags);
    se.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { name, tags: se.tags });
  }
  if (p === '/api/series/tags' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const se = data.series && data.series[name];
    if (!se) return sendJSON(res, 404, { error: '未找到系列：' + name });
    se.tags = cleanTags([...(se.tags || []), ...cleanTags(body.tags)]);
    se.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { name, tags: se.tags });
  }
  if (p === '/api/series/tags/delete' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const tag = String(body.tag || '').trim();
    const se = data.series && data.series[name];
    if (!se) return sendJSON(res, 404, { error: '未找到系列：' + name });
    se.tags = (se.tags || []).filter(t => t !== tag);
    se.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { name, tags: se.tags });
  }

  // 系列作者：整体替换 / 新增 / 删除（系列作者自动应用到该系列全部单集）
  if (p === '/api/series/authors' && method === 'PUT') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const se = data.series && data.series[name];
    if (!se) return sendJSON(res, 404, { error: '未找到系列：' + name });
    se.authors = cleanTags(body.authors);
    se.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { name, authors: se.authors });
  }
  if (p === '/api/series/authors' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const se = data.series && data.series[name];
    if (!se) return sendJSON(res, 404, { error: '未找到系列：' + name });
    se.authors = cleanTags([...(se.authors || []), ...cleanTags(body.authors)]);
    se.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { name, authors: se.authors });
  }
  if (p === '/api/series/authors/delete' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const author = String(body.author || '').trim();
    const se = data.series && data.series[name];
    if (!se) return sendJSON(res, 404, { error: '未找到系列：' + name });
    se.authors = (se.authors || []).filter(t => t !== author);
    se.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { name, authors: se.authors });
  }

  // 单本 tag 操作：PUT 整体替换 / POST 新增 / POST tags/delete 删除
  if (p === '/api/comics/tags' && method === 'PUT') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const comic = data.comics[id];
    if (!comic) return sendJSON(res, 404, { error: '未找到漫画：' + id });
    comic.tags = cleanTags(body.tags);
    comic.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { id, tags: comic.tags });
  }

  if (p === '/api/comics/tags' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const comic = data.comics[id];
    if (!comic) return sendJSON(res, 404, { error: '未找到漫画：' + id });
    comic.tags = cleanTags([...(comic.tags || []), ...cleanTags(body.tags)]);
    comic.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { id, tags: comic.tags });
  }

  if (p === '/api/comics/tags/delete' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const tag = String(body.tag || '').trim();
    const comic = data.comics[id];
    if (!comic) return sendJSON(res, 404, { error: '未找到漫画：' + id });
    comic.tags = (comic.tags || []).filter(t => t !== tag);
    comic.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { id, tags: comic.tags });
  }

  // 单本作者：PUT 整体替换 / POST 新增 / POST authors/delete 删除
  if (p === '/api/comics/authors' && method === 'PUT') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const comic = data.comics[id];
    if (!comic) return sendJSON(res, 404, { error: '未找到漫画：' + id });
    comic.authors = cleanTags(body.authors);
    comic.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { id, authors: comic.authors });
  }

  if (p === '/api/comics/authors' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const comic = data.comics[id];
    if (!comic) return sendJSON(res, 404, { error: '未找到漫画：' + id });
    comic.authors = cleanTags([...(comic.authors || []), ...cleanTags(body.authors)]);
    comic.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { id, authors: comic.authors });
  }

  if (p === '/api/comics/authors/delete' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const author = String(body.author || '').trim();
    const comic = data.comics[id];
    if (!comic) return sendJSON(res, 404, { error: '未找到漫画：' + id });
    comic.authors = (comic.authors || []).filter(t => t !== author);
    comic.updatedAt = new Date().toISOString();
    saveData(data);
    return sendJSON(res, 200, { id, authors: comic.authors });
  }

  if (p === '/api/comics/rename' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const to = String(body.to || '').trim();
    const root = (data.libraryRoot || '').trim();
    if (!isValidRoot(root)) return sendJSON(res, 400, { error: '漫画库路径未设置' });
    const oldPath = resolveId(data, id);
    if (!oldPath) return sendJSON(res, 404, { error: '未找到漫画文件夹：' + id });
    if (!validFolderName(to)) return sendJSON(res, 400, { error: '新名称不合法' });
    const leaf = id.slice(id.lastIndexOf('/') + 1);
    if (leaf === to) return sendJSON(res, 200, { ok: true });
    const newPath = path.join(path.dirname(oldPath), to);
    if (fs.existsSync(newPath)) return sendJSON(res, 400, { error: '目标文件夹已存在：' + to });
    try {
      fs.renameSync(oldPath, newPath);
    } catch (e) {
      return sendJSON(res, 500, { error: '重命名失败：' + e.message });
    }
    const parent = parentId(id);
    const newId = parent ? parent + '/' + to : to;
    if (data.comics[id]) {
      data.comics[newId] = data.comics[id];
      delete data.comics[id];
      data.comics[newId].updatedAt = new Date().toISOString();
      saveData(data);
    }
    return sendJSON(res, 200, { ok: true, from: id, to: newId });
  }

  if (p === '/api/open-folder' && method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    const folder = resolveId(data, id);
    if (!folder) return sendJSON(res, 404, { error: '未找到漫画文件夹：' + id });
    if (process.platform !== 'win32') return sendJSON(res, 400, { error: '仅支持 Windows' });
    spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref();
    return sendJSON(res, 200, { ok: true });
  }

  if (p === '/api/cover' && method === 'GET') {
    const id = u.searchParams.get('id') || '';
    const folder = resolveId(data, id);
    if (!folder) return sendJSON(res, 404, { error: 'not found' });
    const images = listImages(folder);
    if (!images.length) return sendJSON(res, 404, { error: 'no image' });
    const cover = pickCover(images);
    const file = path.join(folder, cover);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  return sendJSON(res, 404, { error: '接口不存在：' + p });
}

// ---------- 静态文件 ----------
function serveStatic(res, p) {
  const rel = p === '/' ? '/index.html' : p;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJSON(res, 403, { error: 'forbidden' });
  }
  fs.readFile(file, (err, buf) => {
    if (err) return sendJSON(res, 404, { error: 'not found' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

// ---------- 入口 ----------
const server = http.createServer(async (req, res) => {
  let u, p;
  try {
    u = new URL(req.url, 'http://' + HOST + ':' + PORT);
    p = decodeURIComponent(u.pathname);
  } catch (_) {
    return sendJSON(res, 400, { error: 'bad request' });
  }
  try {
    if (p.startsWith('/api/')) return await handleApi(req, res, u, p);
    return serveStatic(res, p);
  } catch (err) {
    return sendJSON(res, 500, { error: String(err && err.message || err) });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 被占用，请关闭占用程序，或用环境变量 PORT 指定其他端口。');
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('漫画标签库已启动：http://' + HOST + ':' + PORT + '/');
  console.log('数据文件：' + DATA_FILE);
  console.log('按 Ctrl+C 退出');
  if (process.platform === 'win32' && !process.env.NO_OPEN) {
    setTimeout(() => {
      spawn('cmd', ['/c', 'start', '', 'http://' + HOST + ':' + PORT + '/'], { detached: true, stdio: 'ignore' }).unref();
    }, 300);
  }
});
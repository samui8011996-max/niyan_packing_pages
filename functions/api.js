/**
 * 泥研製所 出貨 App — Cloudflare Pages Function
 * 取代原本的 Google Apps Script 後端，改讀寫 D1。
 * 路由：POST /api   （前端 API_URL 設為 '/api'）
 * D1 綁定名稱：DB
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try { body = JSON.parse(await request.text()); } catch (_) {}
  const action = body.action || 'readAll';
  const payload = body.payload || {};
  try {
    const data = await handle(env.DB, action, payload);
    // 只要是寫入（新增/修改/刪除）成功，就把版本號 +1，讓其他分頁的輪詢知道要重抓
    if (!READ_ACTIONS.has(action)) await bumpVersion(env.DB);
    return json({ ok: true, data });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

/* ---------- 工具 ---------- */
function json(o) {
  return new Response(JSON.stringify(o), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
let _seq = 0;
function newId(prefix) {
  return prefix + Date.now() + ((_seq++ % 1000) * 1000 + Math.floor(Math.random() * 1000));
}
function tw(offsetSlice) {              // 台灣時間
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, offsetSlice).replace('T', ' ');
}
const now = () => tw(19);               // yyyy-MM-dd HH:mm:ss
const today = () => tw(10);             // yyyy-MM-dd
function jparse(v) {
  if (typeof v === 'string' && v) { try { return JSON.parse(v); } catch (_) { return []; } }
  return Array.isArray(v) ? v : [];
}
function boxVal(v) { return (v === '' || v == null) ? null : Number(v); }

/* ---------- 分派 ---------- */
async function handle(DB, action, p) {
  switch (action) {
    case 'readAll':          return readAll(DB);
    case 'fingerprint':      return fingerprint(DB);
    case 'addOrder':         return addOrder(DB, p);
    case 'updateOrder':      return updateOrder(DB, p);
    case 'deleteOrder':      return deleteOrder(DB, p);
    case 'addProgress':      return addProgress(DB, p);
    case 'addProgressBatch': return addProgressBatch(DB, p);
    case 'deleteProgress':   return deleteProgress(DB, p);
    case 'addPlatform':      return addPlatform(DB, p);
    case 'updatePlatform':   return updatePlatform(DB, p);
    case 'deletePlatform':   return deletePlatform(DB, p);
    case 'upsertPlatform':   return upsertPlatform(DB, p);
    case 'addScrap':         return addScrap(DB, p);
    case 'deleteScrap':      return deleteScrap(DB, p);
    case 'addSetting':       return addSetting(DB, p);
    case 'deleteSetting':    return deleteSetting(DB, p);
    default: throw new Error('unknown action: ' + action);
  }
}

/* ---------- 讀取 ---------- */
/* 輪詢用的「有沒有變動」指紋 = app_version 表裡 packing 的版本號，只讀 1 列。
 * 前端每 10 秒打這支，指紋沒變就不抓整包 readAll。
 *
 * 2026-11-17 踩到：原本的指紋是 5 張表的 COUNT(*) / MAX(時間)，欄位沒索引，
 * 每問一次就掃過全部約 1,100 列；D1 免費額度算的是「掃過幾列」(每天 500 萬)，
 * 幾台電腦開著每 10 秒問一次就把整個帳號的額度用光，所有 App 一起被擋。
 * 改成：每次寫入把版本號 +1（見 bumpVersion），輪詢只看這一個數字。
 * 出貨小幫手(niyan_shipping)寫 platform_orders 時也會把 packing 版本號 +1。
 */
const READ_ACTIONS = new Set(['readAll', 'fingerprint']);
const VERSION_APP = 'packing';

async function bumpVersion(DB) {
  try {
    await DB.prepare(
      'INSERT INTO app_version (app, v) VALUES (?, 1) ON CONFLICT(app) DO UPDATE SET v = v + 1'
    ).bind(VERSION_APP).run();
  } catch (e) {
    // 版本號沒更新到不影響寫入本身；前端每 5 分鐘還有一次保險整包重抓
    console.error('bumpVersion failed', e);
  }
}

async function fingerprint(DB) {
  try {
    const r = await DB.prepare('SELECT v FROM app_version WHERE app = ?').bind(VERSION_APP).first();
    if (r) return { fp: 'v' + r.v };
  } catch (e) {
    console.error('app_version read failed, fallback to table scan', e);
  }
  return legacyFingerprint(DB);
}

// 舊版指紋（掃全表，很貴）：只在 app_version 表不存在/讀不到時當備援
async function legacyFingerprint(DB) {
  const [vo, vp, pf, sc, st] = await Promise.all([
    DB.prepare('SELECT COUNT(*) AS n, MAX("更新時間") AS t FROM vendor_orders').first(),
    DB.prepare('SELECT COUNT(*) AS n, MAX("建立時間") AS t FROM vendor_progress').first(),
    DB.prepare('SELECT COUNT(*) AS n, MAX("更新時間") AS t FROM platform_orders').first(),
    DB.prepare('SELECT COUNT(*) AS n, MAX("建立時間") AS t FROM scraps').first(),
    DB.prepare('SELECT COUNT(*) AS n FROM settings').first(),
  ]);
  const part = r => `${(r && r.n) || 0}:${(r && r.t) || ''}`;
  return { fp: [part(vo), part(vp), part(pf), part(sc), `${(st && st.n) || 0}`].join('|') };
}

async function readAll(DB) {
  // 先取指紋再讀資料：萬一中間有人寫入，指紋會「舊一點」，頂多下次輪詢多抓一次整包，
  // 不會發生「指紋比資料新」而把那筆更新一直漏掉。
  const { fp } = await fingerprint(DB);
  const [vo, vp, pf, sc, st] = await Promise.all([
    DB.prepare('SELECT * FROM vendor_orders').all(),
    DB.prepare('SELECT * FROM vendor_progress').all(),
    DB.prepare('SELECT * FROM platform_orders').all(),
    DB.prepare('SELECT * FROM scraps').all(),
    DB.prepare('SELECT "類型","值" FROM settings').all(),
  ]);
  const orders = (vo.results || []).map(o => {
    const items = jparse(o['品項']);
    return { ...o, items, '品項': (items[0] && items[0]['品項']) || '' };
  });
  const platforms = (pf.results || []).map(x => ({
    ...x,
    '明細': jparse(x['明細']),
    // 出貨小幫手寫進來的撿貨分組,前端點字卡時顯示(唯讀)
    '撿貨明細': jparse(x['撿貨明細']),
    // 注意品項逐筆清單(2026-10-22 起,出貨小幫手不再寫試算表,改送這裡)
    // 舊資料庫還沒有這一欄 → jparse(undefined) 回空陣列,不會壞
    '注意明細': jparse(x['注意明細']),
  }));
  const scraps = (sc.results || []).map(x => ({ ...x, '明細': jparse(x['明細']) }));
  const settings = {};
  (st.results || []).forEach(r => {
    const c = String(r['類型'] || '').trim();
    const v = String(r['值'] || '').trim();
    if (!c || !v) return;
    (settings[c] = settings[c] || []).push(v);
  });
  return { orders, progress: vp.results || [], platforms, scraps, settings, fp };
}

/* ---------- 廠商單 ---------- */
async function addOrder(DB, p) {
  const id = newId('V'), n = now();
  const itemsJson = Array.isArray(p['items']) ? JSON.stringify(p['items']) : '';
  await DB.prepare(
    'INSERT INTO vendor_orders (id,"下單日期","交期","廠商","門市","訂單編號","備註","品項","建立時間","更新時間") VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, p['下單日期']||'', p['交期']||'', p['廠商']||'', p['門市']||'', p['訂單編號']||'', p['備註']||'', itemsJson, n, n).run();
  return { id };
}
async function updateOrder(DB, p) {
  const sets = [], vals = [];
  for (const c of ['下單日期','交期','廠商','門市','訂單編號','備註']) {
    if (has(p, c)) { sets.push(`"${c}"=?`); vals.push(p[c]); }
  }
  if (has(p, 'items')) { sets.push('"品項"=?'); vals.push(JSON.stringify(p['items'] || [])); }
  sets.push('"更新時間"=?'); vals.push(now());
  vals.push(p.id);
  await DB.prepare(`UPDATE vendor_orders SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();
  return { id: p.id };
}
async function deleteOrder(DB, p) {
  await DB.batch([
    DB.prepare('DELETE FROM vendor_orders WHERE id=?').bind(p.id),
    DB.prepare('DELETE FROM vendor_progress WHERE "訂單id"=?').bind(p.id),
  ]);
  return { id: p.id };
}

/* ---------- 廠商單進度 ---------- */
async function addProgress(DB, p) {
  const id = newId('P');
  await DB.prepare(
    'INSERT INTO vendor_progress (id,"訂單id","完成日期","完成數量","總箱數","物流公司","包貨人員","備註","建立時間","批次id") VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, p['訂單id']||'', p['完成日期']||'', Number(p['完成數量'])||0, boxVal(p['總箱數']), p['物流公司']||'', p['包貨人員']||'', p['備註']||'', now(), p['批次id']||'').run();
  return { id };
}
async function addProgressBatch(DB, p) {
  const items = Array.isArray(p['items']) ? p['items'] : [];
  const n = now();
  const stmts = items.map(it => DB.prepare(
    'INSERT INTO vendor_progress (id,"訂單id","完成日期","完成數量","總箱數","物流公司","包貨人員","備註","建立時間","批次id") VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(newId('P'), p['訂單id']||'', p['完成日期']||'', Number(it['完成數量'])||0, boxVal(p['總箱數']), p['物流公司']||'', p['包貨人員']||'', it['備註']||'', n, p['批次id']||''));
  if (stmts.length) await DB.batch(stmts);
  return { ok: true, count: stmts.length };
}
async function deleteProgress(DB, p) {
  await DB.prepare('DELETE FROM vendor_progress WHERE id=?').bind(p.id).run();
  return { id: p.id };
}

/* ---------- 平台單 ---------- */
async function addPlatform(DB, p) {
  const id = newId('L'), n = now();
  const detail = Array.isArray(p['明細']) ? JSON.stringify(p['明細']) : (p['明細'] || '');
  await DB.prepare(
    'INSERT INTO platform_orders (id,"日期","平台","明細","總件數","已完成","完成日期","備註","建立時間","更新時間","來源平台","完成物流") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, p['日期']||'', p['平台']||'', detail, Number(p['總件數'])||0, p['已完成']?'TRUE':'', p['完成日期']||'', p['備註']||'', n, n, p['來源平台']||'', p['完成物流']||'').run();
  return { id };
}
async function updatePlatform(DB, p) {
  const sets = [], vals = [];
  for (const c of ['日期','平台','總件數','完成日期','備註','來源平台','完成物流']) {
    if (has(p, c)) { sets.push(`"${c}"=?`); vals.push(p[c]); }
  }
  if (has(p, '明細')) { sets.push('"明細"=?'); vals.push(Array.isArray(p['明細']) ? JSON.stringify(p['明細']) : p['明細']); }
  // 撿貨明細 / 注意明細 平常是出貨小幫手寫的,畫面上只讀;開放這裡更新是為了能修掉
  // 測試或誤上傳留下來的資料(送空陣列就是清空),不是給日常編輯用的
  for (const c of ['撿貨明細', '注意明細']) {
    if (has(p, c)) { sets.push(`"${c}"=?`); vals.push(Array.isArray(p[c]) ? JSON.stringify(p[c]) : p[c]); }
  }
  if (has(p, '已完成')) { sets.push('"已完成"=?'); vals.push(p['已完成'] ? 'TRUE' : ''); }
  sets.push('"更新時間"=?'); vals.push(now());
  vals.push(p.id);
  await DB.prepare(`UPDATE platform_orders SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();
  return { id: p.id };
}
async function deletePlatform(DB, p) {
  await DB.prepare('DELETE FROM platform_orders WHERE id=?').bind(p.id).run();
  return { id: p.id };
}

// 出貨小幫手(niyan_shipping)呼叫：當天同平台已有紀錄就把件數累加進對應物流，沒有就新增一筆
async function upsertPlatform(DB, p) {
  const date = String(p['日期'] || '').trim();
  const platform = String(p['平台'] || '').trim();
  const logi = String(p['物流'] || '').trim();
  const qty = Number(p['件數']) || 0;
  if (!date || !platform || qty <= 0) return { ok: true, skipped: true, updated: false, total: 0 };

  const existing = await DB.prepare(
    'SELECT * FROM platform_orders WHERE "日期"=? AND "平台"=? LIMIT 1'
  ).bind(date, platform).first();

  if (!existing) {
    const id = newId('L'), n = now();
    const detail = logi ? [{ 物流: logi, 件數: qty }] : [];
    await DB.prepare(
      'INSERT INTO platform_orders (id,"日期","平台","明細","總件數","已完成","完成日期","備註","建立時間","更新時間","來源平台","完成物流") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(id, date, platform, JSON.stringify(detail), qty, '', '', '', n, n, '', '').run();
    return { updated: false, total: qty, id };
  }

  const detail = jparse(existing['明細']);
  let found = false;
  const newDetail = detail.map(d => {
    if (logi && d['物流'] === logi) { found = true; return { ...d, 件數: (Number(d['件數']) || 0) + qty }; }
    return d;
  });
  if (!found) newDetail.push(logi ? { 物流: logi, 件數: qty } : { 件數: qty });
  const total = newDetail.reduce((s, d) => s + (Number(d['件數']) || 0), 0);
  const n = now();
  await DB.prepare('UPDATE platform_orders SET "明細"=?,"總件數"=?,"更新時間"=? WHERE id=?')
    .bind(JSON.stringify(newDetail), total, n, existing.id).run();
  return { updated: true, total, id: existing.id };
}

/* ---------- 報廢 ---------- */
async function addScrap(DB, p) {
  const id = newId('S');
  const detail = Array.isArray(p['明細']) ? JSON.stringify(p['明細']) : (p['明細'] || '');
  await DB.prepare('INSERT INTO scraps (id,"日期","明細","備註","建立時間") VALUES (?,?,?,?,?)')
    .bind(id, p['日期']||'', detail, p['備註']||'', now()).run();
  return { id };
}
async function deleteScrap(DB, p) {
  await DB.prepare('DELETE FROM scraps WHERE id=?').bind(p.id).run();
  return { id: p.id };
}

/* ---------- 設定 ---------- */
async function addSetting(DB, p) {
  const cat = String(p['類別'] || '').trim();
  const val = String(p['值'] || '').trim();
  if (!cat || !val) throw new Error('類別與值都不能為空');
  const dup = await DB.prepare('SELECT 1 FROM settings WHERE "類型"=? AND "值"=? LIMIT 1').bind(cat, val).first();
  if (dup) return { ok: true, duplicated: true };
  await DB.prepare('INSERT INTO settings ("類型","值") VALUES (?,?)').bind(cat, val).run();
  return { ok: true };
}
async function deleteSetting(DB, p) {
  const cat = String(p['類別'] || '').trim();
  const val = String(p['值'] || '').trim();
  if (!cat || !val) throw new Error('類別與值都不能為空');
  await DB.prepare('DELETE FROM settings WHERE "類型"=? AND "值"=?').bind(cat, val).run();
  return { ok: true };
}

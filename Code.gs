/**
 * 出貨幫手 - 多試算表接收端 v7
 *
 * v6(搬家到 Cloudflare Pages 後):這支 Apps Script 只剩「寫 Google 試算表」一個職責。
 *   前端不再直接打這支,而是打同站的 /api(Cloudflare Pages Function),
 *   由它把要寫試算表的動作原樣轉送過來。同事看的試算表格式、權限完全沒變。
 *   原本 v5 在這裡做的「同步包貨系統平台字卡」(離島•郵局 / Line禮物)已經移到
 *   Cloudflare 那邊直接寫 D1,省掉 UrlFetchApp 跨專案往返,上傳明顯變快。
 *   → 所以 v6 刪掉了 PACKING_API_URL / syncOffshoreToPacking / callPackingApi /
 *     handleUploadLineRegular。千萬不要再加回來,否則同一批件數會被灌兩次。
 *
 * 部署前必做:
 *   部署 → 新增部署 → Web App → 執行身分:我、誰可存取:任何人 → 取得 /exec 網址,
 *   貼到 Cloudflare Pages 專案的環境變數 GS_URL(前端程式碼裡不再有這個網址)。
 *
 * 支援動作:
 *   body.action === "append"            → 分類訂單寫入(雷雕/黑熊/永生花/注意品項/盆景公仔組/離島•郵局)
 *   body.action === "addProblem"        → 【已停用】問題訂單 2026-09-17 起改存 D1,前端不再呼叫
 *   body.action === "getProblems"       → 【已停用】同上
 *   body.action === "removeProblem"     → 【已停用】同上
 *   body.action === "addReturn"         → 【已停用】包裹退貨 2026-09-23 起改存 D1,前端不再呼叫
 *   body.action === "getReturns"        → 【已停用】同上
 *   body.action === "removeReturn"      → 【已停用】同上
 */

// ===== 分類對應的廠商試算表設定 =====
// 注意:永生花的 columns 比其他多一欄(從 qty 拆成 goldQty / pinkQty)
// 所有 spreadsheetId 直接寫死,不走 Script Properties
const SHEETS = {
  "雷雕": {
    spreadsheetId: "1yWvDnbI9w1ukexlaZWNAOyPHUS7JKMgGIDPV83wlSQ8",
    sheetName: "雷雕",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "黑熊": {
    spreadsheetId: "1SVuzdacjbJrX82pIRkkdB7B1kD3pF9nggkynzxzUTII",
    sheetName: "黑熊",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "永生花": {
    spreadsheetId: "1ihfosKQwK8B9IA1768tHEACykPxHuTgzqd26kkA2YwM",
    sheetName: "永生花",
    columns: ["date", "name", "address", "phone", "note", "orderId", "goldQty", "pinkQty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "黃金數量", "粉福數量"],
  },
  "注意品項": {
    spreadsheetId: "1dPGbWNIcslooHOkYtwIPc-moh88z1UR0aA1gTwZ-prU",
    sheetName: "注意品項",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "盆景公仔組": {
    spreadsheetId: "1hhx_HqK9m9XUxKQlGXcRYdY20Qpfg_zN9vTJW1U44Ts",
    sheetName: "盆景公仔組",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  // 離島•郵局:地址含台灣離島縣市(澎湖/金門/連江/馬祖)的訂單,不用黑貓改用郵局寄
  "離島•郵局": {
    spreadsheetId: "1eV6lcWJ1nEs-As32NU6iatYAih-NYQ5WZfGteWDlk5A",
    sheetName: "離島包裹",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty", "island"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量", "離島縣市"],
  },
};

// ===== 問題訂單 =====
const PROBLEM_SHEET_ID = "1lbEXKYvUzFljxdZmBdg1K0GzOahbnBH39bbANMZ34d4";
const PROBLEMS_SHEET = "問題訂單";
const PROBLEMS_HEADERS = ["加入時間", "訂單編號", "問題類別", "備註"];

// ===== 包裹退貨【已停用】=====
// 2026-09-23 起改存 Cloudflare D1(shipping_returns),舊試算表的 26 筆已經整批匯進去,
// 前端不會再送 addReturn/getReturns/removeReturn 過來。下面這些留著只是為了舊試算表
// 還能被手動開啟查看,可以放心無視。
// (舊格式:同一張工作表裡橫向並排三個平台區塊,不是分頁簽,所以絕對不能用
//  sheet.deleteRow()/getLastRow() 整列處理,否則會把旁邊其他平台的資料錯位或誤刪。)
const RETURNS_SHEET_ID = "1bMPA6GQ-tVaju85BFm9ETHOuG6hfGjPQfsDLtTWcEnk";
const RETURNS_SHEET_NAME = "工作表1";
const RETURNS_HEADER_ROW = 1;
const RETURNS_DATA_START_ROW = 2;

const RETURN_BLOCKS = {
  "line禮物": {
    startCol: 1, // A
    columns: ["date", "orderId", "trackingNo", "reason", "result", "contact1", "contact2", "contact3", "contact4"],
    headers: ["日期", "訂單編號", "託運單號", "原因", "結果", "第一次電聯", "第二次電聯", "第三次電聯", "第四次電聯"],
  },
  "蝦皮": {
    startCol: 10, // J(I 到 J 之間無空隔欄)
    columns: ["date", "orderId", "trackingNo", "reason", "result"],
    headers: ["日期", "訂單編號", "託運單號", "原因", "結果"],
  },
  "mo": {
    startCol: 16, // P(N、P 之間留一欄 O 當間隔)
    columns: ["date", "orderId", "trackingNo", "reason", "result"],
    headers: ["日期", "訂單編號", "託運單號", "原因", "結果"],
  },
};

// =============================================================
// 入口
// =============================================================
// ===== 可安全重試(requestId 去重) =====
// Apps Script 的 /exec POST 會先回 302,轉到 googleusercontent 的一次性網址才拿得到內容,
// 那一段 Google 偶發 404(2026-09-23 實測連打三次:一次 200、兩次 404)。
// 麻煩的是 404 發生在腳本「已經執行完、列已經寫進試算表」之後 —— 呼叫端看到失敗就重試的話,
// 同一批訂單會被寫兩次。所以呼叫端每次上傳帶一個 requestId,重試時沿用同一個;
// 這裡把跑過的 requestId 連同回應存進 Script Cache(6 小時),重複進來就直接回上次的結果,
// 不再寫第二次。CacheService 存不下(>100KB)就當沒存過,頂多退回舊行為,不會擋住正常上傳。
const REQ_CACHE_PREFIX = "req:";
const REQ_CACHE_SEC = 21600;   // 6 小時

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || "append";
    const reqId = String(body.requestId || "").trim();

    // 只有會寫入的動作需要去重;讀取類的重跑沒有副作用
    if (reqId) {
      const cached = readRequestCache(reqId);
      if (cached) {
        return ContentService.createTextOutput(cached)
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    const out = doPostInner(action, body);
    if (reqId) writeRequestCache(reqId, out.getContent());
    return out;
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function readRequestCache(reqId) {
  try {
    return CacheService.getScriptCache().get(REQ_CACHE_PREFIX + reqId);
  } catch (err) {
    return null;
  }
}

function writeRequestCache(reqId, content) {
  try {
    CacheService.getScriptCache().put(REQ_CACHE_PREFIX + reqId, content, REQ_CACHE_SEC);
  } catch (err) { /* 存不下就算了,不影響這次的回應 */ }
}

function doPostInner(action, body) {
  try {
    switch (action) {
      case "append":            return handleAppend(body);
      case "addProblem":        return handleAddProblem(body);
      case "getProblems":       return handleGetProblems();
      case "removeProblem":     return handleRemoveProblem(body);
      case "addReturn":         return handleAddReturn(body);
      case "getReturns":        return handleGetReturns();
      case "removeReturn":      return handleRemoveReturn(body);
      default:
        return jsonResponse({ ok: false, error: "未知 action: " + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function doGet() {
  return jsonResponse({ ok: true, message: "出貨幫手接收端運作中 v7(只負責寫試算表,requestId 可安全重試)" });
}


// =============================================================
// 1. 分類訂單寫入
// =============================================================
function handleAppend(body) {
  const targets = body.targets || {};
  const results = {};
  let totalWritten = 0;

  for (const [category, rows] of Object.entries(targets)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const cfg = SHEETS[category];
    if (!cfg) {
      results[category] = { ok: false, error: `未知分類: ${category}` };
      continue;
    }

    try {
      const ss = SpreadsheetApp.openById(cfg.spreadsheetId);
      let sheet = ss.getSheetByName(cfg.sheetName);

      // 若工作表不存在,自動建立並補表頭
      if (!sheet) {
        sheet = ss.insertSheet(cfg.sheetName);
        sheet.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]);
        sheet.setFrozenRows(1);
      } else if (category === "永生花") {
        // 永生花特殊處理:若舊表只有 7 欄,自動升級為 8 欄(在原數量欄旁多加一欄)
        // 不改動既有資料,只把表頭補成新版
        const lastCol = sheet.getLastColumn();
        if (lastCol < cfg.headers.length) {
          // 只補表頭,不動資料(舊資料的數量會留在第 7 欄,新資料用新格式寫入)
          sheet.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]);
        }
      }

      const values = rows.map(r => cfg.columns.map(k => r[k] ?? ""));
      sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length)
           .setValues(values);

      results[category] = { ok: true, count: values.length };
      totalWritten += values.length;
    } catch (err) {
      results[category] = { ok: false, error: err.toString() };
    }
  }

  return jsonResponse({ ok: true, totalWritten: totalWritten, results: results });
}

// =============================================================
// 2. 問題訂單【已停用】
// 2026-09-17 起問題訂單改存 Cloudflare D1(shipping_problems),
// 前端不會再送 addProblem/getProblems/removeProblem 過來。
// 這段程式碼留著只是為了舊試算表還能被手動開啟查看,可以放心無視。
// =============================================================
function ensureProblemsSheet() {
  const ss = SpreadsheetApp.openById(PROBLEM_SHEET_ID);
  let sheet = ss.getSheetByName(PROBLEMS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROBLEMS_SHEET);
    sheet.getRange(1, 1, 1, PROBLEMS_HEADERS.length).setValues([PROBLEMS_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, PROBLEMS_HEADERS.length)
         .setBackground("#1a1f2b").setFontColor("#f778ba").setFontWeight("bold");
    sheet.setColumnWidth(1, 140);  // 加入時間
    sheet.setColumnWidth(2, 180);  // 訂單編號
    sheet.setColumnWidth(3, 140);  // 問題類別
    sheet.setColumnWidth(4, 320);  // 備註
  } else {
    // 既存的工作表若還是舊的 3 欄表頭(處理方式),自動升級為新的 4 欄表頭
    const firstRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 3)).getValues()[0];
    const headerStr = firstRow.map(v => String(v || "").trim()).join("|");
    const isLegacy = headerStr.includes("處理方式") && !headerStr.includes("問題類別");
    if (isLegacy) {
      sheet.getRange(1, 1, 1, PROBLEMS_HEADERS.length).setValues([PROBLEMS_HEADERS]);
      sheet.getRange(1, 1, 1, PROBLEMS_HEADERS.length)
           .setBackground("#1a1f2b").setFontColor("#f778ba").setFontWeight("bold");
    }
  }
  return sheet;
}

function handleAddProblem(body) {
  const p = body.problem || {};
  const orderId = String(p.orderId || "").trim();
  let type = String(p.type || p.action || "").trim();
  const note = String(p.note || "").trim();

  if (!orderId) return jsonResponse({ ok: false, error: "缺少訂單編號" });
  if (!type) type = "其他";

  const sheet = ensureProblemsSheet();
  const now = new Date();
  const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm");

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "").trim() === orderId) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, 1, 1, 4).setValues([[timestamp, orderId, type, note]]);
        return jsonResponse({ ok: true, updated: true, rowIndex: rowNum });
      }
    }
  }

  sheet.appendRow([timestamp, orderId, type, note]);
  return jsonResponse({ ok: true, updated: false, rowIndex: sheet.getLastRow() });
}

function handleGetProblems() {
  const sheet = ensureProblemsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ ok: true, problems: [] });

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const problems = [];
  data.forEach((row, idx) => {
    const orderId = String(row[1] || "").trim();
    if (!orderId) return;
    const createdAt = row[0] instanceof Date
      ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm")
      : String(row[0] || "");
    problems.push({
      rowIndex: idx + 2,
      createdAt: createdAt,
      orderId: orderId,
      type: String(row[2] || "").trim(),
      note: String(row[3] || "").trim(),
    });
  });
  return jsonResponse({ ok: true, problems: problems });
}

function handleRemoveProblem(body) {
  const rowIndex = parseInt(body.rowIndex, 10);
  const orderId = String(body.orderId || "").trim();

  const sheet = ensureProblemsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ ok: false, error: "清單是空的" });

  let target = -1;
  if (rowIndex >= 2 && rowIndex <= lastRow) {
    const oid = String(sheet.getRange(rowIndex, 2).getValue() || "").trim();
    if (!orderId || oid === orderId) target = rowIndex;
  }
  if (target < 0 && orderId) {
    const data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0] || "").trim() === orderId) { target = i + 2; break; }
    }
  }

  if (target < 0) return jsonResponse({ ok: false, error: "找不到對應的問題訂單" });

  sheet.deleteRow(target);
  return jsonResponse({ ok: true, deletedRow: target });
}


// =============================================================
// 3. 包裹退貨【已停用】
// 2026-09-23 起改存 Cloudflare D1(shipping_returns),前端不再呼叫這一段。
// =============================================================
function getReturnsSheet() {
  const ss = SpreadsheetApp.openById(RETURNS_SHEET_ID);
  let sheet = ss.getSheetByName(RETURNS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(RETURNS_SHEET_NAME);

  // 每個平台區塊的表頭若還是空的才補(不動既有資料/表頭)
  for (const cfg of Object.values(RETURN_BLOCKS)) {
    const existing = sheet.getRange(RETURNS_HEADER_ROW, cfg.startCol, 1, cfg.headers.length).getValues()[0];
    const isEmpty = existing.every(v => String(v || "").trim() === "");
    if (isEmpty) {
      sheet.getRange(RETURNS_HEADER_ROW, cfg.startCol, 1, cfg.headers.length).setValues([cfg.headers]);
    }
  }
  sheet.setFrozenRows(1);
  return sheet;
}

// 只看該平台區塊自己的欄位範圍,找出最後一筆有資料的列號
// (三個平台橫向並排在同一張表,不能用 sheet.getLastRow(),那是整張表的最後一列)
function getBlockLastRow(sheet, cfg) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < RETURNS_DATA_START_ROW) return RETURNS_HEADER_ROW;
  const values = sheet.getRange(
    RETURNS_DATA_START_ROW, cfg.startCol,
    maxRows - RETURNS_DATA_START_ROW + 1, cfg.columns.length
  ).getValues();
  let lastRow = RETURNS_HEADER_ROW;
  for (let i = 0; i < values.length; i++) {
    if (values[i].some(v => String(v || "").trim() !== "")) {
      lastRow = RETURNS_DATA_START_ROW + i;
    }
  }
  return lastRow;
}

function handleAddReturn(body) {
  const platform = String(body.platform || "").trim();
  const cfg = RETURN_BLOCKS[platform];
  if (!cfg) return jsonResponse({ ok: false, error: "未知平台: " + platform });

  const r = body.record || {};
  const orderId = String(r.orderId || "").trim();
  if (!orderId) return jsonResponse({ ok: false, error: "缺少訂單編號" });

  const sheet = getReturnsSheet();
  const values = cfg.columns.map(k => r[k] ?? "");
  const orderIdColIdx = cfg.columns.indexOf("orderId");
  const lastRow = getBlockLastRow(sheet, cfg);

  // 同平台若已有相同訂單編號,直接更新該列,不新增重複列
  if (lastRow >= RETURNS_DATA_START_ROW) {
    const ids = sheet.getRange(
      RETURNS_DATA_START_ROW, cfg.startCol + orderIdColIdx,
      lastRow - RETURNS_DATA_START_ROW + 1, 1
    ).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "").trim() === orderId) {
        const rowNum = RETURNS_DATA_START_ROW + i;
        sheet.getRange(rowNum, cfg.startCol, 1, values.length).setValues([values]);
        return jsonResponse({ ok: true, updated: true, rowIndex: rowNum });
      }
    }
  }

  const newRow = Math.max(lastRow + 1, RETURNS_DATA_START_ROW);
  sheet.getRange(newRow, cfg.startCol, 1, values.length).setValues([values]);
  return jsonResponse({ ok: true, updated: false, rowIndex: newRow });
}

function handleGetReturns() {
  const sheet = getReturnsSheet();
  const result = {};

  for (const [platform, cfg] of Object.entries(RETURN_BLOCKS)) {
    const lastRow = getBlockLastRow(sheet, cfg);
    const list = [];
    if (lastRow >= RETURNS_DATA_START_ROW) {
      const values = sheet.getRange(
        RETURNS_DATA_START_ROW, cfg.startCol,
        lastRow - RETURNS_DATA_START_ROW + 1, cfg.columns.length
      ).getValues();
      values.forEach((row, idx) => {
        const rec = {};
        let hasData = false;
        cfg.columns.forEach((key, colIdx) => {
          let v = row[colIdx];
          if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
          v = (v === null || v === undefined) ? "" : String(v);
          if (v.trim() !== "") hasData = true;
          rec[key] = v;
        });
        if (hasData) {
          rec.rowIndex = RETURNS_DATA_START_ROW + idx;
          list.push(rec);
        }
      });
    }
    result[platform] = list;
  }

  return jsonResponse({ ok: true, returns: result });
}

function handleRemoveReturn(body) {
  const platform = String(body.platform || "").trim();
  const cfg = RETURN_BLOCKS[platform];
  if (!cfg) return jsonResponse({ ok: false, error: "未知平台: " + platform });

  const rowIndex = parseInt(body.rowIndex, 10);
  const orderId = String(body.orderId || "").trim();

  const sheet = getReturnsSheet();
  const lastRow = getBlockLastRow(sheet, cfg);
  if (lastRow < RETURNS_DATA_START_ROW) return jsonResponse({ ok: false, error: "清單是空的" });

  const orderIdColIdx = cfg.columns.indexOf("orderId");
  let target = -1;
  if (rowIndex >= RETURNS_DATA_START_ROW && rowIndex <= lastRow) {
    const oid = String(sheet.getRange(rowIndex, cfg.startCol + orderIdColIdx).getValue() || "").trim();
    if (!orderId || oid === orderId) target = rowIndex;
  }
  if (target < 0 && orderId) {
    const ids = sheet.getRange(
      RETURNS_DATA_START_ROW, cfg.startCol + orderIdColIdx,
      lastRow - RETURNS_DATA_START_ROW + 1, 1
    ).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "").trim() === orderId) { target = RETURNS_DATA_START_ROW + i; break; }
    }
  }
  if (target < 0) return jsonResponse({ ok: false, error: "找不到對應的退貨紀錄" });

  // 不能用 sheet.deleteRow(),那會影響到同一列旁邊其他平台的欄位。
  // 只把該平台欄位範圍內、目標列以下的資料整塊往上搬一列,最後一列清空。
  const numCols = cfg.columns.length;
  if (target < lastRow) {
    const below = sheet.getRange(target + 1, cfg.startCol, lastRow - target, numCols).getValues();
    sheet.getRange(target, cfg.startCol, lastRow - target, numCols).setValues(below);
  }
  sheet.getRange(lastRow, cfg.startCol, 1, numCols).clearContent();

  return jsonResponse({ ok: true, deletedRow: target });
}


// =============================================================
// Util
// =============================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

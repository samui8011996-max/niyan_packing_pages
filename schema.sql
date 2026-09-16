DROP TABLE IF EXISTS vendor_orders;
CREATE TABLE vendor_orders (
  "id" TEXT PRIMARY KEY,
  "下單日期" TEXT,
  "交期" TEXT,
  "廠商" TEXT,
  "門市" TEXT,
  "訂單編號" TEXT,
  "備註" TEXT,
  "品項" TEXT,
  "建立時間" TEXT,
  "更新時間" TEXT
);

DROP TABLE IF EXISTS vendor_progress;
CREATE TABLE vendor_progress (
  "id" TEXT PRIMARY KEY,
  "訂單id" TEXT,
  "完成日期" TEXT,
  "完成數量" INTEGER,
  "總箱數" INTEGER,
  "物流公司" TEXT,
  "包貨人員" TEXT,
  "備註" TEXT,
  "建立時間" TEXT,
  "批次id" TEXT
);
CREATE INDEX idx_vp_oid ON vendor_progress("訂單id");

DROP TABLE IF EXISTS platform_orders;
CREATE TABLE platform_orders (
  "id" TEXT PRIMARY KEY,
  "日期" TEXT,
  "平台" TEXT,
  "明細" TEXT,
  "總件數" INTEGER,
  "已完成" TEXT,
  "完成日期" TEXT,
  "備註" TEXT,
  "建立時間" TEXT,
  "更新時間" TEXT,
  "來源平台" TEXT,
  "完成物流" TEXT
);

DROP TABLE IF EXISTS scraps;
CREATE TABLE scraps (
  "id" TEXT PRIMARY KEY,
  "日期" TEXT,
  "明細" TEXT,
  "備註" TEXT,
  "建立時間" TEXT
);

DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
  "ID" TEXT PRIMARY KEY,
  "下單日期" TEXT,
  "廠商" TEXT,
  "品項" TEXT,
  "顏色" TEXT,
  "大小" TEXT,
  "大小備註" TEXT,
  "數量" INTEGER,
  "交期" TEXT,
  "急單" TEXT,
  "建立時間" TEXT,
  "款式" TEXT,
  "備註" TEXT,
  "已隱藏" TEXT,
  "手動順序" INTEGER,
  "已完成" TEXT,
  "完成日期" TEXT
);

DROP TABLE IF EXISTS mfg_records;
CREATE TABLE mfg_records (
  "ID" TEXT PRIMARY KEY,
  "訂單ID" TEXT,
  "完成日期" TEXT,
  "製作師傅" TEXT,
  "數量" INTEGER,
  "建立時間" TEXT,
  "報廢" TEXT
);
CREATE INDEX idx_mfg_records_oid ON mfg_records("訂單ID");

DROP TABLE IF EXISTS wash_records;
CREATE TABLE wash_records (
  "ID" TEXT PRIMARY KEY,
  "訂單ID" TEXT,
  "清洗日期" TEXT,
  "清洗人員" TEXT,
  "數量" INTEGER,
  "建立時間" TEXT,
  "報廢" TEXT
);
CREATE INDEX idx_wash_records_oid ON wash_records("訂單ID");

DROP TABLE IF EXISTS grind_records;
CREATE TABLE grind_records (
  "ID" TEXT PRIMARY KEY,
  "訂單ID" TEXT,
  "研磨日期" TEXT,
  "研磨人員" TEXT,
  "數量" INTEGER,
  "建立時間" TEXT,
  "報廢" TEXT
);
CREATE INDEX idx_grind_records_oid ON grind_records("訂單ID");

DROP TABLE IF EXISTS settings;
CREATE TABLE settings (
  "類型" TEXT,
  "值" TEXT
);

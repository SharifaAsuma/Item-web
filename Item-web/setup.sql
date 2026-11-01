-- =====================================================================
--  i2c.item テーブルを作ります(1回だけ実行)
--
--  【実行のしかた】
--   1. MySQL Workbench で、このファイルの中身を Query タブに貼り付ける
--   2. 稲妻マーク(⚡)の「Execute」ボタンで実行する
--
--  ・すでに item テーブルがある場合は何もしません(既存データは消えません)。
--  ・config.properties の auto.create.table=true のままなら、
--    アプリ起動時にも同じテーブルが自動で作られるので、このSQLは省略できます。
-- =====================================================================
USE i2c;

CREATE TABLE IF NOT EXISTS item (
  ID            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ITEM_NAME     VARCHAR(100) NOT NULL,                 -- 名前
  CATEGORY      VARCHAR(50)  NOT NULL DEFAULT '未分類', -- カテゴリ
  LOCATION      VARCHAR(100) NOT NULL DEFAULT '',       -- 保管場所
  PURCHASE_DATE DATE         NULL,                      -- 購入日
  PRICE         INT          NOT NULL DEFAULT 0,        -- 値段(円)
  SHOP_NAME     VARCHAR(100) NOT NULL DEFAULT '',       -- 購入店舗
  WARRANTY_DATE DATE         NULL,                      -- 保証期限
  ITEM_MEMO     VARCHAR(500) NOT NULL DEFAULT '',       -- 備考
  DISPOSAL_DATE DATE         NULL                       -- 手放した日(NULL = まだ持っている)
) DEFAULT CHARSET = utf8mb4;

-- 確認用
DESCRIBE item;
SELECT * FROM item;

-- 【元に戻すとき用】通常は実行しないでください(データも消えます)
-- DROP TABLE item;

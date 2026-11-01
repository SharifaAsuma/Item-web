# 所持品管理(Web版 / MySQL / HTML・CSS・JS)

ブラウザで使う所持品管理アプリです。冷蔵庫の食材管理アプリ(FridgeWeb)と同じ作りで、
- サーバー側: Java(JDK標準のWebサーバー) + MySQL(スキーマ `i2c` の `item` テーブル)
- 画面側: HTML・CSS・JavaScript(`src/main/resources/static`)

画面は背景が真っ白で、丸みのあるボタンを使ったシンプルなデザインです。

## 必要なもの
- JDK 11 以上 (`java -version` で確認)
- Maven (`mvn -v` で確認)
- MySQL が起動していること(スキーマ `i2c` があること)

## 準備(初回だけ)
1. **`config.properties` の `db.password` に、MySQL のパスワードを書く**
2. テーブルの作成(どちらか)
   - そのまま起動する → `auto.create.table=true` なので、`i2c.item` が無ければ自動で作られます
   - 先に作っておきたい場合 → MySQL Workbench で `setup.sql` を実行

## 起動手順
`pom.xml` があるフォルダで:

```
mvn package
java -jar target/belongings-web.jar
```

「★ 起動しました」と出たら、ブラウザで http://localhost:8080/ を開きます。終了は Ctrl+C。

### VS Code の Run ボタンで動かす場合
1. 「フォルダを開く」で、`pom.xml` があるこのフォルダを直接開く
2. 右下の Maven 読み込みが終わるのを待つ
3. `src/main/java/com/example/belongings/Main.java` の `main` の上の **Run** をクリック
4. ブラウザで http://localhost:8080/ を開く

## 主な機能
- 所持品の追加・編集・削除
- 検索(名前・保管場所・店舗・備考)、カテゴリでの絞り込み、列見出しクリックでの並び替え
- 上部に「所持品の点数」「購入金額の合計」「保証期限が近い点数」を表示
- 保証期限が近い(既定30日以内)・保証切れの行を色で表示
- 「手放した」ボタンで、その所持品の `DISPOSAL_DATE` に今日の日付が入り、一覧から隠れます。
  「手放した所持品も表示」にチェックを入れると、グレーで表示され、取消ボタンでいつでも戻せます
- 購入日・保証期限・保管場所・購入店舗は未入力でも登録できます
- 購入店舗・保管場所の候補は `config.properties` の `store.presets` / `location.presets` と、
  過去に入力した値から自動で出ます

## i2c.item テーブルの列
| 画面の項目 | 列名 | 型 |
|---|---|---|
| 名前 | ITEM_NAME | VARCHAR(100) NOT NULL |
| カテゴリ | CATEGORY | VARCHAR(50) NOT NULL |
| 保管場所 | LOCATION | VARCHAR(100) |
| 購入日 | PURCHASE_DATE | DATE NULL |
| 値段 | PRICE | INT |
| 購入店舗 | SHOP_NAME | VARCHAR(100) |
| 保証期限 | WARRANTY_DATE | DATE NULL |
| 備考 | ITEM_MEMO | VARCHAR(500) |
| 手放した日 | DISPOSAL_DATE | DATE NULL |

**すでに `i2c.item` がある場合**は、`config.properties` の `col.*` を実際の列名に合わせてください
(足りない列は `ALTER TABLE item ADD COLUMN ...` で追加してください)。

## ファイルの構成
```
src/main/java/com/example/belongings/
  Main.java              起動処理
  Config.java            config.properties の読み込み
  Item.java              所持品1件分のデータ
  ItemRepository.java    DB操作の窓口(インターフェース)
  JdbcItemRepository.java 実際のSQL
  ApiServer.java         /api/... のJSON API と 画面ファイルの配信
  Json.java              簡易JSON変換
  StaticFiles.java       jar実行時に画面ファイルを取り出す処理
src/main/resources/static/
  index.html / style.css / script.js
```

## うまくいかないとき
コンソールに出る `[ERROR]` の行を確認してください。
- 「Access denied」 → `db.user` / `db.password` を確認
- 「列 ○○ が見つかりません」 → 既存テーブルの列名と `col.*` の設定が合っていません
- 「Communications link failure」 → MySQL が起動しているか、`localhost:3306` で合っているか確認
- ポートが使用中 → `server.port` を 8081 などに変更

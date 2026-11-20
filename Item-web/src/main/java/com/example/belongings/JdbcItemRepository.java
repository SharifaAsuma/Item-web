package main.java.com.example.belongings;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * JDBC を使って、実際にデータベースへ読み書きするクラス。
 * SQL文はこのクラスの中だけに書いている。
 * テーブル名・列名は config.properties の設定を使うので、既存のテーブルにも合わせられる。
 *
 * 既存テーブルに合わせるための工夫:
 * - 列名にスペースがあっても動くよう、テーブル名・列名は必ず引用符で囲む(MySQL なら `EXPIRATION DATE`)
 * - 値段の列が文字列型(VARCHAR)でも数値型でも動く(自動判定)
 * - ID列が自動採番でなくても動く(設定 id.auto.increment=false のとき)
 * - 「手放した日」の列が NULL(まだ使い切っていない)の行だけを一覧に出す
 */
public class JdbcItemRepository implements ItemRepository {

  private final Config c;

  /**
   * テーブル名・列名を囲む記号。DBごとに違う(MySQL は ` 、他は " )ので、
   * initialize() で DB に問い合わせて設定する。
   */
  private String quote = "\"";

  /** 値段の列が文字列型(VARCHAR など)か。initialize() で自動判定する */
  private boolean priceIsText = false;

  public JdbcItemRepository(Config config) {
    this.c = config;
  }

  // =====================================================================
  // 起動時の準備
  // =====================================================================

  /**
   * 起動時に1回呼ぶ。
   * 1. DBに接続できるか確認する(あわせて、引用符の種類を調べる)
   * 2. (設定が true で、テーブルが無ければ)テーブルを作成する
   * 3. 設定したテーブル名・列名が実在するか、1つずつ確認する
   */
  public void initialize() throws SQLException {
    try (Connection conn = open()) {
      DatabaseMetaData meta = conn.getMetaData();
      String product = meta.getDatabaseProductName();

      String qs = meta.getIdentifierQuoteString();
      if (qs != null && !qs.trim().isEmpty()) {
        quote = qs.trim();
      }
      System.out.println("DB接続OK / DB connected: " + product);

      if (c.autoCreateTable && !tableExists(conn)) {
        try (Statement st = conn.createStatement()) {
          st.execute(createTableSql(product));
        }
        System.out.println("テーブル " + c.table + " を作成しました / Created table: " + c.table);
      }

      checkTableAndColumns(conn);

      // 保管場所の並び順を覚えておくテーブル(無ければ作る)
      try (Statement st = conn.createStatement()) {
        st.execute("CREATE TABLE IF NOT EXISTS item_location ("
            + "location_name VARCHAR(100) NOT NULL PRIMARY KEY, "
            + "sort_order INT NOT NULL DEFAULT 0)");
      }
    }
  }

  /** テーブルと各列が実在するか確認する。無いものがあれば、どの設定が合っていないかを示す */
  private void checkTableAndColumns(Connection conn) throws SQLException {
    if (!tableExists(conn)) {
      throw new SQLException("テーブル「" + c.table + "」が見つかりません。"
          + "config.properties の table と、db.url の末尾のデータベース名を確認してください。" + " (Table not found: "
          + c.table + ")");
    }

    String[][] columns = {{"col.id", c.colId}, {"col.name", c.colName},
        {"col.category", c.colCategory}, {"col.location", c.colLocation},
        {"col.purchase", c.colPurchase}, {"col.price", c.colPrice}, {"col.store", c.colStore},
        {"col.warranty", c.colWarranty}, {"col.note", c.colNote}, {"col.dispose", c.colDispose}};

    for (String[] col : columns) {
      // 0件しか返さないSELECTで、その列が存在するかだけを確かめる
      String sql = "SELECT " + q(col[1]) + " FROM " + q(c.table) + " WHERE 1 = 0";
      try (Statement st = conn.createStatement(); ResultSet rs = st.executeQuery(sql)) {
        if (col[0].equals("col.price")) {
          priceIsText = isTextType(rs.getMetaData().getColumnType(1));
        }
      } catch (SQLException e) {
        String hint = "";
        if (col[0].equals("col.category")) {
          hint = " テーブルが未作成の場合は、setup.sql を実行してください。";
        } else if (col[0].equals("col.dispose")) {
          hint = " 「手放した日」の列名を config.properties の col.dispose で指定してください。";
        }
        throw new SQLException("列「" + col[1] + "」(設定 " + col[0] + ")が、テーブル「" + c.table
            + "」に見つかりません。" + hint + " (Column not found) 詳細: " + e.getMessage(), e);
      }
    }
  }

  /** テーブルが存在するか。実際に軽いSELECTを投げて、失敗したら「無い」とみなす */
  private boolean tableExists(Connection conn) {
    try (Statement st = conn.createStatement()) {
      st.executeQuery("SELECT 1 FROM " + q(c.table) + " WHERE 1 = 0").close();
      return true;
    } catch (SQLException e) {
      return false;
    }
  }

  /** 文字列型の列かどうか */
  private boolean isTextType(int sqlType) {
    return sqlType == Types.CHAR || sqlType == Types.VARCHAR || sqlType == Types.LONGVARCHAR
        || sqlType == Types.NCHAR || sqlType == Types.NVARCHAR || sqlType == Types.LONGNVARCHAR;
  }

  /** DBの種類に合わせたテーブル作成SQLを作る(ID自動採番の書き方がDBごとに違うため) */
  private String createTableSql(String product) throws SQLException {
    String p = product.toLowerCase();
    String idType;
    if (p.contains("sqlite")) {
      idType = "INTEGER PRIMARY KEY AUTOINCREMENT";
    } else if (p.contains("mysql") || p.contains("mariadb")) {
      idType = "INT AUTO_INCREMENT PRIMARY KEY";
    } else if (p.contains("postgres")) {
      idType = "SERIAL PRIMARY KEY";
    } else if (p.contains("microsoft") || p.contains("sql server")) {
      idType = "INT IDENTITY(1,1) PRIMARY KEY";
    } else {
      throw new SQLException("このDB(" + product + ")ではテーブルを自動作成できません。手動で作成してください。");
    }
    return "CREATE TABLE " + q(c.table) + " (" + q(c.colId) + " " + idType + ", " + q(c.colName)
        + " VARCHAR(100) NOT NULL, " + q(c.colCategory) + " VARCHAR(50) NOT NULL DEFAULT '未分類', "
        + q(c.colLocation) + " VARCHAR(100) NOT NULL DEFAULT '', " + q(c.colPurchase)
        + " DATE NULL, " + q(c.colPrice) + " INT NOT NULL DEFAULT 0, " + q(c.colStore)
        + " VARCHAR(100) NOT NULL DEFAULT '', " + q(c.colWarranty) + " DATE NULL, " + q(c.colNote)
        + " VARCHAR(500) NOT NULL DEFAULT '', " + q(c.colDispose) + " DATE NULL" + ")";
  }

  // =====================================================================
  // SQL文の組み立て(テーブル名・列名は必ず q() で囲む)
  // =====================================================================

  /** 名前を引用符で囲む。例: EXPIRATION DATE → `EXPIRATION DATE` (スペース入りの列名対策) */
  private String q(String name) {
    return quote + name + quote;
  }

  /** SELECT する列の並び(この順番で ResultSet から読み取る) */
  private String selectColumns() {
    return String.join(", ", q(c.colId), q(c.colName), q(c.colCategory), q(c.colLocation),
        q(c.colPurchase), q(c.colPrice), q(c.colStore), q(c.colWarranty), q(c.colNote),
        q(c.colDispose));
  }

  /**
   * 一覧取得のSQL。新しく登録した順(IDの大きい順)。
   * includeDisposed が false のときは、手放した日が入っている行を除く。
   */
  private String listSql(boolean filterByCategory, boolean includeDisposed) {
    StringBuilder sql =
        new StringBuilder("SELECT " + selectColumns() + " FROM " + q(c.table) + " WHERE 1 = 1");
    if (filterByCategory) {
      sql.append(" AND ").append(q(c.colCategory)).append(" = ?");
    }
    if (!includeDisposed) {
      sql.append(" AND ").append(q(c.colDispose)).append(" IS NULL");
    }
    sql.append(" ORDER BY ").append(q(c.colId)).append(" DESC");
    return sql.toString();
  }

  private String findByIdSql() {
    return "SELECT " + selectColumns() + " FROM " + q(c.table) + " WHERE " + q(c.colId) + " = ?";
  }

  /** 登録のSQL。? は「名前, カテゴリ, 保管場所, 購入日, 値段, 購入店舗, 保証期限, 備考」の8個(手放した日は常にNULLで登録) */
  private String insertSql() {
    String cols = q(c.colName) + ", " + q(c.colCategory) + ", " + q(c.colLocation) + ", "
        + q(c.colPurchase) + ", " + q(c.colPrice) + ", " + q(c.colStore) + ", " + q(c.colWarranty)
        + ", " + q(c.colNote) + ", " + q(c.colDispose);

    // 「使い切った日」を編集するために、以下の部分を変更
    // 【変更前】
    // VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    if (c.idAutoIncrement) {
      return "INSERT INTO " + q(c.table) + " (" + cols + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    }
    // ID列が自動採番でない場合: 「いまの最大ID + 1」を新しいIDにして登録する
    return "INSERT INTO " + q(c.table) + " (" + q(c.colId) + ", " + cols + ") "
        + "SELECT COALESCE(MAX(" + q(c.colId) + "), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM "
        + q(c.table);
  }

  // 「使い切った日」を編集するために、以下の部分を変更
  // 【変更前】
  // + q(c.colWarranty) + " = ?, " + q(c.colNote) + " = ? WHERE "
  /** 更新のSQL。手放した日はここでは変更しない(専用の dispose SQLで扱う)。? は8個 + 最後に WHERE の ID */
  private String updateSql() {
    return "UPDATE " + q(c.table) + " SET " + q(c.colName) + " = ?, " + q(c.colCategory) + " = ?, "
        + q(c.colLocation) + " = ?, " + q(c.colPurchase) + " = ?, " + q(c.colPrice) + " = ?, "
        + q(c.colStore) + " = ?, " + q(c.colWarranty) + " = ?, " + q(c.colNote) + " = ?, "
        + q(c.colDispose) + " = ? WHERE " + q(c.colId) + " = ?";
  }

  private String deleteSql() {
    return "DELETE FROM " + q(c.table) + " WHERE " + q(c.colId) + " = ?";
  }

  /** 手放した日を設定する(? に日付、次にID) */
  private String setDisposalSql() {
    return "UPDATE " + q(c.table) + " SET " + q(c.colDispose) + " = ? WHERE " + q(c.colId) + " = ?";
  }

  /** 手放した日を NULL に戻す(取り消し用) */
  private String clearDisposalSql() {
    return "UPDATE " + q(c.table) + " SET " + q(c.colDispose) + " = NULL WHERE " + q(c.colId)
        + " = ?";
  }

  // =====================================================================
  // 取得・登録・更新・削除
  // =====================================================================

  @Override
  public List<Item> findAll(String category, boolean includeDisposed) throws SQLException {
    List<Item> list = new ArrayList<>();
    try (Connection conn = open();
        PreparedStatement ps = conn.prepareStatement(listSql(category != null, includeDisposed))) {
      if (category != null) {
        ps.setString(1, category);
      }
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          list.add(toItem(rs));
        }
      }
    }
    return list;
  }

  @Override
  public Item findById(int id) throws SQLException {
    try (Connection conn = open(); PreparedStatement ps = conn.prepareStatement(findByIdSql())) {
      ps.setInt(1, id);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? toItem(rs) : null;
      }
    }
  }

  @Override
  public void insert(Item item) throws SQLException {
    try (Connection conn = open(); PreparedStatement ps = conn.prepareStatement(insertSql())) {
      bind(conn, ps, item);
      ps.executeUpdate();
    }
  }

  // 「使い切った日」を編集するために、ps.setInt(9, item.getId());→ps.setInt(10, item.getId());に変更
  @Override
  public int update(Item item) throws SQLException {
    try (Connection conn = open(); PreparedStatement ps = conn.prepareStatement(updateSql())) {
      bind(conn, ps, item);
      ps.setInt(10, item.getId());// 9番目の ? は WHERE の id
      return ps.executeUpdate();
    }
  }

  @Override
  public int delete(int id) throws SQLException {
    try (Connection conn = open(); PreparedStatement ps = conn.prepareStatement(deleteSql())) {
      ps.setInt(1, id);
      return ps.executeUpdate();
    }
  }

  @Override
  public int markDisposed(int id) throws SQLException {
    try (Connection conn = open(); PreparedStatement ps = conn.prepareStatement(setDisposalSql())) {
      setDate(ps, 1, LocalDate.now(), isSqlite(conn));
      ps.setInt(2, id);
      return ps.executeUpdate();
    }
  }

  @Override
  public int unmarkDisposed(int id) throws SQLException {
    try (Connection conn = open();
        PreparedStatement ps = conn.prepareStatement(clearDisposalSql())) {
      ps.setInt(1, id);
      return ps.executeUpdate();
    }
  }

  @Override
  public List<String> distinctStores() throws SQLException {
    return distinctValues(c.colStore);
  }

  @Override
  public List<String> distinctLocations() throws SQLException {
    return distinctValues(c.colLocation);
  }

  @Override
  public List<String> findLocationOrder() throws SQLException {
    List<String> list = new ArrayList<>();
    String sql = "SELECT location_name FROM item_location ORDER BY sort_order, location_name";
    try (Connection conn = open();
        Statement st = conn.createStatement();
        ResultSet rs = st.executeQuery(sql)) {
      while (rs.next()) {
        list.add(rs.getString(1));
      }
    }
    return list;
  }

  @Override
  public void saveLocationOrder(List<String> names) throws SQLException {
    try (Connection conn = open()) {
      conn.setAutoCommit(false); // 「全部消して入れ直す」を途中で止まらないよう1まとまりにする
      try {
        try (Statement st = conn.createStatement()) {
          st.executeUpdate("DELETE FROM item_location");
        }
        String sql = "INSERT INTO item_location (location_name, sort_order) VALUES (?, ?)";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
          int order = 10;
          for (String name : names) {
            ps.setString(1, name);
            ps.setInt(2, order);
            ps.addBatch();
            order += 10;
          }
          ps.executeBatch();
        }
        conn.commit();
      } catch (SQLException e) {
        conn.rollback();
        throw e;
      }
    }
  }

  /** 指定した列の、空でない値を重複なしで返す(入力候補用) */
  private List<String> distinctValues(String column) throws SQLException {
    String sql = "SELECT DISTINCT " + q(column) + " FROM " + q(c.table) + " WHERE " + q(column)
        + " IS NOT NULL AND " + q(column) + " <> ''";
    List<String> list = new ArrayList<>();
    try (Connection conn = open();
        Statement st = conn.createStatement();
        ResultSet rs = st.executeQuery(sql)) {
      while (rs.next()) {
        list.add(rs.getString(1));
      }
    }
    return list;
  }


  // =====================================================================
  // 補助メソッド
  // =====================================================================

  /** 設定ファイルの接続情報でDBに接続する(使い終わったら呼び出し側で close する) */
  private Connection open() throws SQLException {
    if (c.dbUser.isEmpty()) {
      return DriverManager.getConnection(c.dbUrl);
    }
    return DriverManager.getConnection(c.dbUrl, c.dbUser, c.dbPassword);
  }

  private boolean isSqlite(Connection conn) throws SQLException {
    return conn.getMetaData().getDatabaseProductName().toLowerCase().contains("sqlite");
  }

  /** INSERT / UPDATE の ? 1〜8番に、所持品の内容をセットする */
  private void bind(Connection conn, PreparedStatement ps, Item item) throws SQLException {
    // SQLite には日付型が無いので、文字列("2026-09-30")で保存する。他のDBは日付としてセットする
    boolean sqlite = isSqlite(conn);

    ps.setString(1, item.getName());
    ps.setString(2, item.getCategory());
    ps.setString(3, item.getLocation());
    setDate(ps, 4, item.getPurchaseDate(), sqlite);
    if (priceIsText) {
      ps.setString(5, String.valueOf(item.getPrice())); // 値段の列が VARCHAR の場合
    } else {
      ps.setInt(5, item.getPrice());
    }
    ps.setString(6, item.getStore());
    setDate(ps, 7, item.getWarrantyDate(), sqlite);
    ps.setString(8, item.getNote());
    setDate(ps, 9, item.getDisposalDate(), sqlite); // ← 「使い切った日」を編集するために、後に追加
  }

  private void setDate(PreparedStatement ps, int index, LocalDate date, boolean sqlite)
      throws SQLException {
    if (date == null) {
      // 購入日など、未入力(null)を許す項目のための分岐。DBの型に関わらずNULLを保存する
      ps.setNull(index, java.sql.Types.DATE);
    } else if (sqlite) {
      ps.setString(index, date.toString());
    } else {
      ps.setObject(index, date);
    }
  }

  /** SELECT結果の現在の1行を Item に変換する(NULL でも落ちないようにしている) */
  private Item toItem(ResultSet rs) throws SQLException {
    return new Item(rs.getInt(1), nullToEmpty(rs.getString(2)), nullToEmpty(rs.getString(3)),
        nullToEmpty(rs.getString(4)), toDate(rs.getString(5)), parsePrice(rs.getString(6)),
        nullToEmpty(rs.getString(7)), toDate(rs.getString(8)), nullToEmpty(rs.getString(9)),
        toDate(rs.getString(10)));
  }

  /**
   * DBの日付を LocalDate に変換する。
   * "2026-09-30" でも "2026-09-30 00:00:00" (TIMESTAMP型)でも、先頭10文字を日付として読む。
   */
  private LocalDate toDate(String s) {
    if (s == null || s.length() < 10) {
      return null;
    }
    try {
      return LocalDate.parse(s.substring(0, 10));
    } catch (DateTimeParseException e) {
      return null; // 0000-00-00 など、日付として読めないものは「未設定」扱い
    }
  }

  /**
   * 値段を数値に変換する。値段の列が文字列型なので "398" だけでなく
   * "1,298円" のようなデータが入っていても読めるようにしている。読めなければ 0。
   */
  private int parsePrice(String s) {
    if (s == null) {
      return 0;
    }
    String t = s.replaceAll("[,，円¥￥\\s]", "");
    if (t.isEmpty()) {
      return 0;
    }
    try {
      return Integer.parseInt(t);
    } catch (NumberFormatException e) {
      try {
        return (int) Double.parseDouble(t);// "12.5" 等の小数点
      } catch (NumberFormatException e2) {
        return 0;
      }
    }
  }

  private String nullToEmpty(String s) {
    return s == null ? "" : s;
  }

}

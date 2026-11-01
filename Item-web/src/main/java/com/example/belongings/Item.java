package main.java.com.example.belongings;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/**
 * 所持品1件分のデータ(DBの1行に対応)。
 * DBの読み書き(JdbcItemRepository)とAPI(ApiServer)の間の受け渡しに使う。
 */
public class Item {

  private final int id; // 所持品ID。新規登録前は 0
  private final String name; // 名前
  private final String category; // カテゴリ(家電 など)
  private final String location; // 保管場所
  private final LocalDate purchaseDate; // 購入日(未入力なら null)
  private final int price; // 値段(円)
  private final String store; // 購入店舗
  private final LocalDate warrantyDate; // 保証期限(未入力なら null)
  private final String note; // 備考
  private final LocalDate disposalDate; // 手放した日(まだ持っていれば null)

  public Item(int id, String name, String category, String location, LocalDate purchaseDate,
      int price, String store, LocalDate warrantyDate, String note, LocalDate disposalDate) {
    this.id = id;
    this.name = name;
    this.category = category;
    this.location = location;
    this.purchaseDate = purchaseDate;
    this.price = price;
    this.store = store;
    this.warrantyDate = warrantyDate;
    this.note = note;
    this.disposalDate = disposalDate;
  }

  /**
   * 今日から保証期限までの残り日数を返す。
   * 今日が期限なら 0、保証切れならマイナス。保証期限が未入力なら null。
   */
  public Long daysUntilWarranty() {
    if (warrantyDate == null) {
      return null;
    }
    return ChronoUnit.DAYS.between(LocalDate.now(), warrantyDate);
  }

  /** 手放し済み(手放した日が入っている)かどうか */
  public boolean isDisposed() {
    return disposalDate != null;
  }

  public int getId() {
    return id;
  }

  public String getName() {
    return name;
  }

  public String getCategory() {
    return category;
  }

  public String getLocation() {
    return location;
  }

  public LocalDate getPurchaseDate() {
    return purchaseDate;
  }

  public int getPrice() {
    return price;
  }

  public String getStore() {
    return store;
  }

  public LocalDate getWarrantyDate() {
    return warrantyDate;
  }

  public String getNote() {
    return note;
  }

  public LocalDate getDisposalDate() {
    return disposalDate;
  }
}

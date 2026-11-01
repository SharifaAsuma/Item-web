package main.java.com.example.belongings;

import java.sql.SQLException;
import java.util.List;

/**
 * 所持品データの保存・取得の窓口(インターフェース)。
 * ApiServer は「どのDBか」を意識せず、この窓口だけを使う。
 * 実際のDB処理は JdbcItemRepository が担当する。
 */
public interface ItemRepository {

    /**
     * 所持品一覧を新しく登録した順に取得する。
     * @param category         絞り込むカテゴリ。null なら全カテゴリ
     * @param includeDisposed  true なら「手放した」所持品も含める。false なら隠す
     */
    List<Item> findAll(String category, boolean includeDisposed) throws SQLException;

    /** IDで1件取得する。無ければ null */
    Item findById(int id) throws SQLException;

    /** 新規登録する */
    void insert(Item item) throws SQLException;

    /** 更新する。更新した件数(0なら対象なし)を返す */
    int update(Item item) throws SQLException;

    /** 削除する。削除した件数(0なら対象なし)を返す */
    int delete(int id) throws SQLException;

    /** 指定のIDを「手放した」状態にする(手放した日 = 今日)。更新した件数を返す */
    int markDisposed(int id) throws SQLException;

    /** 「手放した」を取り消す(手放した日を空に戻す)。更新した件数を返す */
    int unmarkDisposed(int id) throws SQLException;

    /** 既存データの購入店舗の候補(入力補助用) */
    List<String> distinctStores() throws SQLException;

    /** 既存データの保管場所の候補(入力補助用) */
    List<String> distinctLocations() throws SQLException;
}

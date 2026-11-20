// =====================================================================
// 所持品管理・画面の動き(JavaScript)。
// サーバー(Java)とは /api/... のJSON通信でやり取りする。
// このファイルの関数は、上から
//   1) 起動時の初期化
//   2) 一覧の取得・絞り込み・並び替え・描画
//   3) カテゴリの色分け(バッジ)
//   4) 追加・編集フォームの表示と保存
//   5) 手放した/削除の操作
//   6) 細かい補助関数(日付・値段の表示、トースト、アイコンSVGなど)
// の順に並んでいる。
// =====================================================================

// ---- 今の絞り込み・並び替え条件を覚えておく変数 ----
let currentCategory = "";            // 選択中のカテゴリ("" = すべて)
let currentIncludeDisposed = false;  // 手放した所持品も表示するか
let currentSearch = "";              // 検索欄に入力されている文字列

//削除
//let currentSort = { key: "recent", dir: "desc" }; // 並び替えの列と向き(最初は新しく登録した順)

//新たに追加
let currentSort = { key: "location", dir: "asc" }; // 最初は「玄関に近い順」
let currentLocation = "";            // 選択中の保管場所タブ("" = すべて)
let locationOrder = [];              // 保管場所の並び順(玄関に近い順)。/api/meta から取得
let orderDraft = [];                 // 並び替えモーダルで編集中の並び
const NO_LOCATION = "(未設定)";      // 保管場所が空の所持品のタブ名

let lastItems = [];                  // 直近にサーバーから取得した一覧
let WARNING_DAYS = 30;               // 保証期限の警告日数(/api/meta から取得して上書きする)

// ---- HTML要素をまとめて取得しておく ----
const el = {
	categoryFilter: document.getElementById("categoryFilter"),
	includeDisposed: document.getElementById("includeDisposed"),
	searchBox: document.getElementById("searchBox"),
	openAddButton: document.getElementById("openAddButton"),
	emptyAddButton: document.getElementById("emptyAddButton"),
	statTotal: document.getElementById("statTotal"),
	statSum: document.getElementById("statSum"),
	statSoon: document.getElementById("statSoon"),
	itemsBody: document.getElementById("itemsBody"),
	emptyMessage: document.getElementById("emptyMessage"),
	toast: document.getElementById("toast"),
	sortableHeaders: document.querySelectorAll("th[data-sort]"),

	formOverlay: document.getElementById("formOverlay"),
	itemForm: document.getElementById("itemForm"),
	formTitle: document.getElementById("formTitle"),
	formErrors: document.getElementById("formErrors"),
	closeXButton: document.getElementById("closeXButton"),
	cancelButton: document.getElementById("cancelButton"),
	storeOptions: document.getElementById("storeOptions"),
	locationOptions: document.getElementById("locationOptions"),

	itemId: document.getElementById("itemId"),
	fieldName: document.getElementById("fieldName"),
	fieldCategory: document.getElementById("fieldCategory"),
	fieldLocation: document.getElementById("fieldLocation"),
	fieldPurchase: document.getElementById("fieldPurchase"),
	fieldPrice: document.getElementById("fieldPrice"),
	fieldStore: document.getElementById("fieldStore"),
	fieldWarranty: document.getElementById("fieldWarranty"),
	fieldDisposal: document.getElementById("fieldDisposal"),// ← 「使い切った日」を編集するために、後に追加
	fieldNote: document.getElementById("fieldNote"),

	//新たに追加
	locationTabs: document.getElementById("locationTabs"),
	openOrderButton: document.getElementById("openOrderButton"),
	orderOverlay: document.getElementById("orderOverlay"),
	orderList: document.getElementById("orderList"),
	orderCloseX: document.getElementById("orderCloseX"),
	orderSaveButton: document.getElementById("orderSaveButton"),
	orderCancelButton: document.getElementById("orderCancelButton"),
};

// =====================================================================
// 1) 起動時の初期化
// =====================================================================

async function init() {
	el.categoryFilter.addEventListener("change", () => {
		currentCategory = el.categoryFilter.value;
		reloadList();
	});
	el.includeDisposed.addEventListener("change", () => {
		currentIncludeDisposed = el.includeDisposed.checked;
		reloadList();
	});
	// 検索は、サーバーに聞き直さず手元のデータを絞り込むだけにして、入力のたびすぐ反映されるようにする
	el.searchBox.addEventListener("input", () => {
		currentSearch = el.searchBox.value.trim().toLowerCase();
		renderFromState();
	});
	// 列見出しをクリックしたら、その列で並び替える(もう一度押すと昇順・降順が入れ替わる)
	el.sortableHeaders.forEach(th => {
		th.addEventListener("click", () => onSortClick(th));
		th.addEventListener("keydown", e => {
			if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSortClick(th); }
		});
	});

	// 最初の並び順(保管場所)の矢印を見出しに出しておく
	el.sortableHeaders.forEach(h => {
		if (h.dataset.sort === currentSort.key) h.setAttribute("aria-sort", "ascending");
	});
	el.openOrderButton.addEventListener("click", openOrder);
	el.orderCloseX.addEventListener("click", closeOrder);
	el.orderCancelButton.addEventListener("click", closeOrder);
	el.orderSaveButton.addEventListener("click", saveOrder);
	el.orderOverlay.addEventListener("click", e => {
		if (e.target === el.orderOverlay) closeOrder();
	});

	el.openAddButton.addEventListener("click", () => openForm(null));
	el.emptyAddButton.addEventListener("click", () => openForm(null));
	el.closeXButton.addEventListener("click", closeForm);
	el.cancelButton.addEventListener("click", closeForm);
	el.itemForm.addEventListener("submit", onSubmitForm);

	// モーダルの背景(overlayそのもの)をクリックしたら閉じる。中のカードをクリックしたときは閉じない
	el.formOverlay.addEventListener("click", e => {
		if (e.target === el.formOverlay) closeForm();
	});
	// Escapeキーでモーダルを閉じる
	document.addEventListener("keydown", e => {
		if (e.key === "Escape" && !el.formOverlay.hidden) closeForm();
		if (e.key === "Escape" && !el.orderOverlay.hidden) closeOrder();   // ← 追加
	});

	try {
		await loadMeta();   // カテゴリ一覧・購入店舗/保管場所の候補を先に読み込む
		await reloadList();
	} catch (err) {
		showToast(err.message, true);
	}
}

/** GET /api/meta : カテゴリの選択肢や購入店舗・保管場所の候補・警告日数を、画面の各所に反映する */
async function loadMeta() {
	const meta = await fetchJson("/api/meta");
	WARNING_DAYS = meta.warningDays;

	for (const cat of meta.categories) {
		el.categoryFilter.appendChild(new Option(cat, cat));
		el.fieldCategory.appendChild(new Option(cat, cat));
	}
	for (const store of meta.stores) {
		el.storeOptions.appendChild(new Option(store));
	}

	locationOrder = meta.locations; // 「玄関に近い順」で表示させるために追加

	for (const loc of meta.locations) {
		el.locationOptions.appendChild(new Option(loc));
	}
}

// =====================================================================
// 2) 一覧の取得・絞り込み・並び替え・描画
// =====================================================================

/** 今の絞り込み条件(カテゴリ・手放し済み表示)でサーバーから取り直す */
async function reloadList() {
	const params = new URLSearchParams();
	if (currentCategory) params.set("category", currentCategory);
	if (currentIncludeDisposed) params.set("includeDisposed", "true");

	lastItems = await fetchJson("/api/items?" + params.toString());
	renderFromState();
}

/** 手元にある lastItems に対して、検索 → 並び替え → 描画 を行う(サーバーには聞き直さない) */
function renderFromState() {
	//const filtered = currentSearch ? lastItems.filter(matchesSearch) : lastItems;←この部分を以下の文に変更
	const searched = currentSearch ? lastItems.filter(matchesSearch) : lastItems;

	// 保管場所タブ: 件数を数えてタブを作り、選択中の場所だけに絞る
	const counts = countByLocation(searched);
	if (currentLocation && !counts.has(currentLocation)) currentLocation = ""; // 空になった場所は「すべて」に戻す
	renderTabs(counts, searched.length);
	const filtered = currentLocation ? searched.filter(it => locOf(it) === currentLocation) : searched;

	const sorted = sortItems(filtered, currentSort);
	renderSummary(filtered);
	renderTable(sorted);
}

/** 名前・保管場所・購入店舗・備考のいずれかに検索文字列が含まれているか */
function matchesSearch(item) {
	const text = `${item.name} ${item.location} ${item.store} ${item.note}`.toLowerCase();
	return text.includes(currentSearch);
}

/** 列見出しクリック時: 同じ列なら昇順・降順を反転、違う列なら新しく昇順から始める */
function onSortClick(th) {
	const key = th.dataset.sort;
	if (currentSort.key === key) {
		currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
	} else {
		currentSort = { key, dir: "asc" };
	}
	// 見出しの ↑↓ 表示(aria-sort)を更新する。押した列以外は消す
	el.sortableHeaders.forEach(h => {
		h.setAttribute("aria-sort", h.dataset.sort === currentSort.key
			? (currentSort.dir === "asc" ? "ascending" : "descending")
			: "none");
	});
	renderFromState();
}

/** items を sort.key ・ sort.dir の内容で並び替えた新しい配列を返す(元の配列は変えない) */
function sortItems(items, sort) {
	const factor = sort.dir === "asc" ? 1 : -1;
	const copy = [...items];
	copy.sort((a, b) => {
		let cmp;
		switch (sort.key) {
			case "name":
			case "category":
			//case "location":← 玄関に近い順にソートするため、"location" を削除
			case "store":
				cmp = a[sort.key].localeCompare(b[sort.key], "ja");
				break;
			case "location":                   // ← 追加
				// 五十音順ではなく、保管場所の並び順(玄関に近い順)で比べる
				cmp = locationRank(a.location) - locationRank(b.location);
				break;
			case "price":
				cmp = a.price - b.price;
				break;
			case "purchase":
			case "warranty": {
				// 日付が未入力(null)のものは、並び順に関わらず常に最後に置く
				const av = a[sort.key], bv = b[sort.key];
				if (av === null && bv === null) cmp = 0;
				else if (av === null) return 1;
				else if (bv === null) return -1;
				else cmp = av < bv ? -1 : av > bv ? 1 : 0;
				break;
			}
			default:
				cmp = 0; // "recent": 下の「IDで安定させる」だけで、登録順になる
		}
		if (cmp === 0) cmp = a.id - b.id; // 同じ値なら、登録順(ID順)で安定させる
		return cmp * factor;
	});
	return copy;
}

/** 「所持品○点」「購入金額の合計」「保証期限が近い○点」の数字を書き換える(手放し済みは数えない) */
function renderSummary(items) {
	const active = items.filter(it => !it.disposed);
	const soon = active.filter(it => it.daysUntilWarranty !== null && it.daysUntilWarranty >= 0
		&& it.daysUntilWarranty <= WARNING_DAYS).length;
	const sum = active.reduce((total, it) => total + it.price, 0);

	el.statTotal.textContent = active.length;
	el.statSum.textContent = sum.toLocaleString("ja-JP");
	el.statSoon.textContent = soon;
}

/** 所持品の配列から一覧表の行(<tr>)を作って表に反映する */
function renderTable(items) {
	el.itemsBody.innerHTML = "";
	el.emptyMessage.hidden = items.length > 0;

	// 「保管場所」順で、タブが「すべて」のときは、場所ごとの見出し行を挟む
	const grouped = currentSort.key === "location" && currentLocation === "";
	const counts = countByLocation(items);
	let lastLoc = null;

	for (const item of items) {
		if (grouped && locOf(item) !== lastLoc) {
			lastLoc = locOf(item);
			el.itemsBody.appendChild(groupRow(lastLoc, counts.get(lastLoc)));
		}
		const tr = document.createElement("tr");
		tr.className = rowClass(item);

		tr.appendChild(cell(item.name, "名前", "name"));
		tr.appendChild(categoryCell(item.category));
		tr.appendChild(cell(item.location || "-", "保管場所"));
		tr.appendChild(cell(item.purchase ?? "-", "購入日", "date"));
		tr.appendChild(cell(formatYen(item.price), "値段", "num"));
		tr.appendChild(cell(item.store || "-", "購入店舗"));
		tr.appendChild(warrantyCell(item));
		tr.appendChild(cell(item.note, "備考", "note"));
		tr.appendChild(operationsCell(item));

		el.itemsBody.appendChild(tr);
	}
}
// ---- 保管場所タブ・並び順まわり ----

/** 所持品の保管場所名。空なら「(未設定)」として扱う */
function locOf(item) {
	return item.location || NO_LOCATION;
}

/** 保管場所の並び順での位置。未登録の場所 → 空欄 の順に最後へ回す */
function locationRank(name) {
	const i = locationOrder.indexOf(name);
	if (i >= 0) return i;
	return name ? locationOrder.length : locationOrder.length + 1;
}

/** 保管場所ごとの件数。並び順どおり(順番未登録・未設定は最後)の Map で返す */
function countByLocation(items) {
	const raw = new Map();
	for (const it of items) raw.set(locOf(it), (raw.get(locOf(it)) ?? 0) + 1);
	const ordered = new Map();
	for (const name of locationOrder) if (raw.has(name)) ordered.set(name, raw.get(name));
	for (const [name, n] of raw) if (!ordered.has(name)) ordered.set(name, n);
	return ordered;
}

function renderTabs(counts, total) {
	el.locationTabs.innerHTML = "";
	el.locationTabs.appendChild(tabButton("すべて", total, ""));
	for (const [name, n] of counts) {
		el.locationTabs.appendChild(tabButton(name, n, name));
	}
}

function tabButton(label, count, value) {
	const b = document.createElement("button");
	const active = currentLocation === value;
	b.type = "button";
	b.className = "tab" + (active ? " active" : "");
	b.setAttribute("role", "tab");
	b.setAttribute("aria-selected", String(active));
	b.innerHTML = `${escapeHtml(label)}<span class="tab-count">${count}</span>`;
	b.addEventListener("click", () => { currentLocation = value; renderFromState(); });
	return b;
}

/** 一覧の中の「玄関 3」のような場所の見出し行 */
function groupRow(name, count) {
	const tr = document.createElement("tr");
	tr.className = "group-row";
	const td = document.createElement("td");
	td.colSpan = 9;
	td.innerHTML = `${escapeHtml(name)}<span class="tab-count">${count}</span>`;
	tr.appendChild(td);
	return tr;
}

// ---- 場所の並び替え(モーダル) ----

async function openOrder() {
	try {
		const data = await fetchJson("/api/locations");
		orderDraft = data.locations;
	} catch (err) {
		showToast(err.message, true);
		return;
	}
	renderOrderList();
	el.orderOverlay.hidden = false;
}

function closeOrder() {
	el.orderOverlay.hidden = true;
}

function renderOrderList() {
	const used = countByLocation(lastItems);
	el.orderList.innerHTML = "";
	orderDraft.forEach((name, i) => {
		const li = document.createElement("li");
		li.className = "order-item";
		li.innerHTML = `<span class="order-num">${i + 1}</span>`
			+ `<span class="order-name">${escapeHtml(name)}</span>`
			+ `<span class="order-count">${used.get(name) ?? 0}点</span>`;
		const up = iconButton("up", ICONS.up, "上へ", () => moveLocation(i, -1));
		const down = iconButton("down", ICONS.down, "下へ", () => moveLocation(i, 1));
		up.disabled = i === 0;
		down.disabled = i === orderDraft.length - 1;
		li.append(up, down);
		el.orderList.appendChild(li);
	});
}

function moveLocation(i, delta) {
	const j = i + delta;
	if (j < 0 || j >= orderDraft.length) return;
	[orderDraft[i], orderDraft[j]] = [orderDraft[j], orderDraft[i]];
	renderOrderList();
}

async function saveOrder() {
	try {
		const res = await fetch("/api/locations", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ order: orderDraft.join("\n") }),
		});
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			showToast(data.error ?? "保存に失敗しました", true);
			return;
		}
	} catch (err) {
		showToast("サーバーに接続できませんでした", true);
		return;
	}
	locationOrder = orderDraft.slice();
	closeOrder();
	showToast("場所の並び順を保存しました");
	renderFromState();
}

/** 保証が近い・保証切れ・手放し済みで行の色を変えるためのクラス名を決める(手放し済みが最優先) */
function rowClass(item) {
	if (item.disposed) return "disposed";
	if (item.daysUntilWarranty === null) return "";
	if (item.daysUntilWarranty < 0) return "expired";
	if (item.daysUntilWarranty <= WARNING_DAYS) return "soon";
	return "";
}

/** 保証期限のセル。日付の下に「あと○日」を小さく添える(手放し済みの行には添えない) */
function warrantyCell(item) {
	const td = cell(item.warranty ?? "-", "保証期限", "date");
	if (item.warranty && !item.disposed) {
		const sub = document.createElement("span");
		sub.className = "sub-line";
		sub.textContent = formatRemaining(item.daysUntilWarranty);
		td.appendChild(sub);
	}
	return td;
}

// =====================================================================
// 3) カテゴリの色分け(バッジ)
// =====================================================================

// あらかじめ用意したカテゴリには、決め打ちのやわらかい色を割り当てる
const CATEGORY_COLORS = {
	"家電": { bg: "#E8F0FE", fg: "#2B5BC8" },
	"衣類": { bg: "#F3E8FB", fg: "#7A3FB0" },
	"本・書籍": { bg: "#FFF1DC", fg: "#B5670B" },
	"日用品": { bg: "#E6F5EC", fg: "#2E7D4F" },
	"趣味": { bg: "#FDE8F0", fg: "#C0356B" },
	"文房具": { bg: "#E3F4F5", fg: "#1F7A80" },
	"未分類": { bg: "#F0F0F1", fg: "#6B7280" },
};
// 設定ファイルで独自のカテゴリ名が追加された場合は、名前から自動で色を決める
const CATEGORY_FALLBACK_PALETTE = [
	{ bg: "#EDEBFE", fg: "#5B4BC4" },
	{ bg: "#E6F1FB", fg: "#2F6FA8" },
	{ bg: "#FBEDE6", fg: "#A85A2F" },
	{ bg: "#EAF5E6", fg: "#4E8C5E" },
];

/** カテゴリ名から表示色を決める。同じ名前なら常に同じ色になる(ページを開き直しても変わらない) */
function categoryColor(name) {
	if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
	}
	return CATEGORY_FALLBACK_PALETTE[hash % CATEGORY_FALLBACK_PALETTE.length];
}

/** カテゴリ列のセル。色付きのバッジ(丸みのあるラベル)として表示する */
function categoryCell(categoryName) {
	const td = document.createElement("td");
	td.dataset.label = "カテゴリ"; // スマホ表示で見出しとして出す文字
	const color = categoryColor(categoryName);
	const badge = document.createElement("span");
	badge.className = "category-badge";
	badge.style.background = color.bg;
	badge.style.color = color.fg;
	badge.textContent = categoryName;
	td.appendChild(badge);
	return td;
}

/** 「編集」「手放した/取消」「削除」のアイコンボタンが並んだセルを作る */
function operationsCell(item) {
	const td = document.createElement("td");
	td.className = "ops";

	const wrap = document.createElement("div");
	wrap.className = "row-actions";
	wrap.appendChild(iconButton("edit", ICONS.edit, "編集する", () => openForm(item)));
	if (item.disposed) {
		wrap.appendChild(iconButton("restore", ICONS.restore, "手放したを取り消す", () => restoreItem(item)));
	} else {
		wrap.appendChild(iconButton("dispose", ICONS.check, "手放した", () => disposeItem(item)));
	}
	wrap.appendChild(iconButton("delete", ICONS.trash, "削除する", () => deleteItem(item)));

	td.appendChild(wrap);
	return td;
}

// =====================================================================
// 4) 追加・編集フォームの表示と保存
// =====================================================================

/** フォームを開く。item が null なら新規追加、指定があれば編集(値を埋める) */
function openForm(item) {
	el.formErrors.hidden = true;
	el.formTitle.textContent = item ? "所持品を編集" : "所持品を追加";
	el.itemId.value = item ? item.id : "";
	el.fieldName.value = item ? item.name : "";
	el.fieldCategory.value = item ? item.category : el.fieldCategory.options[0]?.value ?? "";
	el.fieldLocation.value = item ? item.location : "";
	el.fieldPurchase.value = item ? (item.purchase ?? "") : todayString();
	el.fieldPrice.value = item ? item.price : "";
	el.fieldStore.value = item ? item.store : "";
	el.fieldWarranty.value = item ? (item.warranty ?? "") : "";
	el.fieldDisposal.value = item ? (item.disposal ?? "") : "";// ← 「使い切った日」を編集するために、後に追加
	el.fieldNote.value = item ? item.note : "";

	el.formOverlay.hidden = false;
	// 開いた直後に「名前」欄へフォーカスを移す(表示が終わってから当てないと効かないブラウザがあるため少し遅らせる)
	setTimeout(() => el.fieldName.focus(), 0);
}

function closeForm() {
	el.formOverlay.hidden = true;
}

/** フォームの「保存」。新規なら POST、編集なら PUT を呼ぶ */
async function onSubmitForm(event) {
	event.preventDefault(); // ブラウザ標準のページ送信を止める(fetchで送るため)

	const body = {
		name: el.fieldName.value.trim(),
		category: el.fieldCategory.value,
		location: el.fieldLocation.value.trim(),
		purchase: el.fieldPurchase.value,
		price: el.fieldPrice.value === "" ? 0 : Number(el.fieldPrice.value),
		store: el.fieldStore.value.trim(),
		warranty: el.fieldWarranty.value,
		disposal: el.fieldDisposal.value,   // ← 「使い切った日」を編集するために、後に追加
		note: el.fieldNote.value.trim(),
	};

	const id = el.itemId.value;
	const url = id ? `/api/items/${id}` : "/api/items";
	const method = id ? "PUT" : "POST";

	let res, data;
	try {
		res = await fetch(url, {
			method,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		data = await res.json();
	} catch (err) {
		showFormErrors(["サーバーに接続できませんでした。"]);
		return;
	}

	if (!res.ok) {
		// 入力エラー・DBエラーは、フォームを閉じずに理由を表示する
		showFormErrors(data.errors ?? [data.error ?? "保存に失敗しました。"]);
		return;
	}

	closeForm();
	showToast(id ? `「${body.name}」を更新しました` : `「${body.name}」を追加しました`);
	await reloadList();
	addOptionIfNew(el.storeOptions, body.store);       // 新しい店名・保管場所なら候補に足しておく
	addOptionIfNew(el.locationOptions, body.location);
}

function showFormErrors(messages) {
	el.formErrors.innerHTML = "<ul>" + messages.map(m => `<li>${escapeHtml(m)}</li>`).join("") + "</ul>";
	el.formErrors.hidden = false;
}

/** 今回入力した値が候補に無ければ、次回のために追加しておく(見た目だけの補助) */
function addOptionIfNew(datalist, value) {
	if (!value) return;
	const exists = [...datalist.options].some(o => o.value === value);
	if (!exists) {
		datalist.appendChild(new Option(value));
	}
}

// =====================================================================
// 5) 手放した/削除の操作
// =====================================================================

/** 「手放した」ボタン: 手放した日を今日にして、一覧から隠す */
async function disposeItem(item) {
	await callApi(`/api/items/${item.id}/dispose`, "POST");
	showToast(`「${item.name}」を手放した所持品にしました`);
	await reloadList();
}

/** 「取消」ボタン: 手放した状態を取り消し、一覧に戻す */
async function restoreItem(item) {
	await callApi(`/api/items/${item.id}/restore`, "POST");
	showToast(`「${item.name}」を一覧に戻しました`);
	await reloadList();
}

/** 「削除」ボタン: 確認してから完全に削除する */
async function deleteItem(item) {
	if (!confirm(`「${item.name}」を削除しますか？(元に戻せません)`)) {
		return;
	}
	await callApi(`/api/items/${item.id}`, "DELETE");
	showToast(`「${item.name}」を削除しました`);
	await reloadList();
}

/** 更新系のAPIを呼ぶ共通処理。失敗したらトーストでエラーを出す */
async function callApi(url, method) {
	try {
		const res = await fetch(url, { method });
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			showToast(data.error ?? "操作に失敗しました", true);
		}
	} catch (err) {
		showToast("サーバーに接続できませんでした", true);
	}
}

// =====================================================================
// 6) 細かい補助関数
// =====================================================================

/** JSONを返すAPIを呼び出す共通処理 */
async function fetchJson(url) {
	const res = await fetch(url);
	const data = await res.json();
	if (!res.ok) {
		throw new Error(data.error ?? "通信に失敗しました");
	}
	return data;
}

/** 表のセル(<td>)を1つ作る。label はスマホ表示のときに見出しとして出す文字 */
function cell(text, label, className) {
	const td = document.createElement("td");
	if (className) td.className = className;
	td.dataset.label = label;
	td.textContent = text ?? "";
	return td;
}

/** アイコン付きの小さな丸ボタンを作る */
function iconButton(kind, svgMarkup, title, onClick) {
	const b = document.createElement("button");
	b.type = "button";
	b.className = "icon-btn " + kind;
	b.title = title;
	b.setAttribute("aria-label", title);
	b.innerHTML = svgMarkup;
	b.addEventListener("click", onClick);
	return b;
}

/** 残り日数を「あと3日」「保証切れ(2日前)」のような表示用文字列にする */
function formatRemaining(days) {
	if (days === null || days === undefined) return "";
	if (days < 0) return `保証切れ(${-days}日前)`;
	if (days === 0) return "今日まで";
	return `あと${days}日`;
}

function formatYen(price) {
	return `${Number(price).toLocaleString("ja-JP")}円`;
}

function todayString() {
	const d = new Date();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 操作結果のメッセージを、画面右上に数秒間だけ表示する */
let toastTimer = null;
function showToast(message, isError) {
	el.toast.textContent = message;
	el.toast.className = "toast" + (isError ? " error" : "");
	el.toast.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3000);
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, ch => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
	}[ch]));
}

/** 操作アイコン用のSVG(手描きの線画アイコン。外部ライブラリは使っていない) */
const ICONS = {
	edit: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
	check: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4.5 4.5L19 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	restore: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 10h9a5 5 0 1 1 0 10h-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 5 4 10l4 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	up: '<svg viewBox="0 0 24 24" fill="none"><path d="m6 15 6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	down: '<svg viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ページの読み込みが終わったら開始する
init();

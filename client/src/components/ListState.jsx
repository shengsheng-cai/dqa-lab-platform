import { C } from "../styles/theme";

// 列表在「沒有資料可以顯示」時的三種情況：還在載入、讀取失敗、真的一筆都沒有。
//
// 以前這三種共用同一句「尚無○○」，所以後端斷線或權限不足時，畫面看起來就像資料真的
// 是空的。訪客 Token 那張最嚴重：讀取失敗會顯示「點擊『+ 生成』建立第一個」，
// 等於在系統故障時請管理者再發一把憑證。
//
// 這裡的按鈕叫「重試」，不叫「重新整理」：稽核面板的工具列本來就有一顆「重新整理」，
// 讀取失敗時兩顆會同時出現在畫面上，同名會讓人以為是兩件事，定位也會撞在一起。

const retryBtn = {
  padding: "4px 12px",
  borderRadius: 4,
  fontSize: 12,
  background: "transparent",
  border: `1px solid ${C.border}`,
  color: C.textMuted,
  cursor: "pointer",
};

function RetryButton({ onClick, style }) {
  return (
    <button type="button" onClick={onClick} style={style ? { ...retryBtn, ...style } : retryBtn}>
      重試
    </button>
  );
}

function StateBody({ loading, error, empty, onRetry }) {
  if (loading) return <span style={{ color: C.textDim }}>載入中…</span>;
  if (error) {
    return (
      <>
        <div style={{ color: C.error }}>{error}</div>
        {onRetry && <RetryButton onClick={onRetry} style={{ marginTop: 10 }} />}
      </>
    );
  }
  return <span style={{ color: C.textDim }}>{empty}</span>;
}

/** 放在一般容器裡的版本 */
export function ListState(props) {
  return (
    <div style={{ textAlign: "center", fontSize: 12, padding: "40px 0" }}>
      <StateBody {...props} />
    </div>
  );
}

/** 放在表格裡的版本，欄數要跟表頭一致，不然那一列會少一格 */
export function ListStateRow({ colSpan, ...props }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: "center", fontSize: 12, padding: "28px 0" }}>
        <StateBody {...props} />
      </td>
    </tr>
  );
}

/**
 * 選單的選項讀不到時，掛在選單下方的一行。
 *
 * 用在「選單只是表單裡的一格」的場合——整段換成 ListState 會把那一格的標籤與版位一起吃掉。
 * 但它一定要有重試：借用人這種必填欄位一旦讀不到，沒有重試就等於整個視窗變成死路，
 * 使用者只能關掉重開，而畫面上沒有任何東西告訴他這樣做有用。
 *
 * `role="alert"` 不能省：這一行是非同步冒出來的，又不在閱讀順序的必經之處，
 * 沒有它的話，Tab 到那個空選單只會聽到一個選項，永遠不知道為什麼是空的。
 *
 * marginTop 是在抵銷 ModalShell 的 gap，讓這行貼著它說明的那個選單，不要浮在兩格中間。
 */
export function FieldLoadError({ label, error, onRetry }) {
  return (
    <div
      role="alert"
      style={{ display: "flex", alignItems: "center", gap: 8, color: C.error, fontSize: 11, marginTop: -8 }}
    >
      <span>{label}載入失敗：{error}</span>
      {onRetry && <RetryButton onClick={onRetry} style={{ fontSize: 11, padding: "2px 8px" }} />}
    </div>
  );
}

/**
 * 統計數字讀不到時的替身。
 *
 * 數字比清單更會騙人：它永遠顯示得出來，而「0」跟「真的是 0」長得一模一樣。
 * 摘要卡上的數字通常就是人用來判斷「現在有沒有事」的那一眼，所以讀不到時
 * 要換掉整個值，不能只是留著上一次的數字或退回 0。
 *
 * aria-label 的「X：讀取失敗」是 E2E 的定位依據，改文案要一起改測試。
 */
export function UnknownStat({ label, error, style }) {
  return (
    <span
      // 沒有 role 的 span，aria-label 可以被輔助技術忽略，名稱要掛在有角色的元素上
      role="img"
      aria-label={`${label}：讀取失敗`}
      title={error}
      style={{ color: C.warning, ...style }}
    >
      ⚠ —
    </span>
  );
}

/**
 * 手上還有上一次的資料、但這次更新失敗時，壓在資料上方的一條。
 *
 * 失敗時不清空既有資料：那些資料仍然是使用者剛才看到的東西，清掉只會讓畫面看起來
 * 像「資料被刪光了」。但也不能什麼都不說，所以要明講畫面上這份是舊的。
 */
export function StaleBanner({ error, onRetry }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        margin: "0 0 10px", padding: "6px 10px", borderRadius: 6,
        background: C.warningBg, border: `1px solid ${C.warning}55`,
        color: C.warning, fontSize: 12,
      }}
    >
      <span>更新失敗（{error}），以下為上次讀到的資料</span>
      {onRetry && <RetryButton onClick={onRetry} style={{ marginLeft: "auto", color: C.warning }} />}
    </div>
  );
}

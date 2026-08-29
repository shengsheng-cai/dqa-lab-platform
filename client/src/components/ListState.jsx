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

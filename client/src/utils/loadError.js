import { GENERIC_ERROR } from "../errorMessages";

// 讀取或下載失敗時，把錯誤變成一句使用者看得懂的話。
//
// 為什麼不直接用 errorMessages.js：那支翻的是後端送回來的訊息內容（api.js 的攔截器
// 已經在收到回應時翻好，放回 detail），但讀取失敗常常根本沒有訊息可翻——連不到伺服器
// 時沒有回應，403 也只有狀態碼。下載更是如此：下載走 responseType: "blob"，
// 連錯誤回應的 body 都是 Blob，取不到 detail 字串。以前報告下載的失敗訊息寫死成
// 「請確認後端連線」就是這樣來的，權限不足也顯示同一句。
//
// 401 不在下面的對照表裡：收到 401 一律清掉憑證並導回登入頁，沒有人來得及顯示訊息。
// axios 那條路由 api.js 的攔截器處理，走原生 fetch 的呼叫端自己呼叫 handleUnauthorized。

const STATUS_MESSAGE = {
  400: "請求內容有誤",
  403: "需要管理者權限才能查看",
  404: "找不到資料",
};

/** 回傳一句可以直接顯示的失敗原因 */
export function describeLoadError(e) {
  if (!e?.response) return "連不到伺服器，請確認後端是否正常運行";

  const { status, data } = e.response;
  // detail 已經被 api.js 的攔截器翻成中文，這裡直接用，不要再翻一次。
  // 但翻不出來時它會是 GENERIC_ERROR，那句話等於沒說，寧可用狀態碼講得具體一點。
  const detail = typeof data?.detail === "string" ? data.detail.trim() : "";
  if (detail && detail !== GENERIC_ERROR) return detail;

  if (STATUS_MESSAGE[status]) return STATUS_MESSAGE[status];
  if (status >= 500) return `伺服器錯誤（${status}），請稍後重試`;
  return `讀取失敗（${status}）`;
}

/**
 * 同一件事，但對象是原生 fetch 的 Response。
 *
 * AI 串流要邊收邊顯示，走的是 fetch 而不是 axios，所以沒有攔截器幫忙翻 detail，
 * 上面那支吃的 `e.response` 也不存在。後端在開始串流前擋下來時（未設定 API key、
 * 限流）detail 本來就是一句能直接顯示的話，這支負責把它拿出來。
 */
export async function describeResponseError(res) {
  let data = null;
  try {
    data = await res.json();
  } catch { /* 不是 JSON，或 body 已經被讀走 */ }
  // 解析出 body 之後就跟 axios 那條路一模一樣了，狀態碼那套不要再抄一遍
  return describeLoadError({ response: { status: res.status, data } });
}

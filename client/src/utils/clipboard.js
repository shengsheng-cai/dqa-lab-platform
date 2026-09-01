// 複製到剪貼簿。clipboard API 只在安全來源（https 或 localhost）給用，
// 拿區網 IP 開前端時它整個不存在，所以要留 execCommand 這條舊路——
// 訪客 Token 那個提示一關就再也看不到，沒有退路等於把憑證弄丟。

/** 複製文字到剪貼簿，回傳有沒有成功。失敗要說什麼由呼叫點自己決定。 */
export async function copyText(text) {
  try {
    // 非安全來源沒有 navigator.clipboard，這行會直接丟例外，跟「權限被拒」
    // 走同一條路往下試 execCommand，不必另外判斷是哪一種。
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 往下試 execCommand
  }
  // execCommand 要先把文字選起來才複製得到，所以得搶走焦點。
  // 搶完要還回去，不然按完複製鍵盤位置就掉到 body，Tab 得從頭來過。
  const previous = document.activeElement;
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(el);
    if (previous instanceof HTMLElement) previous.focus();
  }
}

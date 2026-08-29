import api from "../api";
import { localDateStamp } from "./timezone";
import { describeLoadError } from "./loadError";

/**
 * 下載後端 blob 並觸發瀏覽器儲存對話框。失敗會往外丟，不對外公開——
 * 呼叫點一律走下面的 downloadOrFail，免得又出現一個無聲失敗的下載。
 * @param {string} path   API 路徑（相對）
 * @param {string} filename  下載後的檔名
 */
async function downloadBlob(path, filename) {
  const res = await api.get(path, { responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * 下載，失敗時把原因交給呼叫點講出來。
 *
 * 下載失敗以前是無聲的：按鈕轉一圈變回原樣，使用者不知道是沒權限、後端掛了，
 * 還是自己按錯。訊息要送 toast 還是寫在畫面上，各頁的回饋管道不同，所以由 onFail 決定。
 *
 * @param {string} path      API 路徑
 * @param {string} filename  下載後的檔名
 * @param {(msg: string) => void} onFail  失敗時收到一句可以直接顯示的話
 */
export async function downloadOrFail(path, filename, onFail) {
  try {
    await downloadBlob(path, filename);
  } catch (e) {
    onFail(`下載失敗：${describeLoadError(e)}`);
  }
}

/** 不能當檔名的字元一律換成底線 */
const safeSegment = (s) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * 產生報告檔名，格式：{device_}{prefix}_{YYYYMMDD}_{execId}.{ext}
 *
 * @param {string} prefix   主要識別（例如 SOP 編號），空值時填 unknown
 * @param {string|number} execId  執行紀錄 id
 * @param {string} ext      副檔名
 * @param {object} [opts]
 * @param {string} [opts.device]  選填，黏在最前面的設備編號
 */
export function buildReportFilename(prefix, execId, ext, { device } = {}) {
  const safePrefix = safeSegment(prefix || "unknown");
  const head = device ? `${safeSegment(device)}_${safePrefix}` : safePrefix;
  return `${head}_${localDateStamp()}_${execId}.${ext}`;
}

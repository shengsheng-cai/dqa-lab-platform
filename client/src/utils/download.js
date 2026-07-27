import api from "../api";
import { localDateStamp } from "./timezone";

/**
 * 下載後端 blob 並觸發瀏覽器儲存對話框。
 * @param {string} path   API 路徑（相對）
 * @param {string} filename  下載後的檔名
 */
export async function downloadBlob(path, filename) {
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

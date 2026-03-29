import api from "../api";

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

/** 產生報告檔名，格式：{prefix}_{YYYYMMDD}_{execId}.{ext} */
export function buildReportFilename(prefix, execId, ext) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const safePrefix = (prefix || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safePrefix}_${date}_${execId}.${ext}`;
}

import { useState, useEffect, Fragment } from "react";
import api from "./api";
import { POLL_GENERAL_MS } from "./constants";
import { downloadBlob, buildReportFilename } from "./utils/download";
import { formatLocal } from "./utils/timezone";
import { useToast } from "./components/Toast";

function fmtDatetime(str) {
  if (!str) return "—";
  return formatLocal(str, "datetime");
}

export default function ExecutionList({ active, role }) {
  const { showToast } = useToast();
  const [executions, setExecutions] = useState([]);
  const [downloading, setDownloading] = useState({});
  const [uploading, setUploading] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const fetchList = () =>
    api.get("/api/reports/list").then((r) => setExecutions(r.data)).catch(() => {});

  useEffect(() => {
    if (!active) return;
    fetchList();
    const t = setInterval(fetchList, POLL_GENERAL_MS);
    return () => clearInterval(t);
  }, [active]);

  const downloadReport = async (ex, format = "csv") => {
    if (downloading[format]) return;
    setDownloading((prev) => ({ ...prev, [format]: ex.id }));
    try {
      const prefix = `${ex.device_id}_${ex.sop_id || "report"}`;
      await downloadBlob(`/api/reports/${format}/${ex.id}`, buildReportFilename(prefix, ex.id, format));
    } catch (_) {
    } finally {
      setDownloading((prev) => ({ ...prev, [format]: null }));
    }
  };

  const uploadPhoto = async (exId, photoType, file) => {
    setUploading({ id: exId, type: photoType });
    try {
      const form = new FormData();
      form.append("photo_type", photoType);
      form.append("file", file);
      await api.post(`/api/sop-executions/${exId}/photos`, form);
      await fetchList();
      showToast("照片已上傳", "success");
    } catch (e) {
      const msg = e.response?.data?.detail || "上傳失敗";
      showToast(msg, "error", 3000, e.response?.data?.hint);
    } finally {
      setUploading(null);
    }
  };

  const thStyle = { padding: "6px 12px", textAlign: "left", color: "#8b949e", fontWeight: 600, fontSize: 12 };
  const tdStyle = { padding: "8px 12px", fontSize: 12 };

  const PhotoBadge = ({ has, label }) => (
    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, marginRight: 3, background: has ? "#0f2318" : "#21262d", color: has ? "#57ab5a" : "#8b949e", border: `1px solid ${has ? "#2d5a3a" : "#30363d"}` }}>
      {has ? "✅" : "⚠️"} {label}
    </span>
  );

  return (
    <div style={{ backgroundColor: "#0d1117", color: "#cdd9e5", height: "100%", overflowY: "auto", padding: "20px 24px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #30363d", paddingBottom: 14, marginBottom: 20 }}>
        <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 18 }}>📋 執行紀錄</span>
        <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, background: "#21262d", color: "#8b949e" }}>{executions.length} 筆</span>
      </div>
      {executions.length === 0 ? (
        <div style={{ color: "#484f58", textAlign: "center", padding: "40px 0" }}>尚無執行紀錄</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #30363d" }}>
              {["ID", "測試名稱", "設備", "執行人員", "完成時間", ...(role !== "guest" ? ["照片", "報告"] : [])].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {executions.map((ex) => (
              <Fragment key={ex.id}>
                <tr style={{ borderBottom: expandedId === ex.id ? "none" : "1px solid #21262d" }}>
                  <td style={{ ...tdStyle, color: "#484f58" }}>#{ex.id}</td>
                  <td style={{ ...tdStyle, color: "#cdd9e5" }}><span title={ex.sop_id}>{ex.sop_name || ex.sop_id}</span></td>
                  <td style={{ ...tdStyle, color: "#8b949e", fontFamily: "monospace" }}>{ex.device_id || "—"}</td>
                  <td style={{ ...tdStyle, color: "#8b949e" }}>{role === "guest" ? "—" : (ex.operator || "—")}</td>
                  <td style={{ ...tdStyle, color: "#8b949e" }}>{fmtDatetime(ex.test_ended_at || ex.test_started_at || ex.created_at)}</td>
                  {role !== "guest" && (
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                        <PhotoBadge has={ex.photo_before} label="上架" />
                        <PhotoBadge has={ex.photo_after} label="結束" />
                        <button
                          onClick={() => setExpandedId(expandedId === ex.id ? null : ex.id)}
                          style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, cursor: "pointer", background: "transparent", border: "1px solid #30363d", color: "#8b949e" }}
                        >
                          補充
                        </button>
                      </div>
                    </td>
                  )}
                  {role !== "guest" && (
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {[{ format: "csv", label: "📥 CSV", color: "#58a6ff" }, { format: "pdf", label: "📄 PDF", color: "#3fb950" }].map(({ format, label, color }) => (
                          <button
                            key={format}
                            onClick={() => downloadReport(ex, format)}
                            disabled={downloading[format] === ex.id}
                            style={{ padding: "3px 10px", fontSize: 11, borderRadius: 4, cursor: "pointer", background: "transparent", border: "1px solid #30363d", color, opacity: downloading[format] === ex.id ? 0.5 : 1 }}
                          >
                            {downloading[format] === ex.id ? "⏳" : label}
                          </button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
                {role !== "guest" && expandedId === ex.id && (
                  <tr key={`${ex.id}-expand`} style={{ borderBottom: "1px solid #21262d" }}>
                    <td colSpan={5} style={{ padding: "8px 12px 12px 48px", background: "#161b22" }}>
                      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                        {[{ type: "before", label: "上架時照片", has: ex.photo_before }, { type: "after", label: "測試結束照片", has: ex.photo_after }].map(({ type, label, has }) => (
                          <label key={type} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "5px 10px", borderRadius: 4, fontSize: 11, border: "1px dashed #30363d", color: has ? "#57ab5a" : "#8b949e" }}>
                            {uploading?.id === ex.id && uploading?.type === type ? "⏳ 上傳中..." : has ? `✅ ${label}（重新上傳）` : `📷 上傳${label}`}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(ex.id, type, f); e.target.value = ""; }} />
                          </label>
                        ))}
                        <span style={{ fontSize: 10, color: "#484f58" }}>照片以相機 EXIF 時間為準</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

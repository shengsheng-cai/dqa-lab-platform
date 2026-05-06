import React, { useState, useEffect, useCallback } from "react";
import api from "../../api.js";
import { downloadBlob } from "../../utils/download.js";

const ACTION_LABELS = {
  CREATE: "申請排程",
  CONFIRM: "確認排程",
  CANCEL: "取消排程",
  DELETE: "刪除排程",
  START: "啟動排程",
  AUTO_START: "自動啟動",
  CONFIRM_CONDITION: "確認條件",
  COMPLETE: "完成排程",
  LOAN: "借出治具",
  RETURN: "歸還治具",
  EMERGENCY_STOP: "緊急停止",
};

const ACTION_COLORS = {
  CREATE: "#3fb950",
  CONFIRM: "#58a6ff",
  CANCEL: "#e3b341",
  DELETE: "#f85149",
  START: "#3fb950",
  AUTO_START: "#8b949e",
  CONFIRM_CONDITION: "#58a6ff",
  COMPLETE: "#3fb950",
  LOAN: "#a5d6ff",
  RETURN: "#79c0ff",
  EMERGENCY_STOP: "#f85149",
};

const ENTITY_LABELS = { schedule: "排程", fixture: "治具", device: "設備" };

export default function AuditLog({ active }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = useCallback(() => {
    setLoading(true);
    api
      .get("/api/audit-logs?limit=300")
      .then((r) => setLogs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.entity_type === filter);

  const handleExport = () => {
    downloadBlob("/api/audit-logs/export", `audit_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "12px 16px" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
        {["all", "schedule", "fixture", "device"].map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 4, cursor: "pointer",
              background: filter === key ? "#1f6feb" : "transparent",
              border: `1px solid ${filter === key ? "#1f6feb" : "#30363d"}`,
              color: filter === key ? "#fff" : "#8b949e",
            }}
          >
            {key === "all" ? "全部" : ENTITY_LABELS[key]}
          </button>
        ))}
        <button
          onClick={load}
          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer", background: "transparent", border: "1px solid #30363d", color: "#8b949e" }}
        >↺</button>
        <button
          onClick={handleExport}
          style={{ marginLeft: "auto", fontSize: 11, padding: "3px 10px", borderRadius: 4, cursor: "pointer", background: "#21262d", border: "1px solid #30363d", color: "#cdd9e5" }}
        >
          匯出 CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#484f58", fontSize: 12, padding: 40 }}>載入中…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#484f58", fontSize: 12, padding: 40 }}>尚無稽核紀錄</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #21262d" }}>
                {["時間", "操作人", "動作", "對象", "說明"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 8px", color: "#484f58", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.id} style={{ borderBottom: "1px solid #161b22" }}>
                  <td style={{ padding: "5px 8px", color: "#8b949e", whiteSpace: "nowrap" }}>
                    {new Date(log.timestamp + "Z").toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td style={{ padding: "5px 8px", color: "#cdd9e5" }}>
                    {log.actor === "system:scheduler" ? <span style={{ color: "#484f58" }}>系統</span> : `#${log.actor}`}
                  </td>
                  <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 3,
                      background: (ACTION_COLORS[log.action] || "#8b949e") + "22",
                      color: ACTION_COLORS[log.action] || "#8b949e",
                      border: `1px solid ${ACTION_COLORS[log.action] || "#8b949e"}44`,
                    }}>
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td style={{ padding: "5px 8px", color: "#8b949e", whiteSpace: "nowrap" }}>
                    {ENTITY_LABELS[log.entity_type] || log.entity_type} #{log.entity_id}
                  </td>
                  <td style={{ padding: "5px 8px", color: "#8b949e", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {log.detail || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

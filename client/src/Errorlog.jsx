import React, { useState, useEffect } from "react";
import axios from "axios";

const API = "http://localhost:8000";

const ErrorLog = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get(`${API}/api/errors/`)
      .then((r) => setLogs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const card = {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 12,
    padding: "20px 24px",
  };

  return (
    <div
      style={{
        backgroundColor: "#0d1117",
        color: "#cdd9e5",
        minHeight: "100vh",
        padding: "24px 28px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      {/* 標題 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid #30363d",
          paddingBottom: 16,
          marginBottom: 24,
        }}
      >
        <h1
          style={{ color: "#f85149", margin: 0, fontSize: 22, fontWeight: 700 }}
        >
          🚨 異常看板
        </h1>
        <span
          style={{
            padding: "2px 10px",
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 700,
            color: "#f85149",
            background: "#2d0f0f",
            border: "1px solid #f8514944",
          }}
        >
          {logs.length} 筆紀錄
        </span>
      </div>

      {/* 統計卡片 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ ...card, borderLeft: "3px solid #f85149" }}>
          <div
            style={{
              color: "#8b949e",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            緊急停止次數
          </div>
          <div
            style={{
              color: "#f85149",
              fontSize: 40,
              fontWeight: 800,
              lineHeight: 1.2,
              marginTop: 6,
            }}
          >
            {logs.filter((l) => l.error_type === "EMERGENCY").length}
          </div>
        </div>
        <div style={{ ...card, borderLeft: "3px solid #f0a500" }}>
          <div
            style={{
              color: "#8b949e",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            最近異常時間
          </div>
          <div
            style={{
              color: "#f0a500",
              fontSize: 13,
              fontWeight: 700,
              marginTop: 8,
            }}
          >
            {logs.length > 0 ? logs[0].created_at : "—"}
          </div>
        </div>
        <div style={{ ...card, borderLeft: "3px solid #8b949e" }}>
          <div
            style={{
              color: "#8b949e",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            涉及設備
          </div>
          <div
            style={{
              color: "#cdd9e5",
              fontSize: 13,
              fontWeight: 700,
              marginTop: 8,
            }}
          >
            {logs.length > 0
              ? [...new Set(logs.map((l) => l.device_id))].join(", ")
              : "—"}
          </div>
        </div>
      </div>

      {/* 紀錄列表 */}
      <div style={card}>
        <div
          style={{
            color: "#8b949e",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 1,
            marginBottom: 16,
          }}
        >
          異常紀錄列表 ERROR LOG
        </div>

        {loading ? (
          <div
            style={{
              color: "#484f58",
              fontSize: 13,
              textAlign: "center",
              padding: "20px 0",
            }}
          >
            載入中...
          </div>
        ) : logs.length === 0 ? (
          <div
            style={{
              color: "#484f58",
              fontSize: 13,
              textAlign: "center",
              padding: "20px 0",
            }}
          >
            ✅ 目前無異常紀錄
          </div>
        ) : (
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d" }}>
                {[
                  "ID",
                  "設備",
                  "類型",
                  "執行中 SOP",
                  "溫度",
                  "濕度",
                  "備註",
                  "時間",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "6px 12px",
                      textAlign: "left",
                      color: "#8b949e",
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: "1px solid #21262d" }}>
                  <td style={{ padding: "10px 12px", color: "#484f58" }}>
                    #{log.id}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      color: "#cdd9e5",
                      fontFamily: "monospace",
                    }}
                  >
                    {log.device_id}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#f85149",
                        background: "#2d0f0f",
                        border: "1px solid #f8514944",
                      }}
                    >
                      {log.error_type}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      color: "#8b949e",
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                  >
                    {log.sop_name || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#ff7b72" }}>
                    {log.temperature != null
                      ? `${log.temperature.toFixed(1)} °C`
                      : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#a5d6ff" }}>
                    {log.humidity != null
                      ? `${log.humidity.toFixed(1)} %`
                      : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#8b949e" }}>
                    {log.note || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#484f58" }}>
                    {log.created_at}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ErrorLog;

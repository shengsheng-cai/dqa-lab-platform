import React, { useState, useEffect } from "react";
import api from "../../api.js";
import SensorQcChart from "./SensorQcChart";

const SensorQcModal = ({ deviceId, onClose }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!deviceId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .get(`/api/devices/${deviceId}/sensor-stats`, { signal: controller.signal })
      .then((r) => setStats(r.data))
      .catch((e) => { if (!controller.signal.aborted) setError("載入失敗"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [deviceId]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.6)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(820px, 92vw)",
          maxHeight: "85vh",
          background: "#0d1117",
          border: "1px solid #30363d",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 16px",
            borderBottom: "1px solid #30363d",
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: "#cdd9e5" }}>
            📊 {deviceId} — 感測器 QC 控制圖（近 24 小時）
          </span>
          {stats && stats.anomaly_count > 0 && (
            <span
              style={{
                fontSize: 11,
                color: "#f85149",
                background: "#2d0f0f",
                border: "1px solid #f8514944",
                borderRadius: 4,
                padding: "2px 8px",
                marginRight: 10,
              }}
            >
              ⚠ {stats.anomaly_count} 個異常點
            </span>
          )}
          {stats && stats.anomaly_count === 0 && stats.data.length >= 5 && (
            <span
              style={{
                fontSize: 11,
                color: "#3fb950",
                background: "#0f2d1a",
                border: "1px solid #3fb95044",
                borderRadius: 4,
                padding: "2px 8px",
                marginRight: 10,
              }}
            >
              ✓ 無異常
            </span>
          )}
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#8b949e", fontSize: 16, cursor: "pointer", padding: "0 4px" }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {loading && (
            <div style={{ textAlign: "center", color: "#484f58", fontSize: 12, padding: 40 }}>
              載入中...
            </div>
          )}
          {error && (
            <div style={{ textAlign: "center", color: "#f85149", fontSize: 12, padding: 40 }}>
              {error}
            </div>
          )}
          {!loading && !error && <SensorQcChart stats={stats} />}
        </div>

        {/* Footer stats */}
        {!loading && !error && stats && stats.temp_mean != null && (
          <div
            style={{
              borderTop: "1px solid #30363d",
              padding: "8px 20px",
              display: "flex",
              gap: 20,
              fontSize: 10,
              color: "#8b949e",
              flexShrink: 0,
            }}
          >
            <span>溫度 μ = {stats.temp_mean}°C</span>
            <span style={{ color: "#f85149" }}>UCL = {stats.temp_ucl}°C</span>
            <span style={{ color: "#f85149" }}>LCL = {stats.temp_lcl}°C</span>
            {stats.humi_mean != null && (
              <>
                <span style={{ marginLeft: 12 }}>濕度 μ = {stats.humi_mean}%</span>
                <span style={{ color: "#f85149" }}>UCL = {stats.humi_ucl}%</span>
                <span style={{ color: "#f85149" }}>LCL = {stats.humi_lcl}%</span>
              </>
            )}
            <span style={{ marginLeft: "auto" }}>{stats.data.length} 筆資料（近 {stats.hours}h）</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SensorQcModal;

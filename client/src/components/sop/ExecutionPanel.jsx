import React, { useState } from "react";
import api from "../../api";

// 儲存執行紀錄 + blob 下載報告（帶 X-Demo-Password header，不會被 auth 擋）
// operator 由父元件傳入（啟動前 modal 已確認）
const ExecutionPanel = ({
  activeSop,
  selectedDevice,
  completedSteps,
  operator,
  startedAt,
  savedExecutionId,
  onSaved,
  onError,
}) => {
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const buildFilename = (execId) => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const sopId = (activeSop?.sop_id || "unknown").replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    return `${selectedDevice}_${sopId}_${date}_${execId}.csv`;
  };

  const downloadReport = async (execId) => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await api.get(`/api/reports/csv/${execId}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = buildFilename(execId);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      onError("❌ 報告下載失敗，請確認後端連線。");
    } finally {
      setDownloading(false);
    }
  };

  const saveExecution = async () => {
    if (saving || downloading) return;
    setSaving(true);
    try {
      const stepPayload = activeSop.steps.map((s) => ({
        step_id: s.step_id,
        completed: !!completedSteps[s.step_id],
        parameters: null,
      }));
      const res = await api.post("/api/sop-executions/", {
        sop_id: activeSop.sop_id,
        device_id: selectedDevice,
        operator: operator?.trim() || null,
        test_started_at: startedAt || null,
        steps: stepPayload,
      });

      const execId = res.data.id;
      onSaved(execId);
      await downloadReport(execId);
    } catch {
      onError("❌ 儲存失敗，請確認後端連線。");
    } finally {
      setSaving(false);
    }
  };

  // 已儲存狀態
  if (savedExecutionId) {
    return (
      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            padding: 10,
            background: "#0f2318",
            color: "#57ab5a",
            borderRadius: 6,
            fontSize: 13,
            textAlign: "center",
            fontWeight: 700,
          }}
        >
          ✅ 紀錄已儲存（ID: {savedExecutionId}）
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#8b949e",
            lineHeight: 1.6,
            padding: "6px 10px",
            background: "#0d1117",
            borderRadius: 6,
            border: "1px solid #21262d",
          }}
        >
          下一步：確認報告已下載後，點「正常停止」讓設備自動降溫回待機。
        </div>
        <button
          onClick={() => downloadReport(savedExecutionId)}
          disabled={downloading}
          style={{
            display: "block",
            padding: "10px",
            background: downloading ? "#21262d" : "#1f6feb",
            color: downloading ? "#484f58" : "#fff",
            border: "none",
            borderRadius: 6,
            cursor: downloading ? "not-allowed" : "pointer",
            fontWeight: 700,
            fontSize: 14,
            textAlign: "center",
            width: "100%",
          }}
        >
          {downloading ? "⏳ 下載中..." : "📥 下載 CSV 測試報告（ISO 17025）"}
        </button>
      </div>
    );
  }

  // 未儲存狀態
  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={saveExecution}
        disabled={saving || downloading}
        style={{
          width: "100%",
          padding: "10px",
          background: saving ? "#21262d" : "#238636",
          color: saving ? "#484f58" : "#fff",
          border: "none",
          borderRadius: 6,
          cursor: saving ? "not-allowed" : "pointer",
          fontWeight: 700,
          fontSize: 14,
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? "⏳ 儲存中..." : "💾 儲存並下載報告（ISO 17025）"}
      </button>
    </div>
  );
};

export default ExecutionPanel;

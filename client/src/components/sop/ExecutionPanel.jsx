import React, { useState, useEffect } from "react";
import { downloadBlob, buildReportFilename } from "../../utils/download";
import { buildExecutionPayload } from "../../utils/executionPayload";
import api from "../../api";
import { useToast } from "../useToast";

const ExecutionPanel = ({
  activeSop,
  selectedDevice,
  completedSteps,
  operator,
  startedAt,
  savedExecutionId,
  autoSave = false,
  manualMode = false,
  onSaved,
  onError,
}) => {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const _filename = (execId, ext) =>
    buildReportFilename(activeSop?.sop_id, execId, ext, { device: selectedDevice });

  const downloadReport = async (execId) => {
    if (downloadingCsv) return;
    setDownloadingCsv(true);
    try {
      await downloadBlob(`/api/reports/csv/${execId}`, _filename(execId, "csv"));
    } catch (err) {
      onError(`❌ CSV 下載失敗：${err?.response?.data?.detail || "請確認後端連線"}`);
    } finally {
      setDownloadingCsv(false);
    }
  };

  const downloadPdfReport = async (execId) => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      await downloadBlob(`/api/reports/pdf/${execId}`, _filename(execId, "pdf"));
    } catch (err) {
      onError(`❌ PDF 下載失敗：${err?.response?.data?.detail || "請確認後端連線"}`);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const saveExecution = async () => {
    if (saving || downloadingCsv || downloadingPdf) return;
    setSaving(true);
    try {
      const res = await api.post(
        "/api/sop-executions/",
        buildExecutionPayload({
          sop: activeSop,
          deviceId: selectedDevice,
          operator,
          startedAt,
          manualMode,
          completedSteps,
        }),
      );

      const execId = res.data.id;
      onSaved(execId);
      showToast("執行紀錄已儲存", "success");
    } catch (err) {
      const detail = err?.response?.data?.detail || "請確認後端連線";
      onError(`❌ 儲存失敗：${detail}`);
      showToast(`儲存失敗：${detail}`, "error");
    } finally {
      setSaving(false);
    }
  };

  // Phase 9-3: 測試自然完成時自動存報告
  useEffect(() => {
    if (autoSave && !saving && !savedExecutionId) {
      saveExecution();
    }
  }, [autoSave]); // eslint-disable-line

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
          測試已完成，可下載報告。
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "📥 CSV", color: "#1f6feb", busy: downloadingCsv, onClick: () => downloadReport(savedExecutionId) },
            { label: "📄 PDF（含不確定度）", color: "#238636", busy: downloadingPdf, onClick: () => downloadPdfReport(savedExecutionId) },
          ].map(({ label, color, busy, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={busy}
              style={{
                flex: 1,
                padding: "10px",
                background: busy ? "#21262d" : color,
                color: busy ? "#484f58" : "#fff",
                border: "none",
                borderRadius: 6,
                cursor: busy ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 13,
                textAlign: "center",
              }}
            >
              {busy ? "⏳ 下載中..." : label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // 未儲存狀態
  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={saveExecution}
        disabled={saving || downloadingCsv || downloadingPdf}
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

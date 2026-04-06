import { useState } from "react";
import api from "../../api";
import { downloadBlob } from "../../utils/download";
import { useToast } from "../Toast";

export default function ImportModal({ onClose, onSuccess }) {
  const { showToast } = useToast();
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleFile = (f) => {
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls"].includes(ext)) {
      setError("請上傳 .xlsx 或 .xls 檔案");
      return;
    }
    setFile(f);
    setError("");
    setResult(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setUploadProgress(0);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post("/api/fixtures/import", formData, {
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      setResult(res.data);
      const { imported, updated, skipped } = res.data;
      showToast(`匯入完成：新增 ${imported}、更新 ${updated}、跳過 ${skipped}`, "success");
    } catch (e) {
      setError(e.response?.data?.detail || "匯入失敗");
      showToast(e.response?.data?.detail || "匯入失敗", "error");
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          padding: 24,
          width: 440,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          匯入 Excel 治具資料
        </div>

        <div
          style={{
            background: "#0d1117",
            border: "1px solid #21262d",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 11,
            color: "#8b949e",
            lineHeight: 1.8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ color: "#cdd9e5", fontWeight: 600 }}>以欄標題對應欄位，欄位順序不限</span>
            <button
              onClick={() => downloadBlob("/api/fixtures/template", "fixture_template.xlsx")}
              style={{ background: "transparent", border: "none", color: "#58a6ff", fontSize: 11, cursor: "pointer", padding: 0 }}
            >
              下載標準範本
            </button>
          </div>
          支援的標題：介面、型態、現有數量、缺貨數、優先度、尺寸、用途、使用頻率、汰換年限、備註、保管人、代理人、廠商、型號、單價
          <div style={{ marginTop: 6, color: "#f0a500" }}>
            ⚠ 第一行須為標題行，介面 + 型態為必填，其餘欄位缺少時使用預設值
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById("fixture-file-input").click()}
          style={{
            border: `2px dashed ${dragging ? "#58a6ff" : file ? "#238636" : "#30363d"}`,
            borderRadius: 8,
            padding: "24px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "#0d1f33" : file ? "#0d1f14" : "transparent",
            transition: "all .15s",
          }}
        >
          <input
            id="fixture-file-input"
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
          {file ? (
            <>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📊</div>
              <div style={{ fontSize: 13, color: "#3fb950", fontWeight: 600 }}>
                {file.name}
              </div>
              <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>
                {(file.size / 1024).toFixed(1)} KB
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, marginBottom: 4 }}>📂</div>
              <div style={{ fontSize: 13, color: "#8b949e" }}>
                拖曳 Excel 到這裡，或點擊選擇檔案
              </div>
              <div style={{ fontSize: 11, color: "#484f58", marginTop: 4 }}>
                支援 .xlsx / .xls
              </div>
            </>
          )}
        </div>

        {result && (
          <div
            style={{
              background: "#0d1f14",
              border: "1px solid #238636",
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 13,
            }}
          >
            <span style={{ color: "#3fb950", fontWeight: 700 }}>
              ✅ 匯入完成
            </span>
            <span style={{ color: "#cdd9e5", marginLeft: 10 }}>
              新增 {result.imported} 筆
            </span>
            {result.updated > 0 && (
              <span style={{ color: "#58a6ff", marginLeft: 8 }}>
                更新 {result.updated} 筆
              </span>
            )}
            {result.skipped > 0 && (
              <span style={{ color: "#8b949e", marginLeft: 8 }}>
                跳過 {result.skipped} 筆（空行或缺少必填欄位）
              </span>
            )}
          </div>
        )}

        {loading && uploadProgress > 0 && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
              <span>上傳中...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div style={{ background: "#21262d", borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ width: `${uploadProgress}%`, height: "100%", background: "#238636", transition: "width .2s ease" }} />
            </div>
          </div>
        )}

        {error && <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={
              result
                ? () => {
                    onSuccess();
                    onClose();
                  }
                : onClose
            }
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: 6,
              background: "transparent",
              color: "#8b949e",
              border: "1px solid #30363d",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {result ? "關閉並重新整理" : "取消"}
          </button>
          {!result && (
            <button
              onClick={handleSubmit}
              disabled={!file || loading}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: 6,
                background: file && !loading ? "#238636" : "#21262d",
                color: file && !loading ? "#fff" : "#484f58",
                border: "none",
                cursor: file && !loading ? "pointer" : "not-allowed",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {loading ? "匯入中..." : "開始匯入"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import api from "../../api";
import { useToast } from "../Toast";
import DatePicker from "./DatePicker";

export default function ReturnModal({ loan, onClose, onSubmit }) {
  const { showToast } = useToast();
  const [condition, setCondition] = useState("normal");
  const [note, setNote] = useState("");
  const [returnDate, setReturnDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.post(`/api/fixtures/loans/${loan.id}/return`, {
        return_condition: condition,
        keeper_note: note || null,
        returned_at: returnDate,
      });
      showToast("治具歸還成功", "success");
      onSubmit();
    } catch (e) {
      showToast(e.response?.data?.detail || "歸還登記失敗", "error");
    } finally {
      setLoading(false);
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
          width: 380,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          歸還確認
        </div>
        <div style={{ fontSize: 13, color: "#8b949e" }}>
          {loan.fixture_interface} — {loan.fixture_form_factor}
          <br />
          借用人：{loan.borrower_name}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            ["normal", "正常"],
            ["damaged", "損壞"],
            ["lost", "遺失"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setCondition(v)}
              style={{
                flex: 1,
                padding: "7px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: condition === v ? 700 : 400,
                background:
                  condition === v
                    ? v === "normal"
                      ? "#1a2d1a"
                      : "#2d1a1a"
                    : "transparent",
                color:
                  condition === v
                    ? v === "normal"
                      ? "#3fb950"
                      : "#f85149"
                    : "#8b949e",
                border: `1px solid ${condition === v ? (v === "normal" ? "#238636" : "#f85149") : "#30363d"}`,
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
            實際歸還日期
          </div>
          <DatePicker
            value={returnDate}
            onChange={setReturnDate}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "#0d1117",
              color: "#cdd9e5",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>
        <textarea
          placeholder="備註（選填）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #30363d",
            background: "#0d1117",
            color: "#cdd9e5",
            fontSize: 13,
            resize: "none",
            height: 60,
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
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
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: 6,
              background: "#238636",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {loading ? "確認中..." : "確認歸還"}
          </button>
        </div>
      </div>
    </div>
  );
}

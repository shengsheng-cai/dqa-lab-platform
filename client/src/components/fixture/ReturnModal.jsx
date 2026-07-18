import { C } from "../../styles/theme";
import { useState } from "react";
import api from "../../api";
import { useToast } from "../useToast";
import DatePicker from "./DatePicker";
import ModalShell from "./ModalShell";
import { inputStyle } from "./modalStyles";

const CONDITIONS = [
  ["normal", "正常"],
  ["damaged", "損壞"],
  ["lost", "遺失"],
];

export default function ReturnModal({ loan, onClose, onSubmit }) {
  const { showToast } = useToast();
  const [condition, setCondition] = useState("normal");
  const [note, setNote] = useState("");
  const [returnDate, setReturnDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleSubmit = async () => {
    if ((condition === "damaged" || condition === "lost") && !confirmed) {
      setConfirmed(true);
      return;
    }
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

  const conditionLabel = CONDITIONS.find(([v]) => v === condition)?.[1] ?? condition;

  return (
    <ModalShell width={380} gap={12} onClose={onClose}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          歸還確認
        </div>
        <div style={{ fontSize: 13, color: "#8b949e" }}>
          {loan.fixture_interface} — {loan.fixture_form_factor}
          <br />
          借用人：{loan.borrower_name}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {CONDITIONS.map(([v, l]) => (
            <button
              key={v}
              onClick={() => { setCondition(v); setConfirmed(false); }}
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
                      : C.errorSurface
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
            style={inputStyle}
          />
        </div>
        <textarea
          placeholder="備註（選填）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ ...inputStyle, resize: "none", height: 60 }}
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
              background: confirmed ? "#b62324" : "#238636",
              color: "#fff",
              border: confirmed ? "1px solid #f85149" : "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {loading
              ? "確認中..."
              : confirmed
                ? `⚠️ 確定標記為${conditionLabel}？`
                : "確認歸還"}
          </button>
        </div>
    </ModalShell>
  );
}

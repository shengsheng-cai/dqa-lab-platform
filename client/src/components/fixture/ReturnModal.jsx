import { C } from "../../styles/theme";
import { useState } from "react";
import api from "../../api";
import { useToast } from "../useToast";
import DatePicker from "./DatePicker";
import ModalShell from "./ModalShell";
import { inputStyle, labelStyle } from "./modalStyles";
import { localDateStamp } from "../../utils/timezone";

const CONDITIONS = [
  ["normal", "正常"],
  ["damaged", "損壞"],
  ["lost", "遺失"],
];

export default function ReturnModal({ loan, onClose, onSubmit }) {
  const { showToast } = useToast();
  const [condition, setCondition] = useState("normal");
  const [note, setNote] = useState("");
  const [returnDate, setReturnDate] = useState(localDateStamp("-"));
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
    <ModalShell
      title="歸還確認"
      width={380}
      gap={12}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: 6,
              background: "transparent",
              color: C.textMuted,
              border: `1px solid ${C.border}`,
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
              background: confirmed ? C.errorDark : C.successDark,
              color: C.white,
              border: confirmed ? `1px solid ${C.error}` : "none",
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
      }
    >
    <div style={{ fontSize: 13, color: C.textMuted }}>
      {loan.fixture_interface} — {loan.fixture_form_factor}
      <br />
      借用人：{loan.borrower_name}
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      {CONDITIONS.map(([v, l]) => (
        <button
          key={v}
          onClick={() => { setCondition(v); setConfirmed(false); }}
          aria-current={condition === v ? "true" : undefined}
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
                  ? C.successBgMid
                  : C.errorSurface
                : "transparent",
            color:
              condition === v
                ? v === "normal"
                  ? C.success
                  : C.error
                : C.textMuted,
            border: `1px solid ${condition === v ? (v === "normal" ? C.successDark : C.error) : C.border}`,
          }}
        >
          {l}
        </button>
      ))}
    </div>
    <div>
      <div style={labelStyle}>實際歸還日期</div>
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
    </ModalShell>
  );
}

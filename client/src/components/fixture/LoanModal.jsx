import { useState, useEffect } from "react";
import api from "../../api";
import { useToast } from "../Toast";
import DatePicker from "./DatePicker";

export default function LoanModal({ onClose, onSubmit, fixtures }) {
  const { showToast } = useToast();
  const [fixtureId, setFixtureId] = useState("");
  const [borrowerUserId, setBorrowerUserId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [project, setProject] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState("");

  useEffect(() => {
    api
      .get("/api/fixtures/users")
      .then((r) => { setUsers(r.data); setUsersError(""); })
      .catch((e) => {
        const msg = e.response?.data?.detail || `載入失敗（${e.response?.status || "網路錯誤"}）`;
        setUsersError(msg);
        setUsers([]);
      });
  }, []);

  const handleSubmit = async () => {
    if (!fixtureId || !borrowerUserId) {
      setError("請選擇治具和借用人");
      return;
    }
    const selectedUser = users.find((u) => String(u.id) === String(borrowerUserId));
    setLoading(true);
    setError("");
    try {
      await api.post("/api/fixtures/loans", {
        fixture_id: parseInt(fixtureId),
        borrower_name: selectedUser?.display_name || "",
        borrower_user_id: parseInt(borrowerUserId),
        device_id: deviceId || null,
        project_name: project || null,
        quantity: parseInt(quantity),
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      });
      showToast("治具借出成功", "success");
      onSubmit();
    } catch (e) {
      setError(e.response?.data?.detail || "借出登記失敗");
      showToast(e.response?.data?.detail || "借出登記失敗", "error");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #30363d",
    background: "#0d1117",
    color: "#cdd9e5",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
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
          width: 420,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#cdd9e5",
            marginBottom: 4,
          }}
        >
          借出登記
        </div>
        <select
          value={fixtureId}
          onChange={(e) => setFixtureId(e.target.value)}
          style={inputStyle}
        >
          <option value="">選擇治具</option>
          {fixtures
            .filter((f) => f.available_quantity > 0)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.interface_type} — {f.form_factor}（可借{" "}
                {f.available_quantity}）
              </option>
            ))}
        </select>
        <select
          value={borrowerUserId}
          onChange={(e) => setBorrowerUserId(e.target.value)}
          style={inputStyle}
        >
          <option value="">選擇借用人 *</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}（{u.role}）
            </option>
          ))}
        </select>
        {usersError && (
          <div style={{ color: "#f85149", fontSize: 11, marginTop: -8 }}>
            借用人載入失敗：{usersError}
          </div>
        )}
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          style={inputStyle}
        >
          <option value="">綁定設備（選填）</option>
          {[
            "CH-01",
            "CH-02",
            "CH-03",
            "CH-04",
            "CH-05",
          ].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          placeholder="樣品/專案名稱（選填）"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="number"
            min={1}
            placeholder="數量"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={{ ...inputStyle, width: 80 }}
          />
          <div style={{ flex: 1 }}>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              style={inputStyle}
            />
          </div>
        </div>
        {error && <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
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
            {loading ? "登記中..." : "確認借出"}
          </button>
        </div>
      </div>
    </div>
  );
}

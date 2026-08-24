import { useState, useEffect } from "react";
import api from "../../api";
import { useToast } from "../useToast";
import DatePicker from "./DatePicker";
import ModalShell from "./ModalShell";
import { inputStyle, labelStyle } from "./modalStyles";
import { localDateStamp, endOfLocalDay } from "../../utils/timezone";
import { DEVICE_IDS } from "../../constants";
import { C } from "../../styles/theme";

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
    return localDateStamp("-", d);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState("");

  useEffect(() => {
    api
      .get("/api/auth/users?active_only=true")
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
        // 到期日＝那天結束前要還，送當天 23:59；送午夜的話台北早上 8 點就被判逾期
        due_date: endOfLocalDay(dueDate)?.toISOString() ?? null,
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

  return (
    <ModalShell width={420} gap={12} onClose={onClose}>
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
          {DEVICE_IDS.map((d) => (
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
        {/* 上面幾個下拉沒選之前字都還在、選了之後值本身也看得懂，這一行不一樣：
            一個數字和一組年月日，沒有標籤就認不出是什麼，打完字連提示都不見了。 */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div>
            <label htmlFor="loan-quantity" style={labelStyle}>借出數量</label>
            <input
              id="loan-quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              style={{ ...inputStyle, width: 80 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>預計歸還日</div>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              style={inputStyle}
            />
            {/* 送出時會換成當天 23:59，畫面上只看到日期會以為當天就要還。
                講「這一筆會被記成幾點」而不是「到期日都算到 23:59」——排程預約產生的
                借出是用排程結束時間當到期，那些不走這條規則。 */}
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3 }}>
              送出後記為當日 23:59 到期
            </div>
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
    </ModalShell>
  );
}

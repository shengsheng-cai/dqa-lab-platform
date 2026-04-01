import { useState, useEffect, useCallback } from "react";
import api from "./api";
import { useToast } from "./components/Toast";

const STATUS_COLORS = {
  ok: { bg: "#1a2d1a", color: "#3fb950", label: "庫存足夠" },
  shortage: { bg: "#2d2200", color: "#f0a500", label: "即將不足" },
  out_of_stock: { bg: "#2d1a1a", color: "#f85149", label: "缺貨" },
  loaned: { bg: "#1a1f2d", color: "#58a6ff", label: "借出中" },
  reserved: { bg: "#1a252d", color: "#76e3ea", label: "預約中" },
};

function getStatus(f) {
  if (f.available_quantity === 0 && f.total_quantity === 0)
    return "out_of_stock";
  if (f.shortage > 0) return "shortage";
  if (f.loaned_quantity > 0) return "loaned";
  if (f.reserved_quantity > 0) return "reserved";
  return "ok";
}

function Badge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.ok;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function SummaryCards({ summary }) {
  const cards = [
    { label: "借出中", value: summary.total_loaned, color: "#58a6ff" },
    { label: "今日到期", value: summary.due_today, color: "#f0a500" },
    { label: "逾期未還", value: summary.overdue, color: "#f85149" },
    { label: "庫存不足", value: summary.shortage_count, color: "#f85149" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: 10,
        marginBottom: 16,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
            {c.label}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: c.value > 0 ? c.color : "#cdd9e5",
            }}
          >
            {c.value ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

// 純 select 日期選擇器，value 格式 YYYY-MM-DD
function DatePicker({ value, onChange, style }) {
  const now = new Date();
  const curYear = now.getFullYear();
  const year  = value ? parseInt(value.slice(0, 4))  : curYear;
  const month = value ? parseInt(value.slice(5, 7))  : now.getMonth() + 1;
  const day   = value ? parseInt(value.slice(8, 10)) : now.getDate();

  const emit = (y, mo, d) => {
    const pad = (n) => String(n).padStart(2, "0");
    const maxDay = new Date(y, mo, 0).getDate();
    const safeDay = Math.min(Number(d), maxDay);
    onChange(`${y}-${pad(mo)}-${pad(safeDay)}`);
  };

  const years  = [curYear - 1, curYear, curYear + 1, curYear + 2];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days   = Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1);
  const lbl    = { color: "#6e7681", fontSize: 11 };
  const sel    = { ...style, padding: "4px 4px" };

  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      <select value={year}  onChange={(e) => emit(e.target.value, month, day)} style={{ ...sel, width: 64 }}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <span style={lbl}>年</span>
      <select value={month} onChange={(e) => emit(year, e.target.value, day)} style={{ ...sel, width: 44 }}>
        {months.map((mo) => <option key={mo} value={mo}>{String(mo).padStart(2, "0")}</option>)}
      </select>
      <span style={lbl}>月</span>
      <select value={day}   onChange={(e) => emit(year, month, e.target.value)} style={{ ...sel, width: 44 }}>
        {days.map((d) => <option key={d} value={d}>{String(d).padStart(2, "0")}</option>)}
      </select>
      <span style={lbl}>日</span>
    </div>
  );
}

function ImportModal({ onClose, onSuccess }) {
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
      const { created, updated, skipped } = res.data;
      showToast(`匯入完成：新增 ${created}、更新 ${updated}、跳過 ${skipped}`, "success");
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
          <div style={{ color: "#cdd9e5", fontWeight: 600, marginBottom: 4 }}>
            欄位順序（A → V）
          </div>
          Priority、項次、介面、型態、尺寸、用途、預估用量、現有數量、缺貨數、使用率、汰換時間、備註、保管人、代理人、(略)、(略)、廠商、(略)、型號、規格、交期、單價
          <div style={{ marginTop: 6, color: "#f0a500" }}>
            ⚠ 第一行為標題行（自動跳過），介面 + 型態為必填
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

function LoanModal({ onClose, onSubmit, fixtures }) {
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

function SetKeeperModal({ fixture, onClose, onSubmit }) {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [keeperUserId, setKeeperUserId] = useState(
    fixture.keeper_user_id ? String(fixture.keeper_user_id) : ""
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get("/api/fixtures/users")
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]));
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.patch(`/api/fixtures/${fixture.id}/keeper`, {
        keeper_user_id: keeperUserId ? parseInt(keeperUserId) : null,
      });
      showToast("保管人已設定", "success");
      onSubmit();
      onClose();
    } catch (e) {
      const msg = e.response?.data?.detail || "操作失敗";
      showToast(msg, "error");
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
          width: 360,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          設定保管人
        </div>
        <div style={{ fontSize: 13, color: "#8b949e" }}>
          {fixture.interface_type} — {fixture.form_factor}
          {fixture.keeper_name && (
            <span style={{ marginLeft: 8, color: "#58a6ff" }}>
              目前：{fixture.keeper_name}
            </span>
          )}
        </div>
        <select
          value={keeperUserId}
          onChange={(e) => setKeeperUserId(e.target.value)}
          style={inputStyle}
        >
          <option value="">— 無保管人 —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}（{u.role}）
            </option>
          ))}
        </select>
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
            {loading ? "儲存中..." : "確認"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReturnModal({ loan, onClose, onSubmit }) {
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

function AddEditModal({ fixture, onClose, onSuccess }) {
  const { showToast } = useToast();
  const isEdit = !!fixture;
  const [form, setForm] = useState({
    interface_type: fixture?.interface_type || "",
    form_factor: fixture?.form_factor || "",
    priority: fixture?.priority ?? "",
    size: fixture?.size || "",
    purpose: fixture?.purpose || "",
    total_quantity: fixture?.total_quantity ?? 0,
    shortage: fixture?.shortage ?? 0,
    usage_frequency: fixture?.usage_frequency ?? "",
    replacement_years: fixture?.replacement_years || "",
    note: fixture?.note || "",
    keeper_name: fixture?.keeper_name || "",
    deputy_name: fixture?.deputy_name || "",
    vendor: fixture?.vendor || "",
    model_number: fixture?.model_number || "",
    unit_price: fixture?.unit_price ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.interface_type || !form.form_factor) {
      setError("介面和型態為必填");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const body = {
        ...form,
        priority: form.priority === "" ? null : Number(form.priority),
        total_quantity: Number(form.total_quantity) || 0,
        shortage: Number(form.shortage) || 0,
        usage_frequency: form.usage_frequency === "" ? null : Number(form.usage_frequency),
        unit_price: form.unit_price === "" ? null : Number(form.unit_price),
        size: form.size || null,
        purpose: form.purpose || null,
        replacement_years: form.replacement_years || null,
        note: form.note || null,
        keeper_name: form.keeper_name || null,
        deputy_name: form.deputy_name || null,
        vendor: form.vendor || null,
        model_number: form.model_number || null,
      };
      if (isEdit) {
        await api.patch(`/api/fixtures/${fixture.id}`, body);
        showToast("治具已更新", "success");
      } else {
        await api.post("/api/fixtures/", body);
        showToast("治具已新增", "success");
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
      showToast(e.response?.data?.detail || "操作失敗", "error");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    padding: "7px 10px", borderRadius: 6, border: "1px solid #30363d",
    background: "#0d1117", color: "#cdd9e5", fontSize: 13,
    width: "100%", boxSizing: "border-box",
  };
  const label = (txt) => (
    <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 3 }}>{txt}</div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 24, width: 520, maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          {isEdit ? "編輯治具" : "新增治具"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            {label("介面 *")}
            <input value={form.interface_type} onChange={(e) => set("interface_type", e.target.value)} style={inputStyle} placeholder="e.g. USB-C" />
          </div>
          <div>
            {label("型態 *")}
            <input value={form.form_factor} onChange={(e) => set("form_factor", e.target.value)} style={inputStyle} placeholder="e.g. 轉接頭" />
          </div>
          <div>
            {label("優先度")}
            <input type="number" value={form.priority} onChange={(e) => set("priority", e.target.value)} style={inputStyle} placeholder="數字越小越前" />
          </div>
          <div>
            {label("尺寸")}
            <input value={form.size} onChange={(e) => set("size", e.target.value)} style={inputStyle} />
          </div>
          <div>
            {label("現有數量")}
            <input type="number" min={0} value={form.total_quantity} onChange={(e) => set("total_quantity", e.target.value)} style={inputStyle} />
          </div>
          <div>
            {label("缺貨數")}
            <input type="number" min={0} value={form.shortage} onChange={(e) => set("shortage", e.target.value)} style={inputStyle} />
          </div>
          <div>
            {label("使用頻率")}
            <select value={form.usage_frequency} onChange={(e) => set("usage_frequency", e.target.value)} style={inputStyle}>
              <option value="">—</option>
              <option value="1">每天</option>
              <option value="2">週</option>
              <option value="3">月</option>
              <option value="4">季</option>
              <option value="5">年</option>
            </select>
          </div>
          <div>
            {label("汰換年限")}
            <input value={form.replacement_years} onChange={(e) => set("replacement_years", e.target.value)} style={inputStyle} placeholder="e.g. 3年" />
          </div>
          <div>
            {label("保管人")}
            <input value={form.keeper_name} onChange={(e) => set("keeper_name", e.target.value)} style={inputStyle} />
          </div>
          <div>
            {label("代理人")}
            <input value={form.deputy_name} onChange={(e) => set("deputy_name", e.target.value)} style={inputStyle} />
          </div>
          <div>
            {label("廠商")}
            <input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} style={inputStyle} />
          </div>
          <div>
            {label("型號")}
            <input value={form.model_number} onChange={(e) => set("model_number", e.target.value)} style={inputStyle} />
          </div>
          <div>
            {label("單價")}
            <input type="number" min={0} value={form.unit_price} onChange={(e) => set("unit_price", e.target.value)} style={inputStyle} />
          </div>
          <div>
            {label("用途")}
            <input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div>
          {label("備註")}
          <input value={form.note} onChange={(e) => set("note", e.target.value)} style={inputStyle} />
        </div>
        {error && <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "8px", borderRadius: 6, background: "transparent", color: "#8b949e", border: "1px solid #30363d", cursor: "pointer", fontSize: 13 }}>
            取消
          </button>
          <button onClick={handleSubmit} disabled={loading} style={{ flex: 1, padding: "8px", borderRadius: 6, background: "#238636", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {loading ? "儲存中..." : isEdit ? "儲存" : "新增"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FixturePage({ active, role }) {
  const { showToast } = useToast();
  const [fixtures, setFixtures] = useState([]);
  const [summary, setSummary] = useState({
    total_loaned: 0,
    due_today: 0,
    overdue: 0,
    shortage_count: 0,
  });
  const [activeLoans, setActiveLoans] = useState([]);
  const [search, setSearch] = useState("");
  const [filterInterface, setFilterInterface] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [interfaceTypes, setInterfaceTypes] = useState([]);
  const [activeTab, setActiveTab] = useState("inventory");
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [returnTarget, setReturnTarget] = useState(null);
  const [keeperTarget, setKeeperTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // null=關閉, false=新增, object=編輯
  const [inventoryEdits, setInventoryEdits] = useState({});
  const [loading, setLoading] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchasePreFill, setPurchasePreFill] = useState(null);
  const [showStocktakeModal, setShowStocktakeModal] = useState(false);
  const canOperate = role === "admin" || role === "keeper";
  const [sortKey, setSortKey] = useState("interface_type");
  const [sortDir, setSortDir] = useState("asc");
  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const fetchAll = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const [fRes, sRes, lRes, iRes, poRes] = await Promise.all([
        api.get("/api/fixtures/"),
        api.get("/api/fixtures/summary"),
        api.get("/api/fixtures/loans/active"),
        api.get("/api/fixtures/interface-types"),
        api.get("/api/purchase-orders"),
      ]);
      setFixtures(fRes.data);
      setSummary(sRes.data);
      setActiveLoans(lRes.data);
      setInterfaceTypes(iRes.data);
      setPurchaseOrders(poRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const submitInventory = async (fixtureId) => {
    const val = inventoryEdits[fixtureId];
    if (val === undefined || val === "") return;
    const num = parseInt(val);
    if (isNaN(num) || num < 0) return;
    try {
      await api.post(`/api/fixtures/${fixtureId}/inventory?actual_quantity=${num}`);
      setInventoryEdits((prev) => { const n = { ...prev }; delete n[fixtureId]; return n; });
      fetchAll();
      showToast("盤點記錄已保存", "success");
    } catch (e) {
      const msg = e.response?.data?.detail || "盤點失敗";
      showToast(msg, "error");
    } finally {
      setInventoryEdits((prev) => { const n = { ...prev }; delete n[fixtureId]; return n; });
    }
  };

  const filtered = fixtures.filter((f) => {
    if (filterInterface && f.interface_type !== filterInterface) return false;
    if (filterStatus) {
      const s = getStatus(f);
      if (s !== filterStatus) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (
        f.interface_type.toLowerCase().includes(q) ||
        f.form_factor.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let va = a[sortKey] ?? "";
    let vb = b[sortKey] ?? "";
    if (typeof va === "number" || typeof vb === "number") {
      va = va ?? 0; vb = vb ?? 0;
      return sortDir === "asc" ? va - vb : vb - va;
    }
    va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  const tabStyle = (t) => ({
    padding: "6px 16px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: activeTab === t ? 600 : 400,
    background: activeTab === t ? "#21262d" : "transparent",
    color: activeTab === t ? "#cdd9e5" : "#8b949e",
    border: `1px solid ${activeTab === t ? "#30363d" : "transparent"}`,
  });

  const thStyle = {
    padding: "8px 12px",
    fontSize: 11,
    color: "#8b949e",
    fontWeight: 600,
    textAlign: "left",
    borderBottom: "1px solid #21262d",
    whiteSpace: "nowrap",
  };
  const tdStyle = {
    padding: "9px 12px",
    fontSize: 13,
    color: "#cdd9e5",
    borderBottom: "1px solid #21262d",
  };

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        backgroundColor: "#0d1117",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#cdd9e5" }}>治具管理</div>
        <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>共 {fixtures.length} 種治具</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <button
          style={tabStyle("inventory")}
          onClick={() => setActiveTab("inventory")}
        >
          治具總表
        </button>
        <button style={tabStyle("loans")} onClick={() => setActiveTab("loans")}>
          借出中
          {activeLoans.length > 0 && (
            <span
              style={{
                marginLeft: 4,
                background: "#58a6ff22",
                color: "#58a6ff",
                borderRadius: 10,
                padding: "0 6px",
                fontSize: 11,
              }}
            >
              {activeLoans.length}
            </span>
          )}
        </button>
        {canOperate && (
          <button
            style={tabStyle("overdue")}
            onClick={() => setActiveTab("overdue")}
          >
            逾期未還
            {summary.overdue > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  background: "#f8514922",
                  color: "#f85149",
                  borderRadius: 10,
                  padding: "0 6px",
                  fontSize: 11,
                }}
              >
                {summary.overdue}
              </span>
            )}
          </button>
        )}
        {canOperate && (
          <button
            style={tabStyle("purchase")}
            onClick={() => setActiveTab("purchase")}
          >
            採購清單
            {purchaseOrders.filter((o) => o.status === "pending").length > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  background: "#f0a50022",
                  color: "#f0a500",
                  borderRadius: 10,
                  padding: "0 6px",
                  fontSize: 11,
                }}
              >
                {purchaseOrders.filter((o) => o.status === "pending").length}
              </span>
            )}
          </button>
        )}
        {canOperate && (
          <button
            style={tabStyle("damaged")}
            onClick={() => setActiveTab("damaged")}
          >
            損壞／遺失
          </button>
        )}
        <div style={{ flex: 1 }} />
        {canOperate && (
          <>
            <button
              onClick={() => setShowImportModal(true)}
              style={{ padding: "5px 12px", borderRadius: 6, background: "transparent", color: "#8b949e", border: "1px solid #30363d", cursor: "pointer", fontSize: 12 }}
            >
              匯入 Excel
            </button>
            <button
              onClick={() => setEditTarget(false)}
              style={{ padding: "5px 12px", borderRadius: 6, background: "transparent", color: "#58a6ff", border: "1px solid #58a6ff44", cursor: "pointer", fontSize: 12 }}
            >
              + 新增治具
            </button>
            <button
              onClick={() => setShowLoanModal(true)}
              style={{ padding: "5px 12px", borderRadius: 6, background: "#238636", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              + 借出登記
            </button>
          </>
        )}
      </div>

      {activeTab === "inventory" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <input
              placeholder="搜尋治具..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                padding: "7px 12px",
                borderRadius: 6,
                border: "1px solid #30363d",
                background: "#161b22",
                color: "#cdd9e5",
                fontSize: 13,
              }}
            />
            {canOperate && (
              <button
                onClick={() => setShowStocktakeModal(true)}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: "1px solid #30363d",
                  background: "#1a3828",
                  color: "#3fb950",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                🔍 開始月盤點
              </button>
            )}
            <input
              type="text"
              placeholder="🔍 按介面/型態搜尋..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #30363d",
                background: "#161b22",
                color: "#cdd9e5",
                fontSize: 13,
              }}
            />
            <select
              value={filterInterface}
              onChange={(e) => setFilterInterface(e.target.value)}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #30363d",
                background: "#161b22",
                color: "#cdd9e5",
                fontSize: 13,
              }}
            >
              <option value="">全部介面</option>
              {interfaceTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #30363d",
                background: "#161b22",
                color: "#cdd9e5",
                fontSize: 13,
              }}
            >
              <option value="">全部狀態</option>
              <option value="ok">庫存足夠</option>
              <option value="shortage">即將不足</option>
              <option value="out_of_stock">缺貨</option>
              <option value="loaned">借出中</option>
            </select>
          </div>
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              overflowX: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#21262d" }}>
                  {[
                    { label: "介面", key: "interface_type" },
                    { label: "型態", key: "form_factor" },
                    { label: "尺寸", key: "size" },
                    { label: "現有", key: "total_quantity" },
                    { label: "借出", key: "loaned_quantity" },
                    { label: "預約", key: "reserved_quantity" },
                    { label: "可借", key: "available_quantity" },
                    { label: "缺貨", key: "shortage" },
                    { label: "狀態", key: null },
                    { label: "使用率", key: "usage_frequency" },
                    { label: "汰換", key: "estimated_replacement_date" },
                    { label: "保管人", key: "keeper_name" },
                    { label: "實際數量", key: null },
                  ].map(({ label, key }) => (
                    <th
                      key={label}
                      style={{
                        ...thStyle,
                        cursor: key ? "pointer" : "default",
                        userSelect: "none",
                      }}
                      onClick={() => key && handleSort(key)}
                    >
                      {label}
                      {key && sortKey === key && (
                        <span style={{ marginLeft: 3, fontSize: 9 }}>
                          {sortDir === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </th>
                  ))}
                  {canOperate && <th style={thStyle}>操作</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={canOperate ? 13 : 12}
                      style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}
                    >
                      載入中...
                    </td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canOperate ? 13 : 12}
                      style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}
                    >
                      無符合資料
                    </td>
                  </tr>
                ) : (
                  sorted.map((f) => {
                    const editVal = inventoryEdits[f.id];
                    const isDiff = editVal !== undefined && editVal !== "" &&
                      !isNaN(parseInt(editVal)) && parseInt(editVal) < f.total_quantity;
                    return (
                    <tr
                      key={f.id}
                      style={{ transition: "background .1s" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "#161b22")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <td style={{ ...tdStyle, color: "#58a6ff" }}>
                        {f.interface_type}
                      </td>
                      <td style={tdStyle}>{f.form_factor}</td>
                      <td style={{ ...tdStyle, color: "#8b949e" }}>
                        {f.size || "—"}
                      </td>
                      <td style={tdStyle}>{f.total_quantity}</td>
                      <td
                        style={{
                          ...tdStyle,
                          color: f.loaned_quantity > 0 ? "#f0a500" : "#8b949e",
                        }}
                      >
                        {f.loaned_quantity}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: f.reserved_quantity > 0 ? "#76e3ea" : "#8b949e",
                        }}
                      >
                        {f.reserved_quantity}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: f.available_quantity > 0 ? "#3fb950" : "#f85149",
                          fontWeight: 600,
                        }}
                      >
                        {f.available_quantity}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: f.shortage > 0 ? "#f85149" : "#8b949e",
                        }}
                      >
                        {f.shortage || "—"}
                      </td>
                      <td style={tdStyle}>
                        <Badge status={getStatus(f)} />
                      </td>
                      <td style={{ ...tdStyle, color: "#8b949e" }}>
                        {["", "每天", "週", "月", "季", "年"][
                          f.usage_frequency
                        ] || "—"}
                      </td>
                      <td style={tdStyle}>
                        {(() => {
                          if (!f.estimated_replacement_date) return <span style={{ color: "#484f58" }}>—</span>;
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const due = new Date(f.estimated_replacement_date);
                          const daysLeft = Math.ceil((due - today) / 86400000);
                          const color = daysLeft < 0 ? "#f85149" : daysLeft <= 30 ? "#f0a500" : "#8b949e";
                          return <span style={{ color, fontWeight: daysLeft <= 30 ? 600 : 400 }}>{f.estimated_replacement_date}</span>;
                        })()}
                      </td>
                      <td style={{ ...tdStyle, color: f.keeper_name ? "#58a6ff" : "#484f58" }}>
                        {f.keeper_name || "未設定"}
                      </td>
                      <td style={tdStyle}>
                        {canOperate ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <input
                              type="number"
                              min={0}
                              value={editVal ?? ""}
                              placeholder={String(f.total_quantity)}
                              onChange={(e) =>
                                setInventoryEdits((prev) => ({ ...prev, [f.id]: e.target.value }))
                              }
                              onKeyDown={(e) => e.key === "Enter" && submitInventory(f.id)}
                              style={{
                                width: 60,
                                padding: "3px 6px",
                                borderRadius: 4,
                                border: `1px solid ${isDiff ? "#f85149" : "#30363d"}`,
                                background: "#0d1117",
                                color: isDiff ? "#f85149" : "#cdd9e5",
                                fontSize: 12,
                              }}
                            />
                            {editVal !== undefined && editVal !== "" && (
                              <button
                                onClick={() => submitInventory(f.id)}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  border: "1px solid #238636",
                                  background: "#238636",
                                  color: "#fff",
                                  fontSize: 11,
                                  cursor: "pointer",
                                }}
                              >
                                確認
                              </button>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#8b949e" }}>{f.total_quantity}</span>
                        )}
                      </td>
                      {canOperate && (
                        <td style={tdStyle}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <button
                              onClick={() => setEditTarget(f)}
                              style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #58a6ff44", background: "transparent", color: "#58a6ff", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => setKeeperTarget(f)}
                              style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #30363d", background: "transparent", color: "#8b949e", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                            >
                              保管人
                            </button>
                            {f.available_quantity === 0 && (
                              <button
                                onClick={() => { setPurchasePreFill(f); setShowPurchaseModal(true); }}
                                style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #f0a500", background: "transparent", color: "#f0a500", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                              >
                                採購
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                if (!window.confirm(`確定刪除「${f.interface_type} — ${f.form_factor}」？`)) return;
                                try {
                                  await api.delete(`/api/fixtures/${f.id}`);
                                  fetchAll();
                                } catch (e) {
                                  alert(e.response?.data?.detail || "刪除失敗");
                                } finally {
                                  // 確保刪除操作不留下未清理的狀態
                                }
                              }}
                              style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #f8514944", background: "transparent", color: "#f85149", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                            >
                              刪除
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === "loans" && (
        <div
          style={{
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#21262d" }}>
                <th style={thStyle}>治具</th>
                <th style={thStyle}>借用人</th>
                <th style={thStyle}>綁定設備</th>
                <th style={thStyle}>專案</th>
                <th style={thStyle}>數量</th>
                <th style={thStyle}>借出日</th>
                <th style={thStyle}>到期日</th>
                <th style={thStyle}>狀態</th>
                {canOperate && <th style={thStyle}>操作</th>}
              </tr>
            </thead>
            <tbody>
              {activeLoans.length === 0 ? (
                <tr>
                  <td
                    colSpan={canOperate ? 9 : 8}
                    style={{
                      ...tdStyle,
                      textAlign: "center",
                      color: "#8b949e",
                    }}
                  >
                    目前無借出紀錄
                  </td>
                </tr>
              ) : (
                activeLoans.map((loan) => {
                  const isOverdue =
                    loan.due_date && new Date(loan.due_date) < new Date();
                  return (
                    <tr key={loan.id}>
                      <td style={tdStyle}>
                        {loan.fixture_interface} — {loan.fixture_form_factor}
                      </td>
                      <td style={tdStyle}>{loan.borrower_name}</td>
                      <td style={{ ...tdStyle, color: "#8b949e" }}>
                        {loan.device_id || "—"}
                      </td>
                      <td style={{ ...tdStyle, color: "#8b949e" }}>
                        {loan.project_name || "—"}
                      </td>
                      <td style={tdStyle}>{loan.quantity}</td>
                      <td style={{ ...tdStyle, color: "#8b949e" }}>
                        {loan.loan_date
                          ? new Date(loan.loan_date).toLocaleDateString("zh-TW")
                          : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: isOverdue ? "#f85149" : "#8b949e",
                        }}
                      >
                        {loan.due_date
                          ? new Date(loan.due_date).toLocaleDateString("zh-TW")
                          : "—"}
                        {isOverdue && (
                          <span
                            style={{
                              marginLeft: 4,
                              fontSize: 10,
                              color: "#f85149",
                            }}
                          >
                            逾期
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <Badge status="loaned" />
                      </td>
                      {canOperate && (
                        <td style={tdStyle}>
                          <button
                            onClick={() => setReturnTarget(loan)}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 4,
                              background: "#1a2d1a",
                              color: "#3fb950",
                              border: "1px solid #238636",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            歸還
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "overdue" && (
        <OverdueList
          canOperate={canOperate}
          onReturn={(loan) => setReturnTarget(loan)}
          onRefresh={fetchAll}
        />
      )}

      {activeTab === "damaged" && <DamagedList />}

      {activeTab === "purchase" && (
        <PurchaseTab
          orders={purchaseOrders}
          fixtures={fixtures}
          canOperate={canOperate}
          role={role}
          onRefresh={fetchAll}
          onNew={() => { setPurchasePreFill(null); setShowPurchaseModal(true); }}
        />
      )}

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={fetchAll}
        />
      )}
      {editTarget !== null && (
        <AddEditModal
          fixture={editTarget || null}
          onClose={() => setEditTarget(null)}
          onSuccess={fetchAll}
        />
      )}
      {showLoanModal && (
        <LoanModal
          fixtures={fixtures}
          onClose={() => setShowLoanModal(false)}
          onSubmit={() => {
            setShowLoanModal(false);
            fetchAll();
          }}
        />
      )}
      {returnTarget && (
        <ReturnModal
          loan={returnTarget}
          onClose={() => setReturnTarget(null)}
          onSubmit={() => {
            setReturnTarget(null);
            fetchAll();
          }}
        />
      )}
      {keeperTarget && (
        <SetKeeperModal
          fixture={keeperTarget}
          onClose={() => setKeeperTarget(null)}
          onSubmit={() => {
            setKeeperTarget(null);
            fetchAll();
          }}
        />
      )}
      {showPurchaseModal && (
        <CreatePurchaseModal
          fixtures={fixtures}
          preFill={purchasePreFill}
          onClose={() => { setShowPurchaseModal(false); setPurchasePreFill(null); }}
          onSubmit={() => {
            setShowPurchaseModal(false);
            setPurchasePreFill(null);
            fetchAll();
          }}
        />
      )}
      {showStocktakeModal && (
        <StocktakeModal
          fixtures={fixtures}
          onClose={() => setShowStocktakeModal(false)}
          onComplete={() => {
            setShowStocktakeModal(false);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

function StocktakeModal({ fixtures, onClose, onComplete }) {
  const { showToast } = useToast();
  const [actuals, setActuals] = useState({});
  const [loading, setLoading] = useState(false);

  const active = fixtures.filter((f) => {
    const s = getStatus(f);
    return s === "ok" || s === "shortage" || s === "out_of_stock";
  });

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const results = { normal: 0, diff: 0 };
      for (const f of active) {
        const actual = parseInt(actuals[f.id] || f.total_quantity);
        if (actual !== f.total_quantity) {
          await api.put(`/api/fixtures/${f.id}/inventory`, { actual_quantity: actual });
          results.diff++;
        } else {
          results.normal++;
        }
      }
      showToast(`盤點完成：正常 ${results.normal} 、差異 ${results.diff}`, "success");
      onComplete();
    } catch (e) {
      showToast(e.response?.data?.detail || "盤點失敗", "error");
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
      onClick={onClose}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          padding: 24,
          width: 600,
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5", marginBottom: 16 }}>
          🔍 月盤點
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {active.map((f) => {
            const actual = actuals[f.id];
            const isDiff = actual !== undefined && parseInt(actual) !== f.total_quantity;
            return (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px",
                  background: isDiff ? "#3d1f1a" : "#0d1117",
                  borderRadius: 6,
                  border: `1px solid ${isDiff ? "#da3633" : "#30363d"}`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#cdd9e5" }}>
                    {f.interface_type} / {f.form_factor}
                  </div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>
                    系統庫存：{f.total_quantity}
                  </div>
                </div>
                <input
                  type="number"
                  min="0"
                  value={actual !== undefined ? actual : f.total_quantity}
                  onChange={(e) => setActuals((p) => ({ ...p, [f.id]: e.target.value }))}
                  style={{
                    width: 80,
                    padding: "6px 8px",
                    borderRadius: 4,
                    border: `1px solid ${isDiff ? "#f85149" : "#30363d"}`,
                    background: "#0d1117",
                    color: isDiff ? "#f85149" : "#cdd9e5",
                    fontSize: 12,
                  }}
                />
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "transparent",
              color: "#8b949e",
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
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "#238636",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "提交中..." : "完成盤點"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OverdueList({ canOperate, onReturn }) {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/api/fixtures/loans/overdue")
      .then((r) => setLoans(r.data))
      .finally(() => setLoading(false));
  }, []);

  const thStyle = {
    padding: "8px 12px",
    fontSize: 11,
    color: "#8b949e",
    fontWeight: 600,
    textAlign: "left",
    borderBottom: "1px solid #21262d",
  };
  const tdStyle = {
    padding: "9px 12px",
    fontSize: 13,
    color: "#cdd9e5",
    borderBottom: "1px solid #21262d",
  };

  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#21262d" }}>
            <th style={thStyle}>治具</th>
            <th style={thStyle}>借用人</th>
            <th style={thStyle}>綁定設備</th>
            <th style={thStyle}>專案</th>
            <th style={thStyle}>到期日</th>
            <th style={thStyle}>逾期天數</th>
            {canOperate && <th style={thStyle}>操作</th>}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={canOperate ? 7 : 6}
                style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}
              >
                載入中...
              </td>
            </tr>
          ) : loans.length === 0 ? (
            <tr>
              <td
                colSpan={canOperate ? 7 : 6}
                style={{ ...tdStyle, textAlign: "center", color: "#3fb950" }}
              >
                目前無逾期未還
              </td>
            </tr>
          ) : (
            loans.map((loan) => (
              <tr key={loan.id}>
                <td style={tdStyle}>
                  {loan.fixture_interface} — {loan.fixture_form_factor}
                </td>
                <td style={{ ...tdStyle, color: "#f85149", fontWeight: 600 }}>
                  {loan.borrower_name}
                </td>
                <td style={{ ...tdStyle, color: "#8b949e" }}>
                  {loan.device_id || "—"}
                </td>
                <td style={{ ...tdStyle, color: "#8b949e" }}>
                  {loan.project_name || "—"}
                </td>
                <td style={{ ...tdStyle, color: "#f85149" }}>
                  {loan.due_date
                    ? new Date(loan.due_date).toLocaleDateString("zh-TW")
                    : "—"}
                </td>
                <td style={{ ...tdStyle, color: "#f85149", fontWeight: 700 }}>
                  {loan.overdue_days} 天
                </td>
                {canOperate && (
                  <td style={tdStyle}>
                    <button
                      onClick={() => onReturn(loan)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 4,
                        background: "#1a2d1a",
                        color: "#3fb950",
                        border: "1px solid #238636",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      歸還
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 損壞／遺失 tab ───────────────────────────────────────────
function DamagedList() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/api/fixtures/loans/damaged")
      .then((r) => setLoans(r.data))
      .finally(() => setLoading(false));
  }, []);

  const thStyle = {
    padding: "8px 12px",
    fontSize: 11,
    color: "#8b949e",
    fontWeight: 600,
    textAlign: "left",
    borderBottom: "1px solid #21262d",
  };
  const tdStyle = {
    padding: "9px 12px",
    fontSize: 13,
    color: "#cdd9e5",
    borderBottom: "1px solid #21262d",
  };

  const conditionLabel = {
    damaged: { label: "損壞", color: "#f0a500" },
    lost: { label: "遺失", color: "#f85149" },
  };

  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#21262d" }}>
            <th style={thStyle}>治具</th>
            <th style={thStyle}>借用人</th>
            <th style={thStyle}>綁定設備</th>
            <th style={thStyle}>專案</th>
            <th style={thStyle}>數量</th>
            <th style={thStyle}>歸還日</th>
            <th style={thStyle}>狀態</th>
            <th style={thStyle}>備註</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}>
                載入中...
              </td>
            </tr>
          ) : loans.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#3fb950" }}>
                目前無損壞或遺失紀錄
              </td>
            </tr>
          ) : (
            loans.map((loan) => {
              const cond = conditionLabel[loan.status] || { label: loan.status, color: "#8b949e" };
              return (
                <tr key={loan.id}>
                  <td style={tdStyle}>
                    {loan.fixture_interface} — {loan.fixture_form_factor}
                  </td>
                  <td style={tdStyle}>{loan.borrower_name}</td>
                  <td style={{ ...tdStyle, color: "#8b949e" }}>{loan.device_id || "—"}</td>
                  <td style={{ ...tdStyle, color: "#8b949e" }}>{loan.project_name || "—"}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{loan.quantity}</td>
                  <td style={{ ...tdStyle, color: "#8b949e" }}>
                    {loan.return_date
                      ? new Date(loan.return_date).toLocaleDateString("zh-TW")
                      : "—"}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        background: cond.color + "22",
                        color: cond.color,
                        borderRadius: 4,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {cond.label}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: "#8b949e", fontSize: 12 }}>
                    {loan.keeper_note || "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 採購清單 tab ────────────────────────────────────────────
const PO_STATUS = {
  pending:   { label: "待採購", color: "#f0a500", bg: "#2d2200" },
  arrived:   { label: "已到貨", color: "#3fb950", bg: "#1a2d1a" },
  cancelled: { label: "已取消", color: "#8b949e", bg: "#21262d" },
};

function PurchaseTab({ orders, fixtures, canOperate, role, onRefresh, onNew }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleArrive = async (order) => {
    setLoading(true);
    try {
      await api.patch(`/api/purchase-orders/${order.id}`, { status: "arrived" });
      onRefresh();
      showToast("採購單已標記到貨", "success");
    } catch (e) {
      const msg = e.response?.data?.detail || "標記失敗";
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (order) => {
    if (!window.confirm(`確認刪除此採購單？`)) return;
    setLoading(true);
    try {
      await api.delete(`/api/purchase-orders/${order.id}`);
      onRefresh();
      showToast("採購單已刪除", "success");
    } catch (e) {
      const msg = e.response?.data?.detail || "刪除失敗";
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const thStyle = {
    padding: "8px 12px",
    fontSize: 11,
    color: "#8b949e",
    fontWeight: 600,
    textAlign: "left",
    borderBottom: "1px solid #21262d",
    whiteSpace: "nowrap",
  };
  const tdStyle = {
    padding: "9px 12px",
    fontSize: 13,
    color: "#cdd9e5",
    borderBottom: "1px solid #21262d",
  };

  return (
    <>
      {canOperate && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button
            onClick={onNew}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              background: "#1f4a1f",
              color: "#3fb950",
              border: "1px solid #238636",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            + 新增採購單
          </button>
        </div>
      )}
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#21262d" }}>
              <th style={thStyle}>治具</th>
              <th style={thStyle}>數量</th>
              <th style={thStyle}>廠商</th>
              <th style={thStyle}>單價</th>
              <th style={thStyle}>狀態</th>
              <th style={thStyle}>建立日期</th>
              <th style={thStyle}>到貨日期</th>
              <th style={thStyle}>備註</th>
              {canOperate && <th style={thStyle}>操作</th>}
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td
                  colSpan={canOperate ? 9 : 8}
                  style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}
                >
                  目前無採購紀錄
                </td>
              </tr>
            ) : (
              orders.map((o) => {
                const st = PO_STATUS[o.status] || PO_STATUS.pending;
                return (
                  <tr key={o.id}>
                    <td style={{ ...tdStyle, color: "#58a6ff" }}>{o.fixture_label}</td>
                    <td style={tdStyle}>{o.quantity}</td>
                    <td style={{ ...tdStyle, color: "#8b949e" }}>{o.vendor || "—"}</td>
                    <td style={{ ...tdStyle, color: "#8b949e" }}>
                      {o.unit_price != null ? `$${o.unit_price}` : "—"}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          background: st.bg,
                          color: st.color,
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontWeight: 600,
                        }}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: "#8b949e" }}>
                      {o.created_at ? o.created_at.slice(0, 10) : "—"}
                    </td>
                    <td style={{ ...tdStyle, color: o.arrived_at ? "#3fb950" : "#8b949e" }}>
                      {o.arrived_at ? o.arrived_at.slice(0, 10) : "—"}
                    </td>
                    <td style={{ ...tdStyle, color: "#8b949e", maxWidth: 160, wordBreak: "break-all" }}>
                      {o.note || "—"}
                    </td>
                    {canOperate && (
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {o.status === "pending" && (
                            <button
                              onClick={() => handleArrive(o)}
                              disabled={loading}
                              style={{
                                padding: "3px 8px",
                                borderRadius: 4,
                                background: "#1a2d1a",
                                color: "#3fb950",
                                border: "1px solid #238636",
                                cursor: "pointer",
                                fontSize: 11,
                                whiteSpace: "nowrap",
                              }}
                            >
                              確認到貨
                            </button>
                          )}
                          {o.status === "pending" && role === "admin" && (
                            <button
                              onClick={() => handleDelete(o)}
                              disabled={loading}
                              style={{
                                padding: "3px 8px",
                                borderRadius: 4,
                                background: "transparent",
                                color: "#f85149",
                                border: "1px solid #f85149",
                                cursor: "pointer",
                                fontSize: 11,
                              }}
                            >
                              刪除
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── 新增採購單 Modal ────────────────────────────────────────
function CreatePurchaseModal({ fixtures, preFill, onClose, onSubmit }) {
  const { showToast } = useToast();
  const [fixtureId, setFixtureId] = useState(preFill ? String(preFill.id) : "");
  const [quantity, setQuantity] = useState(preFill ? String(preFill.shortage || 1) : "1");
  const [vendor, setVendor] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!fixtureId) { setError("請選擇治具"); return; }
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) { setError("數量需大於 0"); return; }
    setLoading(true);
    setError("");
    try {
      await api.post("/api/purchase-orders/", {
        fixture_id: parseInt(fixtureId),
        quantity: qty,
        vendor: vendor || null,
        unit_price: unitPrice ? parseFloat(unitPrice) : null,
        note: note || null,
      });
      showToast("採購單已新增", "success");
      onSubmit();
      onClose();
    } catch (e) {
      const msg = e.response?.data?.detail || "新增失敗";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #30363d",
    background: "#0d1117",
    color: "#cdd9e5",
    fontSize: 13,
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 12, color: "#8b949e", marginBottom: 4 };

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
          gap: 14,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          新增採購單
        </div>

        <div>
          <div style={labelStyle}>治具 *</div>
          <select
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.value)}
            style={inputStyle}
          >
            <option value="">請選擇治具</option>
            {fixtures.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.interface_type} / {f.form_factor}
                {f.size ? ` (${f.size})` : ""}
                {" — "}可借 {f.available_quantity}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={labelStyle}>採購數量 *</div>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <div style={labelStyle}>廠商（選填）</div>
          <input
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="廠商名稱"
            style={inputStyle}
          />
        </div>

        <div>
          <div style={labelStyle}>單價（選填）</div>
          <input
            type="number"
            min={0}
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </div>

        <div>
          <div style={labelStyle}>備註（選填）</div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：急需、替換損壞品..."
            style={inputStyle}
          />
        </div>

        {error && <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 18px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "transparent",
              color: "#8b949e",
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
              padding: "7px 18px",
              borderRadius: 6,
              border: "none",
              background: "#238636",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "送出中..." : "建立採購單"}
          </button>
        </div>
      </div>
    </div>
  );
}

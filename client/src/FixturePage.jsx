import { useState, useEffect, useCallback } from "react";
import api from "./api";

const STATUS_COLORS = {
  ok: { bg: "#1a2d1a", color: "#3fb950", label: "庫存足夠" },
  shortage: { bg: "#2d2200", color: "#f0a500", label: "即將不足" },
  out_of_stock: { bg: "#2d1a1a", color: "#f85149", label: "缺貨" },
  loaned: { bg: "#1a1f2d", color: "#58a6ff", label: "借出中" },
};

function getStatus(f) {
  if (f.available_quantity === 0 && f.total_quantity === 0)
    return "out_of_stock";
  if (f.shortage > 0) return "shortage";
  if (f.loaned_quantity > 0) return "loaned";
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

function ImportModal({ onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
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
    console.log("handleSubmit called, file:", file);
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post("/api/fixtures/import", formData);
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || "匯入失敗");
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
              成功 {result.imported} 筆
            </span>
            {result.skipped > 0 && (
              <span style={{ color: "#8b949e", marginLeft: 8 }}>
                跳過 {result.skipped} 筆（空行或缺少必填欄位）
              </span>
            )}
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
  const [fixtureId, setFixtureId] = useState("");
  const [borrowerUserId, setBorrowerUserId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [project, setProject] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [dueDate, setDueDate] = useState("");
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
      onSubmit();
    } catch (e) {
      setError(e.response?.data?.detail || "借出登記失敗");
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
            "KSON_CH01",
            "KSON_CH02",
            "KSON_CH03",
            "KSON_CH04",
            "KSON_CH05",
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
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number"
            min={1}
            placeholder="數量"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={{ ...inputStyle, width: 80 }}
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
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
      onSubmit();
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
  const [condition, setCondition] = useState("normal");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.post(`/api/fixtures/loans/${loan.id}/return`, {
        return_condition: condition,
        keeper_note: note || null,
      });
      onSubmit();
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

export default function FixturePage({ active, role }) {
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
  const [inventoryEdits, setInventoryEdits] = useState({});
  const [loading, setLoading] = useState(false);
  const canOperate = role === "admin" || role === "keeper";

  const fetchAll = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const [fRes, sRes, lRes, iRes] = await Promise.all([
        api.get("/api/fixtures/"),
        api.get("/api/fixtures/summary"),
        api.get("/api/fixtures/loans/active"),
        api.get("/api/fixtures/interface-types"),
      ]);
      setFixtures(fRes.data);
      setSummary(sRes.data);
      setActiveLoans(lRes.data);
      setInterfaceTypes(iRes.data);
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
    } catch (e) {
      console.error("盤點回填失敗", e);
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#cdd9e5" }}>
            治具管理
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>
            共 {fixtures.length} 種治具
          </div>
        </div>
        {canOperate && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowImportModal(true)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                background: "transparent",
                color: "#8b949e",
                border: "1px solid #30363d",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              匯入 Excel
            </button>
            <button
              onClick={() => setShowLoanModal(true)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                background: "#238636",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + 借出登記
            </button>
          </div>
        )}
      </div>

      <SummaryCards summary={summary} />

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
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
      </div>

      {activeTab === "inventory" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
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
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#21262d" }}>
                  <th style={thStyle}>介面</th>
                  <th style={thStyle}>型態</th>
                  <th style={thStyle}>尺寸</th>
                  <th style={thStyle}>現有</th>
                  <th style={thStyle}>借出</th>
                  <th style={thStyle}>可借</th>
                  <th style={thStyle}>缺貨</th>
                  <th style={thStyle}>狀態</th>
                  <th style={thStyle}>使用率</th>
                  <th style={thStyle}>汰換</th>
                  <th style={thStyle}>保管人</th>
                  <th style={thStyle}>實際數量</th>
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
                ) : filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canOperate ? 13 : 12}
                      style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}
                    >
                      無符合資料
                    </td>
                  </tr>
                ) : (
                  filtered.map((f) => {
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
                      <td style={{ ...tdStyle, color: "#8b949e" }}>
                        {f.replacement_years || "—"}
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
                          <button
                            onClick={() => setKeeperTarget(f)}
                            style={{
                              padding: "3px 10px",
                              borderRadius: 4,
                              border: "1px solid #30363d",
                              background: "transparent",
                              color: "#8b949e",
                              fontSize: 11,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            設定保管人
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

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
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

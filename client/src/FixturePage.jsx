import { useState, useEffect, useCallback, useRef } from "react";
import api from "./api";
const settle = (p) => p.then((r) => r.data).catch((e) => { console.warn("[FixturePage] API fail:", e?.response?.status, e?.config?.url); return null; });
import { downloadBlob } from "./utils/download";
import { formatLocal } from "./utils/timezone";
import { useToast } from "./components/Toast";
import ImportModal from "./components/fixture/ImportModal";
import LoanModal from "./components/fixture/LoanModal";
import SetKeeperModal from "./components/fixture/SetKeeperModal";
import ReturnModal from "./components/fixture/ReturnModal";
import AddEditModal from "./components/fixture/AddEditModal";
import StocktakeModal from "./components/fixture/StocktakeModal";
import CreatePurchaseModal from "./components/fixture/CreatePurchaseModal";
import ConfirmModal from "./components/ConfirmModal";

function ResizableTh({ children, defaultWidth, style, onClick }) {
  const [width, setWidth] = useState(defaultWidth || null);
  const startX = useRef(null);
  const startW = useRef(null);
  const cleanupRef = useRef(null);

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const onMouseDown = (e) => {
    if (!e.target.dataset.resize) return;
    e.preventDefault();
    startX.current = e.clientX;
    startW.current = typeof width === "number" ? width : e.currentTarget.offsetWidth;
    const onMove = (me) => setWidth(Math.max(40, startW.current + me.clientX - startX.current));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cleanupRef.current = null;
    };
    cleanupRef.current = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <th
      style={{ ...style, width: width != null ? width : undefined, position: "relative", overflow: "hidden" }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {children}
      <span
        data-resize="1"
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: 6,
          height: "100%",
          cursor: "col-resize",
          userSelect: "none",
          background: "transparent",
          zIndex: 1,
        }}
      />
    </th>
  );
}

const RETURN_CONDITIONS = [
  { condition: "normal",  label: "正常", color: "#3fb950", bg: "#1a2d1a", border: "#238636" },
  { condition: "damaged", label: "損壞", color: "#f0a500", bg: "#2d2200", border: "#f0a500" },
  { condition: "lost",    label: "遺失", color: "#f85149", bg: "#2d0f0f", border: "#f85149" },
];

function ReturnButtonGroup({ loanId, onSuccess }) {
  const { showToast } = useToast();
  return (
    <>
      {RETURN_CONDITIONS.map(({ condition, label, color, bg, border }) => (
        <button
          key={condition}
          onClick={async () => {
            if (condition !== "normal" && !window.confirm(`確定標記為「${label}」？此操作無法復原。`)) return;
            try {
              await api.post(`/api/fixtures/loans/${loanId}/return`, {
                return_condition: condition,
                returned_at: new Date().toISOString().slice(0, 10),
              });
              onSuccess();
            } catch (e) {
              showToast(e.response?.data?.detail || "歸還失敗", "error");
            }
          }}
          style={{
            marginRight: 4,
            padding: "3px 8px",
            borderRadius: 4,
            background: bg,
            color,
            border: `1px solid ${border}`,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {label}
        </button>
      ))}
    </>
  );
}

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
  const [invLogRefreshKey, setInvLogRefreshKey] = useState(0);
  const [deleteFixtureTarget, setDeleteFixtureTarget] = useState(null);
  const canOperate = role === "admin";
  const [sortKey, setSortKey] = useState("interface_type");
  const [sortDir, setSortDir] = useState("asc");
  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };
  const handleDeleteFixture = async () => {
    try {
      await api.delete(`/api/fixtures/${deleteFixtureTarget.id}`);
      setDeleteFixtureTarget(null);
      fetchAll();
    } catch (e) {
      showToast(e.response?.data?.detail || "刪除失敗", "error");
    }
  };

  const fetchAll = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const [fixtures, summary, loans, types, orders] = await Promise.all([
        settle(api.get("/api/fixtures/")),
        settle(api.get("/api/fixtures/summary")),
        settle(api.get("/api/fixtures/loans/active")),
        settle(api.get("/api/fixtures/interface-types")),
        settle(api.get("/api/purchase-orders/")),
      ]);
      if (fixtures) setFixtures(fixtures);
      if (summary) setSummary(summary);
      if (loans) setActiveLoans(loans);
      if (types) setInterfaceTypes(types);
      if (orders) setPurchaseOrders(orders);
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
        {canOperate && (
          <button
            style={tabStyle("inv_log")}
            onClick={() => setActiveTab("inv_log")}
          >
            盤點紀錄
          </button>
        )}
        <div style={{ flex: 1 }} />
        {canOperate && (
          <>
            <button
              onClick={() => downloadBlob("/api/fixtures/export", "fixtures_export.xlsx")}
              style={{ padding: "5px 12px", borderRadius: 6, background: "transparent", color: "#8b949e", border: "1px solid #30363d", cursor: "pointer", fontSize: 12 }}
            >
              匯出 Excel
            </button>
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
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, tableLayout: "fixed" }}>
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
                    <ResizableTh
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
                    </ResizableTh>
                  ))}
                  {canOperate && <ResizableTh style={thStyle}>操作</ResizableTh>}
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
                    const parsedVal = parseInt(editVal);
                    const isDiff = editVal !== undefined && editVal !== "" &&
                      !isNaN(parsedVal) && parsedVal !== f.total_quantity;
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
                              onClick={() => setDeleteFixtureTarget(f)}
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
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "#21262d" }}>
                <ResizableTh style={thStyle}>治具</ResizableTh>
                <ResizableTh style={thStyle}>借用人</ResizableTh>
                <ResizableTh style={thStyle}>綁定設備</ResizableTh>
                <ResizableTh style={thStyle}>專案</ResizableTh>
                <ResizableTh style={thStyle}>數量</ResizableTh>
                <ResizableTh style={thStyle}>借出日</ResizableTh>
                <ResizableTh style={thStyle}>到期日</ResizableTh>
                <ResizableTh style={thStyle}>狀態</ResizableTh>
                {canOperate && <ResizableTh style={{ ...thStyle, width: 210 }}>操作</ResizableTh>}
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
                          ? formatLocal(loan.loan_date, "date")
                          : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: isOverdue ? "#f85149" : "#8b949e",
                        }}
                      >
                        {loan.due_date
                          ? formatLocal(loan.due_date, "date")
                          : "—"}
                        {isOverdue && (
                          <span
                            style={{
                              marginLeft: 4,
                              fontSize: 10,
                              color: "#f85149",
                            }}
                          >
                            逾期 {loan.overdue_days > 0 ? `${loan.overdue_days} 天` : ""}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <Badge status="loaned" />
                      </td>
                      {canOperate && (
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                          <ReturnButtonGroup loanId={loan.id} onSuccess={fetchAll} />
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
          onRefresh={fetchAll}
        />
      )}

      {activeTab === "damaged" && <DamagedList />}

      {activeTab === "inv_log" && <InventoryLogTab refreshKey={invLogRefreshKey} />}

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
            setInvLogRefreshKey((k) => k + 1);
          }}
        />
      )}
      {deleteFixtureTarget && (
        <ConfirmModal
          title="刪除治具"
          message={`確定刪除「${deleteFixtureTarget.interface_type} — ${deleteFixtureTarget.form_factor}」？`}
          type="danger"
          confirmText="刪除"
          onConfirm={handleDeleteFixture}
          onCancel={() => setDeleteFixtureTarget(null)}
        />
      )}
    </div>
  );
}

function OverdueList({ canOperate, onRefresh }) {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api
      .get("/api/fixtures/loans/overdue")
      .then((r) => setLoans(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

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
                    ? formatLocal(loan.due_date, "date")
                    : "—"}
                </td>
                <td style={{ ...tdStyle, color: "#f85149", fontWeight: 700 }}>
                  {loan.overdue_days} 天
                </td>
                {canOperate && (
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <ReturnButtonGroup loanId={loan.id} onSuccess={() => { refresh(); onRefresh?.(); }} />
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
                      ? formatLocal(loan.return_date, "date")
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

// ── 盤點紀錄 tab ────────────────────────────────────────────
function BatchTable({ rows, setLogs, tdStyle, thStyle, allFixtures }) {
  const { showToast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [deleted, setDeleted] = useState(new Set());
  const [newRows, setNewRows] = useState([]);
  const [saving, setSaving] = useState(false);

  const enterEdit = () => {
    const init = {};
    rows.forEach((r) => { init[r.id] = String(r.counted_quantity); });
    setDrafts(init);
    setDeleted(new Set());
    setNewRows([]);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setDrafts({});
    setDeleted(new Set());
    setNewRows([]);
  };

  const addNewRow = () => {
    setNewRows((p) => [...p, { _key: Date.now(), fixture_id: "", qty: "0" }]);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      // 刪除
      await Promise.all([...deleted].map((id) => api.delete(`/api/fixtures/inventory-logs/${id}`)));
      // 修改
      const changed = rows.filter((r) => !deleted.has(r.id) && parseInt(drafts[r.id]) !== r.counted_quantity);
      await Promise.all(changed.map((r) => api.patch(`/api/fixtures/inventory-logs/${r.id}?actual_quantity=${parseInt(drafts[r.id])}`)));
      // 新增
      const addedRes = await Promise.all(
        newRows.filter((nr) => nr.fixture_id).map((nr) =>
          api.post(`/api/fixtures/inventory-logs?fixture_id=${nr.fixture_id}&actual_quantity=${parseInt(nr.qty) || 0}`)
        )
      );

      setLogs((prev) => {
        let updated = prev
          .filter((l) => !deleted.has(l.id))
          .map((l) => {
            if (drafts[l.id] !== undefined && parseInt(drafts[l.id]) !== l.counted_quantity) {
              const newQty = parseInt(drafts[l.id]);
              return { ...l, counted_quantity: newQty, difference: newQty - l.previous_quantity };
            }
            return l;
          });
        addedRes.forEach((r) => updated.push(r.data));
        return updated;
      });

      setEditMode(false);
      setDrafts({});
      setDeleted(new Set());
      setNewRows([]);
      showToast(`已更新`, "success");
    } catch {
      showToast("更新失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { width: 80, padding: "5px 8px", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117", color: "#cdd9e5", fontSize: 13, textAlign: "center" };
  const selectStyle = { padding: "5px 8px", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117", color: "#cdd9e5", fontSize: 13, width: "100%" };
  const delBtnStyle = { padding: "3px 8px", borderRadius: 4, border: "1px solid #da3633", background: "transparent", color: "#f85149", fontSize: 12, cursor: "pointer" };

  return (
    <div>
      <div style={{ padding: "8px 14px", display: "flex", justifyContent: "flex-end", gap: 8, borderBottom: "1px solid #21262d" }}>
        {editMode ? (
          <>
            <button onClick={addNewRow} style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid #238636", background: "transparent", color: "#3fb950", fontSize: 12, cursor: "pointer" }}>＋ 新增一筆</button>
            <button onClick={cancelEdit} disabled={saving} style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid #30363d", background: "transparent", color: "#8b949e", fontSize: 12, cursor: "pointer" }}>取消</button>
            <button onClick={handleSaveAll} disabled={saving} style={{ padding: "5px 14px", borderRadius: 5, border: "none", background: "#238636", color: "#fff", fontSize: 12, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>{saving ? "儲存中..." : "儲存"}</button>
          </>
        ) : (
          <button onClick={enterEdit} style={{ padding: "5px 14px", borderRadius: 5, border: "1px solid #30363d", background: "transparent", color: "#cdd9e5", fontSize: 12, cursor: "pointer" }}>編輯</button>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>治具</th>
              <th style={thStyle}>盤點前</th>
              <th style={thStyle}>盤點後</th>
              <th style={thStyle}>差異</th>
              <th style={thStyle}>盤點人</th>
              {editMode && <th style={thStyle}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => !deleted.has(r.id)).map((log) => {
              const draftVal = drafts[log.id];
              const diff = editMode ? (parseInt(draftVal || 0) - log.previous_quantity) : log.difference;
              return (
                <tr key={log.id}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1c2128")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={tdStyle}>{log.fixture_interface} {log.fixture_form_factor}</td>
                  <td style={tdStyle}>{log.previous_quantity}</td>
                  <td style={{ ...tdStyle, padding: "6px 12px" }}>
                    {editMode ? (
                      <input type="number" min="0" value={draftVal} onChange={(e) => setDrafts((p) => ({ ...p, [log.id]: e.target.value }))} style={inputStyle} />
                    ) : log.counted_quantity}
                  </td>
                  <td style={{ ...tdStyle, color: diff > 0 ? "#3fb950" : diff < 0 ? "#f85149" : "#8b949e", fontWeight: 600 }}>
                    {diff > 0 ? `+${diff}` : diff}
                  </td>
                  <td style={{ ...tdStyle, color: "#8b949e" }}>{log.counted_by || "-"}</td>
                  {editMode && <td style={tdStyle}><button style={delBtnStyle} onClick={() => setDeleted((p) => new Set([...p, log.id]))}>刪除</button></td>}
                </tr>
              );
            })}
            {editMode && newRows.map((nr, i) => (
              <tr key={nr._key} style={{ background: "#112318" }}>
                <td style={{ ...tdStyle, padding: "6px 12px" }}>
                  <select value={nr.fixture_id} onChange={(e) => setNewRows((p) => p.map((r, idx) => idx === i ? { ...r, fixture_id: e.target.value } : r))} style={selectStyle}>
                    <option value="">選擇治具...</option>
                    {allFixtures.map((f) => <option key={f.id} value={f.id}>{f.interface_type} / {f.form_factor}</option>)}
                  </select>
                </td>
                <td style={tdStyle}>—</td>
                <td style={{ ...tdStyle, padding: "6px 12px" }}>
                  <input type="number" min="0" value={nr.qty} onChange={(e) => setNewRows((p) => p.map((r, idx) => idx === i ? { ...r, qty: e.target.value } : r))} style={inputStyle} />
                </td>
                <td style={tdStyle}>—</td>
                <td style={tdStyle}>—</td>
                <td style={tdStyle}><button style={delBtnStyle} onClick={() => setNewRows((p) => p.filter((_, idx) => idx !== i))}>刪除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryLogTab({ refreshKey }) {
  const { showToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterFixture, setFilterFixture] = useState("");
  const [expandedBatch, setExpandedBatch] = useState(null);
  const [allFixtures, setAllFixtures] = useState([]);
  const [deletingBatch, setDeletingBatch] = useState(null);
  const [pendingBatch, setPendingBatch] = useState(null);

  const handleDeleteBatch = (e, key, batchRows) => {
    e.stopPropagation();
    setPendingBatch({ key, batchRows });
  };

  const performDeleteBatch = async () => {
    const { key, batchRows } = pendingBatch;
    setPendingBatch(null);
    setDeletingBatch(key);
    try {
      await Promise.all(batchRows.map((r) => api.delete(`/api/fixtures/inventory-logs/${r.id}`)));
      const deletedIds = new Set(batchRows.map((r) => r.id));
      setLogs((prev) => prev.filter((l) => !deletedIds.has(l.id)));
      showToast(`已刪除 ${batchRows.length} 筆紀錄`, "success");
    } catch {
      showToast("刪除失敗", "error");
    } finally {
      setDeletingBatch(null);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get("/api/fixtures/inventory-logs"),
      api.get("/api/fixtures/"),
    ]).then(([logsRes, fixturesRes]) => {
      setLogs(logsRes.data);
      if (logsRes.data.length > 0) setExpandedBatch(logsRes.data[0].counted_at?.slice(0, 16));
      setAllFixtures(fixturesRes.data);
    }).finally(() => setLoading(false));
  }, [refreshKey]);

  // 按分鐘分組
  const batches = logs.reduce((acc, log) => {
    const key = log.counted_at?.slice(0, 16) ?? "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});
  const batchKeys = Object.keys(batches).sort((a, b) => b.localeCompare(a));

  const thStyle = { padding: "8px 12px", fontSize: 11, color: "#8b949e", fontWeight: 600, textAlign: "left", borderBottom: "1px solid #21262d" };
  const tdStyle = { padding: "9px 12px", fontSize: 13, color: "#cdd9e5", borderBottom: "1px solid #21262d" };

  return (
    <div style={{ background: "#161b22", borderRadius: 8, overflow: "hidden", border: "1px solid #21262d" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #21262d", display: "flex", gap: 8, alignItems: "center" }}>
        <input
          placeholder="篩選治具..."
          value={filterFixture}
          onChange={(e) => setFilterFixture(e.target.value)}
          style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #30363d", background: "#0d1117", color: "#cdd9e5", fontSize: 12, width: 180 }}
        />
        <span style={{ fontSize: 12, color: "#484f58" }}>{batchKeys.length} 次盤點 · 共 {logs.length} 筆</span>
      </div>
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#484f58", fontSize: 13 }}>載入中...</div>
      ) : batchKeys.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#484f58", fontSize: 13 }}>目前無盤點紀錄</div>
      ) : batchKeys.map((key, i) => {
        const rows = batches[key].filter((l) =>
          !filterFixture ||
          l.fixture_interface.toLowerCase().includes(filterFixture.toLowerCase()) ||
          l.fixture_form_factor.toLowerCase().includes(filterFixture.toLowerCase())
        );
        if (rows.length === 0) return null;
        const allBatchRows = batches[key];
        const diffCount = rows.filter((l) => l.difference !== 0).length;
        const isOpen = expandedBatch === key;
        const isDeleting = deletingBatch === key;
        const batchTime = formatLocal(key, "datetime");
        return (
          <div key={key} style={{ borderBottom: "1px solid #21262d" }}>
            <div
              onClick={() => setExpandedBatch(isOpen ? null : key)}
              style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", background: isOpen ? "#1c2128" : "transparent", userSelect: "none" }}
            >
              <span style={{ fontSize: 12, color: "#adbac7", fontWeight: 600 }}>{i === 0 ? "最新　" : ""}{batchTime}</span>
              <span style={{ fontSize: 11, color: "#484f58" }}>{rows.length} 筆</span>
              {diffCount > 0 && <span style={{ fontSize: 11, color: "#f85149", fontWeight: 600 }}>差異 {diffCount} 筆</span>}
              <button
                onClick={(e) => handleDeleteBatch(e, key, allBatchRows)}
                disabled={isDeleting}
                style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, border: "1px solid #da3633", background: "transparent", color: isDeleting ? "#484f58" : "#f85149", fontSize: 11, cursor: isDeleting ? "not-allowed" : "pointer" }}
              >
                {isDeleting ? "刪除中..." : "刪除此批次"}
              </button>
              <span style={{ color: "#484f58", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && <BatchTable rows={rows} setLogs={setLogs} tdStyle={tdStyle} thStyle={thStyle} allFixtures={allFixtures} />}
          </div>
        );
      })}
      {pendingBatch && (
        <ConfirmModal
          title="刪除盤點紀錄"
          message={`確定要刪除此批次共 ${pendingBatch.batchRows.length} 筆盤點紀錄？此操作無法復原。`}
          type="danger"
          confirmText="刪除"
          onConfirm={performDeleteBatch}
          onCancel={() => setPendingBatch(null)}
        />
      )}
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
  const [deletePOTarget, setDeletePOTarget] = useState(null);

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

  const handleDelete = (order) => {
    setDeletePOTarget(order);
  };

  const performDelete = async () => {
    const order = deletePOTarget;
    setDeletePOTarget(null);
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
      {deletePOTarget && (
        <ConfirmModal
          title="刪除採購單"
          message="確認刪除此採購單？"
          type="danger"
          confirmText="刪除"
          onConfirm={performDelete}
          onCancel={() => setDeletePOTarget(null)}
        />
      )}
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


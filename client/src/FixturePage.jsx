import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import api from "./api";
import { downloadBlob } from "./utils/download";
import { formatLocal, parseUTC, parseDateOnlyLocal } from "./utils/timezone";
import { useToast } from "./components/useToast";
import ImportModal from "./components/fixture/ImportModal";
import LoanModal from "./components/fixture/LoanModal";

const settle = (p) => p.then((r) => r.data).catch((e) => { console.warn("[FixturePage] API fail:", e?.response?.status, e?.config?.url); return null; });
import SetKeeperModal from "./components/fixture/SetKeeperModal";
import ReturnModal from "./components/fixture/ReturnModal";
import AddEditModal from "./components/fixture/AddEditModal";
import StocktakeModal from "./components/fixture/StocktakeModal";
import CreatePurchaseModal from "./components/fixture/CreatePurchaseModal";
import ConfirmModal from "./components/ConfirmModal";
import { C } from "./styles/theme";
import { thStyle, tdStyle, btnPrimary, btnDanger } from "./styles/common";

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
  { condition: "normal",  label: "正常", color: C.success, bg: C.successBgMid, border: C.successDark },
  { condition: "damaged", label: "損壞", color: C.warning, bg: C.warningBg,    border: C.warning },
  { condition: "lost",    label: "遺失", color: C.error,   bg: C.errorBg,      border: C.error },
];

function ReturnButtonGroup({ loanId, onSuccess }) {
  const { showToast } = useToast();
  return (
    <>
      {RETURN_CONDITIONS.map(({ condition, label, color, bg, border }) => (
        <button
          key={condition}
          onClick={async () => {
            if (!window.confirm(`確定標記為「${label}」歸還？`)) return;
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
  ok:           { bg: C.successBgMid, color: C.success, label: "庫存足夠" },
  shortage:     { bg: C.warningBg,    color: C.warning, label: "即將不足" },
  out_of_stock: { bg: "#2d1a1a",      color: C.error,   label: "缺貨" },
  loaned:       { bg: "#1a1f2d",      color: C.accent,  label: "借出中" },
  reserved:     { bg: "#1a252d",      color: C.reserved, label: "預約中" },
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

export default function FixturePage({ active, role }) {
  const { showToast } = useToast();
  const [fixtures, setFixtures] = useState([]);
  const [activeLoans, setActiveLoans] = useState([]);
  const [search, setSearch] = useState("");
  const [filterInterface, setFilterInterface] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [interfaceTypes, setInterfaceTypes] = useState([]);
  const [activeTab, setActiveTab] = useState("inventory");
  const [expandedFixtureId, setExpandedFixtureId] = useState(null);
  const [recordsSubTab, setRecordsSubTab] = useState("damaged");
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
      const [fixtures, loans, types, orders] = await Promise.all([
        settle(api.get("/api/fixtures/")),
        settle(api.get("/api/fixtures/loans/active")),
        settle(api.get("/api/fixtures/interface-types")),
        settle(api.get("/api/purchase-orders/")),
      ]);
      if (fixtures) setFixtures(fixtures);
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
    background: activeTab === t ? C.surfaceHover : "transparent",
    color: activeTab === t ? C.textPrimary : C.textMuted,
    border: `1px solid ${activeTab === t ? C.border : "transparent"}`,
  });

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        backgroundColor: C.bg,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>治具管理</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>共 {fixtures.length} 種治具</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <button
          style={tabStyle("inventory")}
          onClick={() => setActiveTab("inventory")}
        >
          治具總表
        </button>
        {canOperate && (
          <button style={tabStyle("records")} onClick={() => setActiveTab("records")}>
            記錄
          </button>
        )}
        <div style={{ flex: 1 }} />
        {canOperate && (
          <>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value === "export") {
                  downloadBlob("/api/fixtures/export", "fixtures_export.xlsx");
                } else if (e.target.value === "import") {
                  setShowImportModal(true);
                }
                e.target.value = "";
              }}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                background: C.surface,
                color: C.textMuted,
                border: `1px solid ${C.border}`,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              <option value="" disabled>Excel 操作</option>
              <option value="export">匯出 Excel</option>
              <option value="import">匯入 Excel</option>
            </select>
            <button
              onClick={() => setEditTarget(false)}
              style={{ padding: "5px 12px", borderRadius: 6, background: "transparent", color: C.accent, border: `1px solid ${C.accent}44`, cursor: "pointer", fontSize: 12 }}
            >
              + 新增治具
            </button>
            <button
              onClick={() => setShowLoanModal(true)}
              style={btnPrimary}
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
                border: `1px solid ${C.border}`,
                background: C.surface,
                color: C.textPrimary,
                fontSize: 13,
              }}
            />
            {canOperate && (
              <button
                onClick={() => setShowStocktakeModal(true)}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  background: "#1a3828",
                  color: C.success,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                🔍 開始月盤點
              </button>
            )}
            <select
              value={filterInterface}
              onChange={(e) => setFilterInterface(e.target.value)}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                border: `1px solid ${C.border}`,
                background: C.surface,
                color: C.textPrimary,
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
                border: `1px solid ${C.border}`,
                background: C.surface,
                color: C.textPrimary,
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
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              overflowX: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, tableLayout: "fixed" }}>
              <thead>
                <tr style={{ background: C.surfaceHover }}>
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
                      colSpan={canOperate ? 14 : 13}
                      style={{ ...tdStyle, textAlign: "center", color: C.textMuted }}
                    >
                      載入中...
                    </td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canOperate ? 14 : 13}
                      style={{ ...tdStyle, textAlign: "center", color: C.textMuted }}
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
                    const isExpanded = expandedFixtureId === f.id;
                    const fixtureLoans = isExpanded ? activeLoans.filter((l) => l.fixture_id === f.id) : [];
                    return (
                    <Fragment key={f.id}>
                    <tr
                      style={{ transition: "background .1s" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = C.surface)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <td style={{ ...tdStyle, color: C.accent }}>
                        {f.interface_type}
                      </td>
                      <td style={tdStyle}>{f.form_factor}</td>
                      <td style={{ ...tdStyle, color: C.textMuted }}>
                        {f.size || "—"}
                      </td>
                      <td style={tdStyle}>{f.total_quantity}</td>
                      <td
                        style={{
                          ...tdStyle,
                          color: f.loaned_quantity > 0 ? C.warning : C.textMuted,
                          cursor: f.loaned_quantity > 0 ? "pointer" : "default",
                        }}
                        onClick={() => f.loaned_quantity > 0 && setExpandedFixtureId(isExpanded ? null : f.id)}
                      >
                        {f.loaned_quantity > 0 ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                            {f.loaned_quantity}
                            <span style={{ fontSize: 9, color: C.textDim }}>{isExpanded ? "▲" : "▼"}</span>
                          </span>
                        ) : f.loaned_quantity}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: f.reserved_quantity > 0 ? C.reserved : C.textMuted,
                        }}
                      >
                        {f.reserved_quantity}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: f.available_quantity > 0 ? C.success : C.error,
                          fontWeight: 600,
                        }}
                      >
                        {f.available_quantity}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color: f.shortage > 0 ? C.error : C.textMuted,
                        }}
                      >
                        {f.shortage || "—"}
                      </td>
                      <td style={tdStyle}>
                        <Badge status={getStatus(f)} />
                      </td>
                      <td style={{ ...tdStyle, color: C.textMuted }}>
                        {["", "每天", "週", "月", "季", "年"][
                          f.usage_frequency
                        ] || "—"}
                      </td>
                      <td style={tdStyle}>
                        {(() => {
                          if (!f.estimated_replacement_date) return <span style={{ color: C.textDim }}>—</span>;
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const due = parseDateOnlyLocal(f.estimated_replacement_date);
                          if (!due || Number.isNaN(due.getTime())) {
                            return <span style={{ color: C.textMuted }}>{f.estimated_replacement_date}</span>;
                          }
                          const daysLeft = Math.ceil((due - today) / 86400000);
                          const color = daysLeft < 0 ? C.error : daysLeft <= 30 ? C.warning : C.textMuted;
                          return <span style={{ color, fontWeight: daysLeft <= 30 ? 600 : 400 }}>{f.estimated_replacement_date}</span>;
                        })()}
                      </td>
                      <td style={{ ...tdStyle, color: f.keeper_name ? C.accent : C.textDim }}>
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
                                border: `1px solid ${isDiff ? C.error : C.border}`,
                                background: C.bg,
                                color: isDiff ? C.error : C.textPrimary,
                                fontSize: 12,
                              }}
                            />
                            {editVal !== undefined && editVal !== "" && (
                              <button
                                onClick={() => submitInventory(f.id)}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  border: `1px solid ${C.successDark}`,
                                  background: C.successDark,
                                  color: C.white,
                                  fontSize: 11,
                                  cursor: "pointer",
                                }}
                              >
                                確認
                              </button>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: C.textMuted }}>{f.total_quantity}</span>
                        )}
                      </td>
                      {canOperate && (
                        <td style={tdStyle}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <button
                              onClick={() => setEditTarget(f)}
                              style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.accent}44`, background: "transparent", color: C.accent, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => setKeeperTarget(f)}
                              style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                            >
                              保管人
                            </button>
                            {f.available_quantity === 0 && (
                              <button
                                onClick={() => { setPurchasePreFill(f); setShowPurchaseModal(true); }}
                                style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.warning}`, background: "transparent", color: C.warning, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                              >
                                採購
                              </button>
                            )}
                            <button
                              onClick={() => setDeleteFixtureTarget(f)}
                              style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.error}44`, background: "transparent", color: C.error, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                            >
                              刪除
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {isExpanded && fixtureLoans.length > 0 && (
                      <tr key={`${f.id}-loans`}>
                        <td colSpan={canOperate ? 14 : 13} style={{ padding: 0, background: C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ padding: "8px 16px 12px 32px" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead>
                                <tr>
                                  {["借用人","專案","數量","借出日","到期日"].map((h) => (
                                    <th key={h} style={{ ...thStyle, fontSize: 11 }}>{h}</th>
                                  ))}
                                  {canOperate && <th style={{ ...thStyle, fontSize: 11 }}>操作</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {(() => {
                                  const now = new Date();
                                  return fixtureLoans.map((loan) => {
                                  const dueDate = loan.due_date ? parseUTC(loan.due_date) : null;
                                  const isOverdue = Boolean(dueDate) && !Number.isNaN(dueDate.getTime()) && dueDate < now;
                                  const overdueDays = isOverdue ? Math.floor((now - dueDate) / 86400000) : 0;
                                  return (
                                    <tr key={loan.id}>
                                      <td style={{ ...tdStyle, fontSize: 12, color: isOverdue ? C.error : C.textPrimary, fontWeight: isOverdue ? 600 : 400 }}>{loan.borrower_name}</td>
                                      <td style={{ ...tdStyle, fontSize: 12, color: C.textMuted }}>{loan.project_name || "—"}</td>
                                      <td style={{ ...tdStyle, fontSize: 12 }}>{loan.quantity}</td>
                                      <td style={{ ...tdStyle, fontSize: 12, color: C.textMuted }}>{loan.loan_date ? formatLocal(loan.loan_date, "date") : "—"}</td>
                                      <td style={{ ...tdStyle, fontSize: 12, color: isOverdue ? C.error : C.textMuted }}>
                                        {loan.due_date ? formatLocal(loan.due_date, "date") : "—"}
                                        {isOverdue && <span style={{ marginLeft: 4, fontSize: 10 }}>逾期{overdueDays > 0 ? ` ${overdueDays}天` : ""}</span>}
                                      </td>
                                      {canOperate && <td style={{ ...tdStyle, fontSize: 12 }}><ReturnButtonGroup loanId={loan.id} onSuccess={fetchAll} /></td>}
                                    </tr>
                                  );
                                  });
                                })()}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === "records" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {[["damaged", "損壞／遺失"], ["inv_log", "盤點紀錄"]].map(([key, label]) => (
              <button key={key} onClick={() => setRecordsSubTab(key)} style={{ padding: "5px 14px", fontSize: 12, borderRadius: 6, cursor: "pointer", background: recordsSubTab === key ? C.surfaceHover : "transparent", color: recordsSubTab === key ? C.textPrimary : C.textMuted, border: `1px solid ${recordsSubTab === key ? C.border : "transparent"}` }}>
                {label}
              </button>
            ))}
          </div>
          {recordsSubTab === "damaged" && <DamagedList />}
          {recordsSubTab === "inv_log" && <InventoryLogTab refreshKey={invLogRefreshKey} allFixtures={fixtures} />}
          <div style={{ marginTop: 24, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 12, letterSpacing: "0.03em" }}>採購清單</div>
            <PurchaseTab
              orders={purchaseOrders}
              canOperate={canOperate}
              role={role}
              onRefresh={fetchAll}
              onNew={() => { setPurchasePreFill(null); setShowPurchaseModal(true); }}
            />
          </div>
        </div>
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


// ── 損壞／遺失 tab ───────────────────────────────────────────
const CONDITION_LABEL = {
  damaged: { label: "損壞", color: C.warning },
  lost: { label: "遺失", color: C.error },
};

function DamagedList() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/fixtures/loans/damaged")
      .then((r) => { if (!cancelled) setLoans(r.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.surfaceHover }}>
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
              <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: C.textMuted }}>
                載入中...
              </td>
            </tr>
          ) : loans.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: C.success }}>
                目前無損壞或遺失紀錄
              </td>
            </tr>
          ) : (
            loans.map((loan) => {
              const cond = CONDITION_LABEL[loan.status] || { label: loan.status, color: C.textMuted };
              return (
                <tr key={loan.id}>
                  <td style={tdStyle}>
                    {loan.fixture_interface} — {loan.fixture_form_factor}
                  </td>
                  <td style={tdStyle}>{loan.borrower_name}</td>
                  <td style={{ ...tdStyle, color: C.textMuted }}>{loan.device_id || "—"}</td>
                  <td style={{ ...tdStyle, color: C.textMuted }}>{loan.project_name || "—"}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{loan.quantity}</td>
                  <td style={{ ...tdStyle, color: C.textMuted }}>
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
                  <td style={{ ...tdStyle, color: C.textMuted, fontSize: 12 }}>
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
const batchInputStyle = { width: 80, padding: "5px 8px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.textPrimary, fontSize: 13, textAlign: "center" };
const batchSelectStyle = { padding: "5px 8px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.bg, color: C.textPrimary, fontSize: 13, width: "100%" };

function BatchTable({ rows, setLogs, allFixtures }) {
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

  return (
    <div>
      <div style={{ padding: "8px 14px", display: "flex", justifyContent: "flex-end", gap: 8, borderBottom: `1px solid ${C.surfaceHover}` }}>
        {editMode ? (
          <>
            <button onClick={addNewRow} style={{ padding: "5px 14px", borderRadius: 5, border: `1px solid ${C.successDark}`, background: "transparent", color: C.success, fontSize: 12, cursor: "pointer" }}>＋ 新增一筆</button>
            <button onClick={cancelEdit} disabled={saving} style={{ padding: "5px 14px", borderRadius: 5, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 12, cursor: "pointer" }}>取消</button>
            <button onClick={handleSaveAll} disabled={saving} style={{ padding: "5px 14px", borderRadius: 5, border: "none", background: C.successDark, color: C.white, fontSize: 12, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>{saving ? "儲存中..." : "儲存"}</button>
          </>
        ) : (
          <button onClick={enterEdit} style={{ padding: "5px 14px", borderRadius: 5, border: `1px solid ${C.border}`, background: "transparent", color: C.textPrimary, fontSize: 12, cursor: "pointer" }}>編輯</button>
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
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.surfaceAlt)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={tdStyle}>{log.fixture_interface} {log.fixture_form_factor}</td>
                  <td style={tdStyle}>{log.previous_quantity}</td>
                  <td style={{ ...tdStyle, padding: "6px 12px" }}>
                    {editMode ? (
                      <input type="number" min="0" value={draftVal} onChange={(e) => setDrafts((p) => ({ ...p, [log.id]: e.target.value }))} style={batchInputStyle} />
                    ) : log.counted_quantity}
                  </td>
                  <td style={{ ...tdStyle, color: diff > 0 ? C.success : diff < 0 ? C.error : C.textMuted, fontWeight: 600 }}>
                    {diff > 0 ? `+${diff}` : diff}
                  </td>
                  <td style={{ ...tdStyle, color: C.textMuted }}>{log.counted_by || "-"}</td>
                  {editMode && <td style={tdStyle}><button style={btnDanger} onClick={() => setDeleted((p) => new Set([...p, log.id]))}>刪除</button></td>}
                </tr>
              );
            })}
            {editMode && newRows.map((nr, i) => (
              <tr key={nr._key} style={{ background: C.successBg }}>
                <td style={{ ...tdStyle, padding: "6px 12px" }}>
                  <select value={nr.fixture_id} onChange={(e) => setNewRows((p) => p.map((r, idx) => idx === i ? { ...r, fixture_id: e.target.value } : r))} style={batchSelectStyle}>
                    <option value="">選擇治具...</option>
                    {allFixtures.map((f) => <option key={f.id} value={f.id}>{f.interface_type} / {f.form_factor}</option>)}
                  </select>
                </td>
                <td style={tdStyle}>—</td>
                <td style={{ ...tdStyle, padding: "6px 12px" }}>
                  <input type="number" min="0" value={nr.qty} onChange={(e) => setNewRows((p) => p.map((r, idx) => idx === i ? { ...r, qty: e.target.value } : r))} style={batchInputStyle} />
                </td>
                <td style={tdStyle}>—</td>
                <td style={tdStyle}>—</td>
                <td style={tdStyle}><button style={btnDanger} onClick={() => setNewRows((p) => p.filter((_, idx) => idx !== i))}>刪除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryLogTab({ refreshKey, allFixtures }) {
  const { showToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterFixture, setFilterFixture] = useState("");
  const [expandedBatch, setExpandedBatch] = useState(null);
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
    let cancelled = false;
    setLoading(true);
    api.get("/api/fixtures/inventory-logs").then((res) => {
      if (!cancelled) {
        setLogs(res.data);
        if (res.data.length > 0) setExpandedBatch(res.data[0].counted_at?.slice(0, 16));
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  // 按分鐘分組
  const batches = logs.reduce((acc, log) => {
    const key = log.counted_at?.slice(0, 16) ?? "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});
  const batchKeys = Object.keys(batches).sort((a, b) => b.localeCompare(a));

  return (
    <div style={{ background: C.surface, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.surfaceHover}` }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.surfaceHover}`, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          placeholder="篩選治具..."
          value={filterFixture}
          onChange={(e) => setFilterFixture(e.target.value)}
          style={{ padding: "5px 10px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.bg, color: C.textPrimary, fontSize: 12, width: 180 }}
        />
        <span style={{ fontSize: 12, color: C.textDim }}>{batchKeys.length} 次盤點 · 共 {logs.length} 筆</span>
      </div>
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: C.textDim, fontSize: 13 }}>載入中...</div>
      ) : batchKeys.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: C.textDim, fontSize: 13 }}>目前無盤點紀錄</div>
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
          <div key={key} style={{ borderBottom: `1px solid ${C.surfaceHover}` }}>
            <div
              onClick={() => setExpandedBatch(isOpen ? null : key)}
              style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", background: isOpen ? C.surfaceAlt : "transparent", userSelect: "none" }}
            >
              <span style={{ fontSize: 12, color: "#adbac7", fontWeight: 600 }}>{i === 0 ? "最新　" : ""}{batchTime}</span>
              <span style={{ fontSize: 11, color: C.textDim }}>{rows.length} 筆</span>
              {diffCount > 0 && <span style={{ fontSize: 11, color: C.error, fontWeight: 600 }}>差異 {diffCount} 筆</span>}
              <button
                onClick={(e) => handleDeleteBatch(e, key, allBatchRows)}
                disabled={isDeleting}
                style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, border: `1px solid ${C.errorDark}`, background: "transparent", color: isDeleting ? C.textDim : C.error, fontSize: 11, cursor: isDeleting ? "not-allowed" : "pointer" }}
              >
                {isDeleting ? "刪除中..." : "刪除此批次"}
              </button>
              <span style={{ color: C.textDim, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && <BatchTable rows={rows} setLogs={setLogs} allFixtures={allFixtures} />}
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
  pending:   { label: "待採購", color: C.warning,  bg: C.warningBg },
  arrived:   { label: "已到貨", color: C.success,  bg: C.successBgMid },
  cancelled: { label: "已取消", color: C.textMuted, bg: C.surfaceHover },
};

function PurchaseTab({ orders, canOperate, role, onRefresh, onNew }) {
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
              color: C.success,
              border: `1px solid ${C.successDark}`,
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
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.surfaceHover }}>
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
                  style={{ ...tdStyle, textAlign: "center", color: C.textMuted }}
                >
                  目前無採購紀錄
                </td>
              </tr>
            ) : (
              orders.map((o) => {
                const st = PO_STATUS[o.status] || PO_STATUS.pending;
                return (
                  <tr key={o.id}>
                    <td style={{ ...tdStyle, color: C.accent }}>{o.fixture_label}</td>
                    <td style={tdStyle}>{o.quantity}</td>
                    <td style={{ ...tdStyle, color: C.textMuted }}>{o.vendor || "—"}</td>
                    <td style={{ ...tdStyle, color: C.textMuted }}>
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
                    <td style={{ ...tdStyle, color: C.textMuted }}>
                      {o.created_at ? o.created_at.slice(0, 10) : "—"}
                    </td>
                    <td style={{ ...tdStyle, color: o.arrived_at ? C.success : C.textMuted }}>
                      {o.arrived_at ? o.arrived_at.slice(0, 10) : "—"}
                    </td>
                    <td style={{ ...tdStyle, color: C.textMuted, maxWidth: 160, wordBreak: "break-all" }}>
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
                                background: C.successBgMid,
                                color: C.success,
                                border: `1px solid ${C.successDark}`,
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
                                color: C.error,
                                border: `1px solid ${C.error}`,
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

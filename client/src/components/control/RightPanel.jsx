import { useState, useRef, useEffect } from "react";
import useAIChat from "../../ai/useAIChat";
import ChatArea from "../../ai/ChatArea";
import { exportChat } from "../../ai/aiStorage";

const QUESTION_POOL = [
  { label: "查庫存", text: "目前治具庫存不足的有哪些？" },
  { label: "借出狀況", text: "目前借出中的治具有哪些類型？" },
  { label: "Ethernet 庫存", text: "Ethernet 相關治具庫存如何？" },
  { label: "問法規", text: "IEC 60068 有哪些常用測試條件？" },
  { label: "濕熱測試", text: "IEC 60068-2-78 濕熱測試條件是什麼？" },
  { label: "溫度循環", text: "IEC 60068-2-14 有哪些溫度循環條件？" },
  { label: "鐵道標準", text: "EN 50155 鐵道設備有哪些常用測試條件？" },
  { label: "海事標準", text: "IEC 60945 海事設備測試條件是什麼？" },
  { label: "變電站標準", text: "IEC 61850-3 變電站設備測試要求是什麼？" },
  { label: "問測試時長", text: "IEC 60068-2-14 Na 測試需要多久？" },
  { label: "EN 50155 時長", text: "EN 50155 高溫通電測試需要多久？" },
  { label: "比較法規", text: "EN 50155 和 IEC 60068 的濕熱循環有什麼差異？" },
  { label: "IEC vs DNV", text: "IEC 60068 和 DNV 的乾熱測試有什麼差異？" },
  { label: "推薦標準", text: "工業乙太網設備要選哪個測試標準？" },
  { label: "低溫測試", text: "低溫開關機測試條件有哪些？" },
  { label: "高溫高濕", text: "高溫高濕測試條件有哪些選擇？" },
];

function pickRandom(n, pool, exclude = []) {
  const available = pool.filter((q) => !exclude.includes(q.label));
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export default function RightPanel({ onClose, onApplySchedule }) {
  const {
    activeId,
    conversations,
    projectGroups,
    messages,
    input,
    loading,
    streamText,
    bottomRef,
    chatAreaRef,
    inputRef,
    textareaRef,
    sendMessage,
    stopStream,
    retryInTraditional,
    handleInputChange,
    handleKeyDown,
    switchConversation,
    addConversation,
    deleteConversation,
    clearConversation,
    renameConversation,
    setConversationGroup,
    addProjectGroup,
  } = useAIChat();

  const [quickQuestions, setQuickQuestions] = useState(() =>
    pickRandom(4, QUESTION_POOL)
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [newGroupInput, setNewGroupInput] = useState("");
  const menuRef = useRef(null);
  const renameRef = useRef(null);

  const convIds = Object.keys(conversations).sort(
    (a, b) =>
      new Date(conversations[b]?.updatedAt || 0) -
      new Date(conversations[a]?.updatedAt || 0)
  );
  const total = convIds.length;
  const currentIdx = convIds.indexOf(activeId);
  const activeConv = conversations[activeId];
  const activeTitle = activeConv?.title || "新對話";
  const currentGroup = activeConv?.projectGroup || "未分組";

  const goPrev = () => {
    if (loading || total <= 1) return;
    if (input.trim() && !window.confirm("⚠️ 您有未發送的內容，確定要切換對話嗎？")) return;
    switchConversation(convIds[(currentIdx - 1 + total) % total]);
  };
  const goNext = () => {
    if (loading || total <= 1) return;
    if (input.trim() && !window.confirm("⚠️ 您有未發送的內容，確定要切換對話嗎？")) return;
    switchConversation(convIds[(currentIdx + 1) % total]);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const startRename = () => {
    setRenameValue(activeTitle === "新對話" ? "" : activeTitle);
    setRenaming(true);
    setMenuOpen(false);
    setTimeout(() => renameRef.current?.focus(), 50);
  };

  const commitRename = () => {
    const v = renameValue.trim();
    if (v) renameConversation(activeId, v);
    setRenaming(false);
  };

  const handleDelete = () => {
    if (window.confirm(`確定刪除「${activeTitle}」？`)) {
      deleteConversation(activeId);
    }
    setMenuOpen(false);
  };

  const handleGroupChange = (group) => {
    setConversationGroup(activeId, group);
    setMenuOpen(false);
  };

  const handleAddGroup = () => {
    const g = newGroupInput.trim();
    if (!g) return;
    addProjectGroup(g);
    setConversationGroup(activeId, g);
    setNewGroupInput("");
    setMenuOpen(false);
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        borderLeft: "1px solid #30363d",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid #21262d",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 5,
          minHeight: 36,
          position: "relative",
        }}
      >
        {/* 對話切換（有多個才顯示） */}
        {total > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <button onClick={goPrev} disabled={loading} style={navBtnS(loading)}>‹</button>
            <span style={{ fontSize: 11, color: "#484f58", minWidth: 28, textAlign: "center" }}>
              {currentIdx + 1}/{total}
            </span>
            <button onClick={goNext} disabled={loading} style={navBtnS(loading)}>›</button>
          </div>
        )}

        {/* 對話名稱 — 雙擊重命名 */}
        <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
          {renaming ? (
            <input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              style={{
                width: "100%",
                fontSize: 12,
                background: "#21262d",
                border: "1px solid #58a6ff",
                borderRadius: 3,
                color: "#cdd9e5",
                padding: "2px 8px",
                outline: "none",
              }}
              placeholder="對話名稱"
            />
          ) : (
            <span
              onDoubleClick={startRename}
              title="雙擊重新命名"
              style={{
                fontSize: 12,
                color: "#8b949e",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "default",
                display: "block",
                userSelect: "none",
              }}
            >
              {activeTitle}
            </span>
          )}
        </div>

        {/* ↓ 匯出 */}
        <button
          onClick={() => exportChat(messages, activeTitle)}
          disabled={messages.length === 0}
          title="匯出對話紀錄"
          style={iconBtnS(messages.length === 0)}
        >
          ↓
        </button>

        {/* ··· 分組 / 清除 / 刪除 */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen((v) => !v)} title="更多" style={iconBtnS(false)}>
            ···
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                width: 168,
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 6,
                boxShadow: "0 8px 24px rgba(0,0,0,.4)",
                zIndex: 999,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "6px 12px 4px", fontSize: 10, color: "#484f58", letterSpacing: 0.5 }}>
                分組
              </div>
              {projectGroups.map((g) => (
                <MenuItem key={g} onClick={() => handleGroupChange(g)} active={g === currentGroup}>
                  {g === currentGroup ? "● " : "○ "}{g}
                </MenuItem>
              ))}
              <div style={{ padding: "4px 8px", display: "flex", gap: 4, borderTop: "1px solid #21262d" }}>
                <input
                  value={newGroupInput}
                  onChange={(e) => setNewGroupInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddGroup()}
                  placeholder="新分組名稱"
                  style={{
                    flex: 1, fontSize: 10, background: "#0d1117",
                    border: "1px solid #30363d", borderRadius: 3,
                    color: "#cdd9e5", padding: "2px 6px", outline: "none",
                  }}
                />
                <button
                  onClick={handleAddGroup}
                  style={{
                    fontSize: 10, background: "transparent", border: "1px solid #30363d",
                    borderRadius: 3, color: "#8b949e", padding: "2px 6px", cursor: "pointer",
                  }}
                >+</button>
              </div>
              <div style={{ borderTop: "1px solid #21262d" }} />
              <MenuItem
                onClick={() => { clearConversation(); setMenuOpen(false); }}
                disabled={messages.length === 0}
              >
                ✕ 清除內容
              </MenuItem>
              <MenuItem onClick={handleDelete} danger>🗑 刪除對話</MenuItem>
            </div>
          )}
        </div>

        {/* + 新增對話 */}
        <button onClick={() => addConversation()} disabled={loading} title="新增對話" style={iconBtnS(loading)}>
          +
        </button>

        {/* ✕ 關閉 */}
        {onClose && (
          <button onClick={onClose} title="關閉" style={iconBtnS(false)}>✕</button>
        )}
      </div>

      {/* 快速問題 — flex-wrap chips 顯示完整問題文字 */}
      <div
        style={{
          padding: "6px 10px",
          display: "flex",
          flexWrap: "wrap",
          gap: 5,
          flexShrink: 0,
          borderBottom: "1px solid #21262d",
        }}
      >
        {quickQuestions.map((q) => (
          <button
            key={q.label}
            onClick={() => {
              sendMessage(q.text);
              setQuickQuestions(pickRandom(4, QUESTION_POOL, quickQuestions.map((x) => x.label)));
            }}
            disabled={loading}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 12,
              border: "1px solid #30363d",
              background: "transparent",
              color: loading ? "#484f58" : "#8b949e",
              cursor: loading ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              transition: "border-color .15s, color .15s",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.borderColor = "#58a6ff";
                e.currentTarget.style.color = "#58a6ff";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#30363d";
              e.currentTarget.style.color = loading ? "#484f58" : "#8b949e";
            }}
          >
            {q.text}
          </button>
        ))}
      </div>

      {/* 對話區 */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ChatArea
          messages={messages}
          loading={loading}
          streamText={streamText}
          input={input}
          chatAreaRef={chatAreaRef}
          bottomRef={bottomRef}
          inputRef={inputRef}
          textareaRef={textareaRef}
          onSend={sendMessage}
          onStop={stopStream}
          onRetry={retryInTraditional}
          onInputChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onApplySchedule={onApplySchedule}
          compact
        />
      </div>
    </div>
  );
}

// ── 小元件 ────────────────────────────────────────────────────

function MenuItem({ children, onClick, disabled, danger, active }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "7px 12px",
        fontSize: 11,
        cursor: disabled ? "default" : "pointer",
        color: disabled
          ? "#484f58"
          : danger
            ? hover ? "#ff7b72" : "#f85149"
            : active
              ? "#58a6ff"
              : hover ? "#cdd9e5" : "#8b949e",
        background: hover && !disabled ? "#21262d" : "transparent",
        transition: "color .1s, background .1s",
        userSelect: "none",
      }}
    >
      {children}
    </div>
  );
}

const navBtnS = (disabled) => ({
  background: "transparent",
  border: "none",
  color: disabled ? "#30363d" : "#484f58",
  cursor: disabled ? "default" : "pointer",
  fontSize: 16,
  fontWeight: 600,
  lineHeight: 1,
  padding: "2px 4px",
  flexShrink: 0,
});

const iconBtnS = (disabled) => ({
  background: "transparent",
  border: "1px solid #30363d",
  color: disabled ? "#30363d" : "#8b949e",
  cursor: disabled ? "default" : "pointer",
  fontSize: 13,
  padding: "3px 9px",
  borderRadius: 4,
  flexShrink: 0,
  minWidth: 28,
  lineHeight: 1,
});

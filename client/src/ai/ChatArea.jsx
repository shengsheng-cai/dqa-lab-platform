// client/src/ai/ChatArea.jsx
import MessageBubble, { DISCLAIMER, renderMarkdown } from "./MessageBubble";

const DEFAULT_QUESTIONS = [
  "我有鐵路車載電子設備，需要哪些環境測試？",
  "IEC 60068 和 EN 50155 有什麼差別？",
  "我的產品要在戶外使用，適合哪個法規？",
  "DNV 認證需要哪些溫度測試條件？",
  "什麼情況下需要做濕熱循環測試？",
];

export default function ChatArea({
  messages,
  loading,
  streamText,
  suggestions,
  suggestLoading,
  input,
  chatAreaRef,
  bottomRef,
  inputRef,
  textareaRef,
  onSend,
  onStop,
  onRetry,
  onInputChange,
  onKeyDown,
}) {
  // fix: 避免建議列閃爍——loading 中若有上一輪建議繼續顯示，直到 suggestLoading 接管
  const showSuggestRow = !loading || suggestLoading;
  const currentQuestions = suggestions ?? DEFAULT_QUESTIONS;
  const isDynamic = suggestions !== null;

  return (
    <div style={S.main}>
      {/* ── 訊息區 ── */}
      <div ref={chatAreaRef} style={S.chatArea}>
        {messages.length === 0 && !loading && (
          <div style={S.emptyHint}>
            <div style={S.emptyIcon}>🔬</div>
            <div style={S.emptyTitle}>DQA Lab 法規諮詢助手</div>
            <div style={S.emptyDesc}>
              描述你的產品或測試需求，AI 將從 5 大法規、78
              個測試條件中推薦最適合的方案。
            </div>
            <div style={S.emptyDisclaimer}>{DISCLAIMER}</div>
          </div>
        )}

        {/* fix: 用 createdAt+index 組合 key，避免 index 作 key 的 diff 錯誤 */}
        {messages.map((m, i) => (
          <MessageBubble
            key={`${m.role}-${i}-${m.content.slice(0, 8)}`}
            m={m}
            onRetry={() => onRetry(i)}
          />
        ))}

        {loading && streamText && (
          <div style={S.aiWrap}>
            <div style={{ ...S.aiBubble, borderColor: "#58a6ff" }}>
              {renderMarkdown(streamText)}
              <span style={S.cursor}>▍</span>
            </div>
          </div>
        )}

        {loading && !streamText && (
          <div style={S.aiWrap}>
            <div style={S.aiBubble}>
              <div style={S.typingWrap}>
                <span style={{ ...S.dot, animationDelay: "0ms" }} />
                <span style={{ ...S.dot, animationDelay: "200ms" }} />
                <span style={{ ...S.dot, animationDelay: "400ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── 追問建議列：loading 結束後才顯示，避免閃爍 ── */}
      {showSuggestRow && (
        <div style={S.suggestRow}>
          {suggestLoading ? (
            <div style={S.suggestLoadingWrap}>
              <span style={{ ...S.dot, animationDelay: "0ms" }} />
              <span style={{ ...S.dot, animationDelay: "200ms" }} />
              <span style={{ ...S.dot, animationDelay: "400ms" }} />
              <span style={S.suggestLoadingText}>產生建議中...</span>
            </div>
          ) : (
            currentQuestions.map((q, i) => (
              <button
                key={i}
                style={{
                  ...S.chip,
                  borderLeft: isDynamic ? "2px solid #58a6ff55" : "none",
                }}
                onClick={() => onSend(q)}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#21262d")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#161b22")
                }
              >
                {isDynamic ? "💡 " : "⚡ "}
                {q}
              </button>
            ))
          )}
        </div>
      )}

      {/* ── 輸入區 ── */}
      <div style={S.inputArea}>
        <textarea
          ref={(el) => {
            inputRef.current = el;
            textareaRef.current = el;
          }}
          style={S.textarea}
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          placeholder="描述你的產品與測試需求，按 Enter 送出（Shift+Enter 換行）..."
          rows={3}
          disabled={loading}
        />
        {loading ? (
          <button
            style={S.stopBtn}
            onClick={onStop}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#3d1c1c")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            ⏹ 停止
          </button>
        ) : (
          <button
            style={{
              ...S.sendBtn,
              opacity: !input.trim() ? 0.4 : 1,
              cursor: !input.trim() ? "not-allowed" : "pointer",
            }}
            onClick={() => onSend()}
            disabled={!input.trim()}
          >
            送出
          </button>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes dotBounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-6px);opacity:1} }
      `}</style>
    </div>
  );
}

const S = {
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  chatArea: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  emptyHint: {
    margin: "auto",
    textAlign: "center",
    maxWidth: 480,
    padding: 40,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#cdd9e5",
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: "#8b949e",
    lineHeight: 1.7,
    marginBottom: 12,
  },
  emptyDisclaimer: {
    fontSize: 11,
    color: "#6e7681",
    lineHeight: 1.6,
    border: "1px solid #21262d",
    borderRadius: 6,
    padding: "8px 12px",
    textAlign: "left",
  },
  aiWrap: { display: "flex", justifyContent: "flex-start" },
  aiBubble: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: "16px 16px 16px 4px",
    padding: "12px 18px",
    fontSize: 14,
    lineHeight: 1.7,
    maxWidth: "82%",
    transition: "border-color .3s",
  },
  cursor: {
    display: "inline-block",
    color: "#58a6ff",
    animation: "blink 1s infinite",
    marginLeft: 2,
  },
  typingWrap: {
    display: "flex",
    gap: 5,
    padding: "4px 2px",
    alignItems: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#58a6ff",
    display: "inline-block",
    animation: "dotBounce 1.2s infinite",
  },
  suggestRow: {
    display: "flex",
    gap: 6,
    padding: "8px 32px",
    overflowX: "auto",
    flexWrap: "wrap",
    borderTop: "1px solid #21262d",
  },
  suggestLoadingWrap: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 0",
  },
  suggestLoadingText: { fontSize: 11, color: "#8b949e", marginLeft: 4 },
  chip: {
    background: "#161b22",
    border: "1px solid #30363d",
    color: "#8b949e",
    fontSize: 12,
    padding: "5px 10px",
    borderRadius: 14,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background .15s",
    flexShrink: 0,
  },
  inputArea: {
    borderTop: "1px solid #30363d",
    padding: "16px 24px",
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    backgroundColor: "#161b22",
  },
  textarea: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 8,
    color: "#cdd9e5",
    fontSize: 14,
    padding: "10px 14px",
    resize: "none",
    outline: "none",
    fontFamily: "inherit",
    lineHeight: 1.6,
    overflow: "hidden",
    minHeight: 66,
    transition: "height .1s ease",
  },
  sendBtn: {
    background: "#238636",
    border: "none",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    padding: "10px 20px",
    borderRadius: 8,
    whiteSpace: "nowrap",
    transition: "opacity .15s",
    height: 42,
  },
  stopBtn: {
    background: "transparent",
    border: "1px solid #f85149",
    color: "#f85149",
    fontWeight: 600,
    fontSize: 14,
    padding: "10px 20px",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all .15s",
    height: 42,
  },
};

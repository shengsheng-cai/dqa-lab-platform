// 對話區域（包含對話列表、輸入框及控制按鈕）

import { useState, useEffect, useRef } from "react";
import MessageBubble, { DISCLAIMER, renderMarkdown } from "./MessageBubble";

function StreamingBubble({ streamText }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div style={{ ...S.aiBubble, borderColor: "#58a6ff" }}>
        {renderMarkdown(streamText)}
        <span style={S.cursor}>▍</span>
        <span style={S.streamElapsed}>⏱ {elapsed}s</span>
      </div>
    </div>
  );
}

export default function ChatArea({
  messages,
  loading,
  streamText,
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
  compact = false,
}) {
  return (
    <div style={S.main}>
      <div ref={chatAreaRef} style={{ ...S.chatArea, ...(compact ? S.chatAreaCompact : {}) }}>
        {messages.length === 0 && !loading && (
          <div style={S.emptyHint}>
            <div style={S.emptyIcon}>🔬</div>
            <div style={S.emptyTitle}>DQA Lab 法規諮詢助手</div>
            <div style={S.emptyDesc}>
              描述你的產品或測試需求，AI 將從 5 大法規、78
              個測試條件中推薦最適合的方案。
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {[
                "工業乙太網設備要選哪個測試標準？",
                "IEC 60068-2-14 有哪些溫度循環條件？",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => onSend(q)}
                  style={{
                    background: "#0d1117",
                    border: "1px solid #30363d",
                    borderRadius: 8,
                    color: "#8b949e",
                    fontSize: 13,
                    padding: "10px 14px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "border-color .15s, color .15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#58a6ff";
                    e.currentTarget.style.color = "#cdd9e5";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#30363d";
                    e.currentTarget.style.color = "#8b949e";
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
            <div style={S.emptyDisclaimer}>{DISCLAIMER}</div>
          </div>
        )}

        {messages.map((m, i) => {
          const isFirstAssistant =
            m.role === "assistant" &&
            messages.slice(0, i).every((msg) => msg.role !== "assistant");
          return (
            <MessageBubble
              key={`${m.role}-${i}-${m.content.slice(0, 8)}`}
              m={m}
              onRetry={() => onRetry(i)}
              isFirstAssistant={isFirstAssistant}
            />
          );
        })}

        {loading && streamText && <StreamingBubble streamText={streamText} />}

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
          placeholder="描述你的測試需求，Enter 送出，Shift+Enter 換行..."
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
            onClick={() => {
              onSend();
              if (textareaRef.current)
                textareaRef.current.style.height = "auto";
            }}
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
  streamElapsed: {
    display: "block",
    fontSize: 11,
    color: "#8b949e",
    marginTop: 6,
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
  chatAreaCompact: {
    padding: "12px 14px",
    gap: 10,
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
    cursor: "pointer",
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

import { useState, useRef, useEffect } from "react";

const API_BASE = "http://localhost:8000";

// ── Markdown 簡易渲染器 ──────────────────────────────────────
function renderMarkdown(text) {
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} style={styles.h3}>
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} style={styles.h2}>
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} style={styles.h1}>
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={styles.listItem}>
          <span style={styles.bullet}>▸</span>
          <span>{inlineMarkdown(line.slice(2))}</span>
        </div>,
      );
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      elements.push(
        <div key={i} style={styles.listItem}>
          <span style={styles.numBullet}>{match[1]}.</span>
          <span>{inlineMarkdown(match[2])}</span>
        </div>,
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      elements.push(
        <p key={i} style={styles.p}>
          {inlineMarkdown(line)}
        </p>,
      );
    }
    i++;
  }
  return elements;
}

function inlineMarkdown(text) {
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let last = 0;
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2])
      parts.push(
        <strong key={idx++} style={{ color: "#cdd9e5" }}>
          {match[2]}
        </strong>,
      );
    else if (match[3])
      parts.push(
        <code key={idx++} style={styles.inlineCode}>
          {match[3]}
        </code>,
      );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── 快速提問 ─────────────────────────────────────────────────
const QUICK_QUESTIONS = [
  "我有鐵路車載電子設備，需要哪些環境測試？",
  "IEC 60068 和 EN 50155 有什麼差別？",
  "我的產品要在戶外使用，適合哪個法規？",
  "DNV 認證需要哪些溫度測試條件？",
  "什麼情況下需要做濕熱循環測試？",
  "KEMA KEUR 適用於什麼類型的設備？",
];

// ── 主元件 ───────────────────────────────────────────────────
export default function AIPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const sendMessage = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");

    const newMessages = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    setLoading(true);
    setStreamText("");

    const history = newMessages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch(`${API_BASE}/api/ai/standards-query-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history }),
      });

      if (!res.ok) throw new Error("串流請求失敗");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamText(fullText);
      }

      // 串流完成，加入訊息列表
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: fullText },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ 連線失敗，請確認後端與 Ollama 是否正常運行。",
        },
      ]);
    } finally {
      setLoading(false);
      setStreamText("");
      inputRef.current?.focus();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={styles.page}>
      {/* 左側欄：快速提問 */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTitle}>⚡ 快速提問</div>
        {QUICK_QUESTIONS.map((q, i) => (
          <button
            key={i}
            style={styles.quickBtn}
            onClick={() => sendMessage(q)}
            disabled={loading}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#21262d")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            {q}
          </button>
        ))}
        <div style={{ marginTop: "auto", paddingTop: 16 }}>
          <button
            style={styles.clearBtn}
            onClick={clearChat}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#3d1c1c")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            🗑 清除對話
          </button>
        </div>
        <div style={styles.modelBadge}>
          <span style={{ color: "#3fb950" }}>●</span> qwen2.5:7b（本機）
        </div>
      </aside>

      {/* 右側主區：對話 */}
      <div style={styles.main}>
        <div style={styles.chatArea}>
          {messages.length === 0 && !loading && (
            <div style={styles.emptyHint}>
              <div style={styles.emptyIcon}>🔬</div>
              <div style={styles.emptyTitle}>DQA Lab 法規諮詢助手</div>
              <div style={styles.emptyDesc}>
                描述你的產品或測試需求，AI 將從 6 大法規、64
                個測試條件中推薦最適合的方案。
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              style={
                m.role === "user" ? styles.userBubbleWrap : styles.aiBubbleWrap
              }
            >
              <div
                style={m.role === "user" ? styles.userBubble : styles.aiBubble}
              >
                {m.role === "assistant" ? (
                  renderMarkdown(m.content)
                ) : (
                  <p style={{ margin: 0 }}>{m.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* 串流中即時顯示 */}
          {loading && streamText && (
            <div style={styles.aiBubbleWrap}>
              <div style={{ ...styles.aiBubble, borderColor: "#58a6ff" }}>
                {renderMarkdown(streamText)}
                <span style={styles.cursor}>▍</span>
              </div>
            </div>
          )}

          {/* 等待開始串流時顯示點點 */}
          {loading && !streamText && (
            <div style={styles.aiBubbleWrap}>
              <div style={styles.aiBubble}>
                <div style={styles.typingWrap}>
                  <span style={{ ...styles.dot, animationDelay: "0ms" }} />
                  <span style={{ ...styles.dot, animationDelay: "200ms" }} />
                  <span style={{ ...styles.dot, animationDelay: "400ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* 輸入區 */}
        <div style={styles.inputArea}>
          <textarea
            ref={inputRef}
            style={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你的產品與測試需求，按 Enter 送出（Shift+Enter 換行）..."
            rows={3}
            disabled={loading}
          />
          <button
            style={{
              ...styles.sendBtn,
              opacity: loading || !input.trim() ? 0.4 : 1,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            }}
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
          >
            {loading ? "思考中..." : "送出"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes dotBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── 樣式 ─────────────────────────────────────────────────────
const styles = {
  page: {
    display: "flex",
    height: "100%",
    backgroundColor: "#0d1117",
    color: "#cdd9e5",
    fontFamily: "'Noto Sans TC', sans-serif",
    overflow: "hidden",
  },
  sidebar: {
    width: 240,
    minWidth: 240,
    backgroundColor: "#161b22",
    borderRight: "1px solid #30363d",
    padding: "20px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflowY: "auto",
  },
  sidebarTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#8b949e",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 8,
    paddingLeft: 8,
  },
  quickBtn: {
    background: "transparent",
    border: "none",
    color: "#8b949e",
    fontSize: 12,
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: 6,
    cursor: "pointer",
    lineHeight: 1.5,
    transition: "all .15s",
    width: "100%",
  },
  clearBtn: {
    background: "transparent",
    border: "1px solid #3d1c1c",
    color: "#f85149",
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    width: "100%",
    transition: "all .15s",
  },
  modelBadge: {
    fontSize: 11,
    color: "#8b949e",
    marginTop: 12,
    paddingLeft: 8,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  chatArea: {
    flex: 1,
    overflowY: "auto",
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
  emptyDesc: { fontSize: 14, color: "#8b949e", lineHeight: 1.7 },
  userBubbleWrap: { display: "flex", justifyContent: "flex-end" },
  aiBubbleWrap: { display: "flex", justifyContent: "flex-start" },
  userBubble: {
    background: "#1f6feb",
    color: "#fff",
    borderRadius: "16px 16px 4px 16px",
    padding: "10px 16px",
    maxWidth: "70%",
    fontSize: 14,
    lineHeight: 1.6,
  },
  aiBubble: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: "16px 16px 16px 4px",
    padding: "12px 18px",
    maxWidth: "80%",
    fontSize: 14,
    lineHeight: 1.7,
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
  },
  sendBtn: {
    background: "#238636",
    border: "none",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    padding: "10px 20px",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "opacity .15s",
    height: 42,
  },
  h1: { fontSize: 18, fontWeight: 700, color: "#cdd9e5", margin: "8px 0 4px" },
  h2: { fontSize: 16, fontWeight: 700, color: "#cdd9e5", margin: "8px 0 4px" },
  h3: { fontSize: 14, fontWeight: 700, color: "#58a6ff", margin: "8px 0 4px" },
  p: { margin: "2px 0", color: "#cdd9e5" },
  listItem: {
    display: "flex",
    gap: 8,
    margin: "3px 0",
    alignItems: "flex-start",
  },
  bullet: { color: "#58a6ff", flexShrink: 0, marginTop: 1 },
  numBullet: { color: "#58a6ff", flexShrink: 0, minWidth: 20 },
  inlineCode: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "1px 5px",
    fontSize: 12,
    fontFamily: "monospace",
    color: "#ff7b72",
  },
};

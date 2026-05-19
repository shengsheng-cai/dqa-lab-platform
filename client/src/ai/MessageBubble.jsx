// client/src/ai/MessageBubble.jsx
import { useState, useRef, useEffect } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import { cleanText } from "./markdownUtils";
import { DISCLAIMER } from "./messageBubbleConstants";

const COLLAPSE_HEIGHT = 300;

const SIMPLIFIED_ONLY = new Set([
  "设",
  "备",
  "测",
  "标",
  "规",
  "环",
  "电",
  "压",
  "频",
  "认",
  "证",
  "报",
  "执",
  "记",
  "录",
  "处",
  "护",
  "码",
  "给",
  "网",
  "说",
  "术",
  "实",
  "现",
  "际",
  "样",
  "产",
  "从",
  "传",
  "输",
  "应",
  "关",
  "联",
  "线",
  "总",
  "则",
  "达",
  "够",
  "强",
  "调",
  "节",
  "运",
  "营",
  "图",
  "书",
  "热",
  "气",
  "风",
  "车",
  "载",
]);

const hasSimplified = (text) =>
  [...text].some((c) => SIMPLIFIED_ONLY.has(c));


// ── 可折疊泡泡 ───────────────────────────────────────────────
function CollapsibleBubble({ children, contentKey }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const innerRef = useRef(null);

  useEffect(() => {
    if (innerRef.current)
      setOverflow(innerRef.current.scrollHeight > COLLAPSE_HEIGHT);
  }, [contentKey]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={innerRef}
        style={{
          maxHeight: !expanded ? COLLAPSE_HEIGHT : undefined,
          overflow: "hidden",
          transition: "max-height .3s ease",
        }}
      >
        {children}
      </div>
      {overflow && (
        <div style={expanded ? S.collapseBarExpanded : S.collapseBar}>
          <button style={S.collapseBtn} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收合 ▲" : "顯示更多 ▼"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 單則訊息 ─────────────────────────────────────────────────
export default function MessageBubble({
  m,
  onRetry,
  onApplySchedule,
  canApplySchedule = true,
}) {
  const [copied, setCopied] = useState(false);
  const simplified = m.role === "assistant" && hasSimplified(m.content);

  const handleCopy = () => {
    const text = cleanText(m.content);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* 靜默處理 */
      }
      document.body.removeChild(el);
    }
  };

  return (
    <div style={m.role === "user" ? S.userWrap : S.aiWrap}>
      <div
        style={{
          maxWidth: m.role === "user" ? "70%" : "82%",
          width: "fit-content",
        }}
      >
        <div style={m.role === "user" ? S.userBubble : S.aiBubble}>
          {m.role === "assistant" ? (
            <CollapsibleBubble contentKey={m.content}>
              <MarkdownRenderer text={m.content} />
            </CollapsibleBubble>
          ) : (
            <p style={{ margin: 0 }}>{m.content}</p>
          )}
        </div>

        {m.role === "assistant" && (
          <>
            {/* fix: 免責聲明只在這裡顯示一次，system prompt 已移除 */}
            <div style={S.disclaimer}>{DISCLAIMER}</div>

            <div style={S.meta}>
              {m.elapsed != null && (
                <span style={S.elapsed}>⏱ {m.elapsed}s</span>
              )}
              {m.stopped && (
                <span style={{ ...S.elapsed, color: "#f85149" }}>已停止</span>
              )}
              {simplified && (
                <>
                  <span style={{ ...S.elapsed, color: "#e3b341" }}>
                    ⚠️ 含簡體
                  </span>
                  <button
                    style={{ ...S.copyBtn, color: "#e3b341" }}
                    onClick={onRetry}
                  >
                    重新用繁體回答
                  </button>
                </>
              )}
              <button
                style={{ ...S.copyBtn, color: copied ? "#3fb950" : "#8b949e" }}
                onClick={handleCopy}
              >
                {copied ? "✓ 已複製" : "複製"}
              </button>
            </div>

            {m.sop_ids?.length > 0 && onApplySchedule && (
              <>
                <button
                  onClick={() => onApplySchedule(m.sop_ids)}
                  disabled={!canApplySchedule}
                  style={canApplySchedule ? S.applyBtn : S.applyBtnDisabled}
                  onMouseEnter={canApplySchedule ? (e) => (e.currentTarget.style.background = "#1c3a5e") : undefined}
                  onMouseLeave={canApplySchedule ? (e) => (e.currentTarget.style.background = "transparent") : undefined}
                >
                  📅 申請此測試
                </button>
                {!canApplySchedule && (
                  <div style={S.applyHint}>請管理員登入後申請</div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const S = {
  userWrap: { display: "flex", justifyContent: "flex-end" },
  aiWrap: { display: "flex", justifyContent: "flex-start" },
  userBubble: {
    background: "#1f6feb",
    color: "#fff",
    borderRadius: "16px 16px 4px 16px",
    padding: "10px 16px",
    fontSize: 14,
    lineHeight: 1.6,
  },
  aiBubble: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: "16px 16px 16px 4px",
    padding: "12px 18px",
    fontSize: 14,
    lineHeight: 1.7,
  },
  disclaimer: {
    fontSize: 11,
    color: "#6e7681",
    lineHeight: 1.5,
    marginTop: 6,
    borderLeft: "2px solid #21262d",
    paddingLeft: 8,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    paddingLeft: 4,
    flexWrap: "wrap",
  },
  elapsed: { fontSize: 11, color: "#8b949e" },
  copyBtn: {
    background: "none",
    border: "none",
    fontSize: 11,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
    transition: "color .15s",
  },
  collapseBar: {
    position: "relative",
    textAlign: "center",
    paddingTop: 8,
    background: "linear-gradient(to bottom, transparent, #161b22 60%)",
    marginTop: -40,
  },
  collapseBarExpanded: { textAlign: "center", paddingTop: 8 },
  collapseBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    color: "#58a6ff",
    fontSize: 11,
    padding: "3px 12px",
    borderRadius: 10,
    cursor: "pointer",
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
  applyBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid #388bfd",
    color: "#79c0ff",
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 12px",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background .15s",
    marginTop: 8,
  },
  applyBtnDisabled: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid #30363d",
    color: "#6e7681",
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 12px",
    borderRadius: 6,
    cursor: "not-allowed",
    marginTop: 8,
  },
  applyHint: {
    marginTop: 4,
    fontSize: 11,
    color: "#8b949e",
  },
};

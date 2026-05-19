import { cleanText } from "./markdownUtils";

function inlineMarkdown(text) {
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let last = 0;
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) {
      parts.push(
        <strong key={idx++} style={{ color: "#cdd9e5" }}>
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      parts.push(
        <code key={idx++} style={S.inlineCode}>
          {match[3]}
        </code>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function MarkdownRenderer({ text }) {
  const lines = cleanText(text).split("\n");
  const elements = [];
  lines.forEach((line, i) => {
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} style={S.h3}>
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} style={S.h2}>
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} style={S.h1}>
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={S.listItem}>
          <span style={S.bullet}>▸</span>
          <span>{inlineMarkdown(line.slice(2))}</span>
        </div>,
      );
    } else if (/^\d+[.、]\s*/.test(line)) {
      const m = line.match(/^(\d+)[.、]\s*(.*)$/);
      elements.push(
        <div key={i} style={S.listItem}>
          <span style={S.numBullet}>{m[1]}.</span>
          <span>{inlineMarkdown(m[2])}</span>
        </div>,
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      elements.push(
        <p key={i} style={S.p}>
          {inlineMarkdown(line)}
        </p>,
      );
    }
  });
  return <>{elements}</>;
}

const S = {
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

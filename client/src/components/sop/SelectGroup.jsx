import React from "react";

const SelectGroup = ({ step, title, items, selected, onSelect, accent }) => {
  const isDone = !!selected;
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            flexShrink: 0,
            background: isDone ? accent : "#21262d",
            border: `2px solid ${isDone ? accent : "#30363d"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 800,
            color: isDone ? "#0d1117" : "#8b949e",
            transition: "all .2s",
          }}
        >
          {isDone ? "✓" : step}
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.5,
            color: isDone ? "#cdd9e5" : "#8b949e",
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map(([key, label]) => {
          const active = selected === key;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 11,
                cursor: "pointer",
                transition: "all .15s",
                border: `1px solid ${active ? accent : "#30363d"}`,
                background: active ? `${accent}22` : "#161b22",
                color: active ? accent : "#8b949e",
                fontWeight: active ? 700 : 400,
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SelectGroup;

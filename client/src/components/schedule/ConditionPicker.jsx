import { useState, useEffect } from "react";

export default function ConditionPicker({ standardsTree, selected, onChange, initialStd, initialVer }) {
  const [activeStd, setActiveStd] = useState(initialStd || Object.keys(standardsTree)[0] || "");
  const [activeVer, setActiveVer] = useState(initialVer || "");

  useEffect(() => {
    if (activeStd && standardsTree[activeStd]) {
      const vers = Object.keys(standardsTree[activeStd].versions);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (vers.length > 0 && !activeVer) setActiveVer(vers[0]);
    }
  }, [activeStd, standardsTree, activeVer]);

  const tests = activeStd && activeVer && standardsTree[activeStd]?.versions?.[activeVer]?.tests || {};

  function toggleTest(sop_id) {
    if (selected.includes(sop_id)) {
      onChange(selected.filter((s) => s !== sop_id));
    } else {
      onChange([...selected, sop_id]);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, height: 260 }}>
      <div style={{ width: 120, borderRight: "1px solid #30363d", overflowY: "auto" }}>
        {Object.keys(standardsTree).map((std) => (
          <div
            key={std}
            onClick={() => { setActiveStd(std); setActiveVer(""); }}
            style={{
              padding: "6px 8px", fontSize: 12, cursor: "pointer",
              background: activeStd === std ? "#1c3a5e" : "transparent",
              color: activeStd === std ? "#79c0ff" : "#8b949e",
              borderRadius: 4,
            }}
          >
            {std}
          </div>
        ))}
      </div>

      <div style={{ width: 140, borderRight: "1px solid #30363d", overflowY: "auto" }}>
        {activeStd && Object.keys(standardsTree[activeStd]?.versions || {}).map((ver) => (
          <div
            key={ver}
            onClick={() => setActiveVer(ver)}
            style={{
              padding: "6px 8px", fontSize: 11, cursor: "pointer",
              background: activeVer === ver ? "#1a3828" : "transparent",
              color: activeVer === ver ? "#7ee787" : "#8b949e",
              borderRadius: 4,
            }}
          >
            {ver}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {Object.values(tests).map((t) => {
          const checked = selected.includes(t.sop_id);
          return (
            <label
              key={t.sop_id}
              style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "5px 8px", cursor: "pointer", borderRadius: 4,
                background: checked ? "#1a3828" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleTest(t.sop_id)}
                style={{ marginTop: 2, accentColor: "#3fb950" }}
              />
              <div>
                <div style={{ fontSize: 12, color: "#cdd9e5", fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 10, color: "#484f58" }}>
                  {t.high_temperature != null && `高溫 ${t.high_temperature}°C`}
                  {t.low_temperature != null && ` / 低溫 ${t.low_temperature}°C`}
                  {t.dwell_time_hours != null && ` / ${t.dwell_time_hours}h`}
                  {t.cycles > 1 && ` × ${t.cycles}`}
                  {` ≈ ${t.estimated_hours}h`}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

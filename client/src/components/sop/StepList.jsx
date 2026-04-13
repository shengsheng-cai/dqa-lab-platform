import React, { useMemo } from "react";

const PHASE_LABELS = {
  dwell_high: "高溫保持階段開始時",
  ramp_to_low: "降溫段開始時",
  ramp_to_ambient: "回溫段開始時",
  dwell_low: "低溫保持階段開始時",
  ramp_to_high: "升溫段開始時",
};

const StepList = ({ steps, completedSteps, onToggle, manualMode = false, isAdmin = false, savedExecutionId = null, uploadPhoto, photoUploading }) => {
  const totalSteps = steps.length;
  const doneCnt = Object.values(completedSteps).filter(Boolean).length;
  const allStepsDone = totalSteps > 0 && doneCnt === totalSteps;

  const unlockedMap = useMemo(() => {
    const map = {};
    for (let idx = 0; idx < steps.length; idx++) {
      let unlocked = true;
      for (let i = 0; i < idx; i++) {
        if (!steps[i].optional && !completedSteps[steps[i].step_id]) {
          unlocked = false;
          break;
        }
      }
      map[idx] = unlocked;
    }
    return map;
  }, [steps, completedSteps]);

  return (
    <div>
      <p style={{ color: "#8b949e", fontSize: 12, marginBottom: 14 }}>
        測試進度（⚡ 步驟由系統自動確認）：
      </p>

      {steps.map((step, idx) => {
        const unlocked = unlockedMap[idx];
        const checked = !!completedSteps[step.step_id];
        const isAuto = !!step.auto_trigger;
        return (
          <label
            key={step.step_id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginBottom: 12,
              cursor: (isAuto && !manualMode) ? "default" : unlocked ? "pointer" : "not-allowed",
              color: checked ? "#57ab5a" : "#cdd9e5",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={(isAuto && !manualMode) || !unlocked}
              onChange={() => ((!isAuto || manualMode) && unlocked) && onToggle(step.step_id, idx)}
              style={{
                marginTop: 3,
                accentColor: "#57ab5a",
                flexShrink: 0,
                opacity: unlocked || checked ? 1 : 0.3,
              }}
            />
            <div style={{ opacity: unlocked || checked ? 1 : 0.55 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>
                Step {step.step_id}. {step.name}
                {isAuto && (
                  <span
                    title={PHASE_LABELS[step.auto_trigger] || "系統自動確認"}
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      padding: "1px 6px",
                      background: checked ? "#0f2318" : "#1c2128",
                      color: checked ? "#57ab5a" : "#58a6ff",
                      borderRadius: 4,
                      border: `1px solid ${checked ? "#2d5a3a" : "#1f6feb"}`,
                      cursor: "help",
                    }}
                  >
                    ⚡ Auto
                  </span>
                )}
                {step.optional && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      padding: "1px 6px",
                      background: "#21262d",
                      color: "#8b949e",
                      borderRadius: 4,
                    }}
                  >
                    Optional
                  </span>
                )}
                {!unlocked && !isAuto && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      padding: "1px 6px",
                      background: "#21262d",
                      color: "#484f58",
                      borderRadius: 4,
                    }}
                  >
                    🔒 待前步驟完成
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>
                {step.description}
              </div>
              {step.requires_photo && !!completedSteps[step.step_id] && savedExecutionId && isAdmin && (
                <div style={{ marginTop: 6 }}>
                  <label style={{
                    display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                    padding: "4px 10px", borderRadius: 4, fontSize: 11,
                    border: "1px dashed #2d5a3a", color: "#57ab5a", background: "#0f2318",
                  }}>
                    {photoUploading === "after" ? "⏳ 上傳中..." : "📷 上傳測試結束照片"}
                    <input type="file" accept="image/*" style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadPhoto(savedExecutionId, "after", f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          </label>
        );
      })}

      <div style={{ marginTop: 8, marginBottom: 4 }}>
        <div
          style={{
            height: 4,
            background: "#21262d",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 2,
              background: allStepsDone ? "#57ab5a" : "#58a6ff",
              width: `${totalSteps > 0 ? (doneCnt / totalSteps) * 100 : 0}%`,
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <div
          style={{
            color: allStepsDone ? "#57ab5a" : "#8b949e",
            fontSize: 12,
            marginTop: 6,
          }}
        >
          {doneCnt} / {totalSteps} 步驟完成{allStepsDone && " ✅"}
        </div>
      </div>
    </div>
  );
};

export default StepList;

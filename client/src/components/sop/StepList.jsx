import React from "react";

const StepList = ({ steps, completedSteps, onToggle }) => {
  const totalSteps = steps.length;
  const doneCnt = Object.values(completedSteps).filter(Boolean).length;
  const allStepsDone = totalSteps > 0 && doneCnt === totalSteps;

  const isStepUnlocked = (stepIndex) => {
    for (let i = 0; i < stepIndex; i++) {
      if (!steps[i].optional && !completedSteps[steps[i].step_id]) return false;
    }
    return true;
  };

  return (
    <div>
      <p style={{ color: "#8b949e", fontSize: 12, marginBottom: 14 }}>
        請依序確認每個步驟已完成：
      </p>

      {steps.map((step, idx) => {
        const unlocked = isStepUnlocked(idx);
        const checked = !!completedSteps[step.step_id];
        return (
          <label
            key={step.step_id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginBottom: 12,
              cursor: unlocked ? "pointer" : "not-allowed",
              // 修改：未解鎖時只降低 checkbox opacity，文字保持可讀
              color: checked ? "#57ab5a" : "#cdd9e5",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!unlocked}
              onChange={() => unlocked && onToggle(step.step_id, idx)}
              style={{
                marginTop: 3,
                accentColor: "#57ab5a",
                flexShrink: 0,
                opacity: unlocked ? 1 : 0.3,
              }}
            />
            <div style={{ opacity: unlocked ? 1 : 0.55 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>
                Step {step.step_id}. {step.name}
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
                {!unlocked && (
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

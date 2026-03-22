import React, { useState, useRef, useEffect } from "react";

const SAFETY_CHECKS = [
  "測試孔是否用塑膠塞及抹布將兩邊塞緊，以免水氣跑出。",
  "線材類治具等移至上方後再塞，以免水氣往利用線材類治具流至設備上造成毀損。",
  "抹布末端勿留至 Sample 上，以免低溫轉高溫時水氣流至 Sample 上導致燒燬。",
  "電源頭請放在治具、線材類上或懸空在鐵架下方，勿放在鐵架上。",
];

const SafetyChecklist = ({
  operator,
  onOperatorChange,
  safetyChecked,
  onSafetyChange,
  testData,
  selectedDevice,
  starting,
  startError,
  onStart,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [modalOperator, setModalOperator] = useState("");
  const inputRef = useRef(null);

  const checkedCount = safetyChecked.filter(Boolean).length;
  const allChecked = safetyChecked.every(Boolean);

  // modal 開啟時自動 focus 輸入框，並帶入已有的 operator
  useEffect(() => {
    if (showModal) {
      setModalOperator(operator || "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showModal]); // eslint-disable-line

  const handleLaunchClick = () => {
    setShowModal(true);
  };

  const handleModalConfirm = () => {
    const trimmed = modalOperator.trim();
    onOperatorChange(trimmed); // 同步回父元件
    if (trimmed) localStorage.setItem("dqa_operator", trimmed);
    setShowModal(false);
    onStart(trimmed); // 把 operator 直接傳給 startSop
  };

  const handleModalCancel = () => {
    setShowModal(false);
  };

  const handleModalKeyDown = (e) => {
    if (e.key === "Enter") handleModalConfirm();
    if (e.key === "Escape") handleModalCancel();
  };

  return (
    <section
      className="operation-box"
      style={{ borderLeft: "3px solid #f0a500", position: "relative" }}
    >
      {/* Inline Modal Overlay */}
      {showModal && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            borderRadius: 8,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              background: "#161b22",
              border: "1px solid #f0a500",
              borderRadius: 10,
              padding: "24px 24px 20px",
              width: "100%",
              maxWidth: 360,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#f0a500",
                marginBottom: 4,
              }}
            >
              🚀 確認啟動
            </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 16 }}>
              {selectedDevice} — {testData?.name}
            </div>

            <label
              style={{
                fontSize: 11,
                color: "#8b949e",
                display: "block",
                marginBottom: 6,
                fontWeight: 600,
                letterSpacing: 0.5,
              }}
            >
              👤 操作人員姓名
            </label>
            <input
              ref={inputRef}
              type="text"
              value={modalOperator}
              onChange={(e) => setModalOperator(e.target.value)}
              onKeyDown={handleModalKeyDown}
              placeholder="例：王小明（寫入報告及 LINE 推播）"
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                color: "#cdd9e5",
                fontSize: 12,
                boxSizing: "border-box",
                marginBottom: 6,
              }}
            />
            {!modalOperator.trim() && (
              <div style={{ fontSize: 10, color: "#f0a500", marginBottom: 12 }}>
                ⚠️ 未填寫姓名，EMERGENCY 推播將顯示「未填寫」
              </div>
            )}
            {modalOperator.trim() && (
              <div style={{ height: 18, marginBottom: 12 }} />
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleModalCancel}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  background: "#21262d",
                  color: "#8b949e",
                  border: "1px solid #30363d",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                取消
              </button>
              <button
                onClick={handleModalConfirm}
                disabled={starting}
                style={{
                  flex: 2,
                  padding: "9px 0",
                  background: starting ? "#21262d" : "#238636",
                  color: starting ? "#484f58" : "#fff",
                  border: `1px solid ${starting ? "#30363d" : "#2ea043"}`,
                  borderRadius: 6,
                  cursor: starting ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {starting ? "⏳ 啟動中..." : "✅ 確認啟動"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="box-header">
        <span>⚠️</span>
        <h2>上架驗證注意事項</h2>
      </div>

      <p style={{ color: "#8b949e", fontSize: 12, marginBottom: 14 }}>
        啟動測試前，請確認以下所有項目（{checkedCount} / {SAFETY_CHECKS.length}{" "}
        已確認）：
      </p>

      {SAFETY_CHECKS.map((item, i) => (
        <label
          key={i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 10,
            cursor: "pointer",
            color: safetyChecked[i] ? "#57ab5a" : "#cdd9e5",
          }}
        >
          <input
            type="checkbox"
            checked={safetyChecked[i]}
            onChange={() => onSafetyChange(i)}
            style={{ marginTop: 3, accentColor: "#57ab5a", flexShrink: 0 }}
          />
          <span style={{ fontSize: 12 }}>
            {i + 1}. {item}
          </span>
        </label>
      ))}

      {/* 進度條 */}
      <div
        style={{
          height: 3,
          background: "#21262d",
          borderRadius: 2,
          overflow: "hidden",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 2,
            background: allChecked ? "#57ab5a" : "#f0a500",
            width: `${(checkedCount / SAFETY_CHECKS.length) * 100}%`,
            transition: "width 0.2s ease",
          }}
        />
      </div>

      {allChecked ? (
        <p style={{ color: "#57ab5a", fontSize: 12, marginTop: 6 }}>
          ✅ 所有注意事項已確認，可以啟動測試
        </p>
      ) : (
        <p style={{ color: "#f0a500", fontSize: 12, marginTop: 6 }}>
          ⚠️ 還差 {SAFETY_CHECKS.length - checkedCount} 項未確認
        </p>
      )}

      <button
        onClick={handleLaunchClick}
        disabled={!allChecked || starting}
        style={{
          marginTop: 14,
          width: "100%",
          padding: "12px",
          background: !allChecked || starting ? "#21262d" : "#238636",
          color: !allChecked || starting ? "#484f58" : "#fff",
          border: `1px solid ${!allChecked || starting ? "#30363d" : "#2ea043"}`,
          borderRadius: 6,
          cursor: !allChecked || starting ? "not-allowed" : "pointer",
          fontWeight: 700,
          fontSize: 14,
          transition: "all .2s",
        }}
      >
        {starting
          ? "⏳ 啟動中..."
          : allChecked
            ? `🚀 啟動 ${selectedDevice}：${testData?.name}`
            : "請先確認所有注意事項"}
      </button>

      {startError && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: "#2d0f0f",
            border: "1px solid #f8514944",
            borderRadius: 6,
            color: "#f85149",
            fontSize: 12,
          }}
        >
          {startError}
        </div>
      )}
    </section>
  );
};

export default SafetyChecklist;

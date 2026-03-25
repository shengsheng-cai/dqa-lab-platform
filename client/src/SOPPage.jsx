import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api from "./api";
import MonitorSide from "./components/sop/MonitorSide";
import ControlPanel from "./components/sop/ControlPanel";
import ConditionCard from "./components/sop/ConditionCard";
import SelectGroup from "./components/sop/SelectGroup";
import StepList from "./components/sop/StepList";
import ExecutionPanel from "./components/sop/ExecutionPanel";
import SafetyChecklist from "./components/sop/SafetyChecklist";
import "./SOPPage.css";

const DEVICE_IDS = [
  "CH-01",
  "CH-02",
  "CH-03",
  "CH-04",
  "CH-05",
];
const ACTIVE_STATUSES = ["RUNNING", "PAUSED"];

const initDeviceState = () => ({
  activeSop: null,
  completedSteps: {},
  savedExecutionId: null,
  autoSave: false,
  safetyChecked: [false, false, false, false],
  chartHistory: [],
  chartStartedAt: null,
  selectedStd: null,
  selectedVer: null,
  selectedTest: null,
});

function restoreSelectionFromSopId(sopId, standardTree) {
  if (!sopId || !standardTree) return null;
  for (const [stdKey, stdData] of Object.entries(standardTree)) {
    for (const [verKey, verData] of Object.entries(stdData.versions || {})) {
      for (const [testKey, testData] of Object.entries(verData.tests || {})) {
        if (testData.sop_id === sopId)
          return {
            selectedStd: stdKey,
            selectedVer: verKey,
            selectedTest: testKey,
          };
      }
    }
  }
  return null;
}

// 自製確認 Modal（取代 window.confirm）
const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 10,
        padding: "24px 28px",
        maxWidth: 360,
        width: "90%",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: "#cdd9e5",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        {message}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 16px",
            background: "#21262d",
            color: "#8b949e",
            border: "1px solid #30363d",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: "8px 16px",
            background: "#da3633",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          確定
        </button>
      </div>
    </div>
  </div>
);

const SOPPage = ({ active = true, externalDevice }) => {
  const [selectedDevice, setSelectedDevice] = useState(externalDevice || "CH-01");

  // 同步外部設備選擇（ControlCenter LeftPanel 點選時）
  useEffect(() => {
    if (externalDevice && externalDevice !== selectedDevice) {
      setSelectedDevice(externalDevice);
    }
  }, [externalDevice]); // eslint-disable-line
  const [allDevices, setAllDevices] = useState({});
  const [deviceStates, setDeviceStates] = useState(() =>
    Object.fromEntries(DEVICE_IDS.map((id) => [id, initDeviceState()])),
  );
  const [emergencyFlash, setEmergencyFlash] = useState(false);
  const [standardTree, setStandardTree] = useState({});
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);
  const [pauseOptimistic, setPauseOptimistic] = useState(null);
  const [operator, setOperator] = useState(
    () => localStorage.getItem("dqa_operator") || "",
  );
  const [confirmModal, setConfirmModal] = useState(null);

  const historyFetchingRef = useRef(null);
  const lastHistoryMinuteRef = useRef(-1);
  const prevSimPhaseRef = useRef("");
  const prevSimCycleRef = useRef(0);

  const data = allDevices[selectedDevice] || {
    status: "OFFLINE",
    temperature: 0,
    humidity: 0,
    running_sop_name: "未連線",
    description: "等待連線...",
    timestamp: "--:--:--",
  };
  const ds = deviceStates[selectedDevice];
  const isActive = ACTIVE_STATUSES.includes(data.status);
  const isOffline = data.status === "OFFLINE";
  const isEmergency = data.status === "EMERGENCY";
  const canStop = isActive || isEmergency;
  const effectiveStatus = pauseOptimistic ?? data.status;
  const effectiveIsActive = ACTIVE_STATUSES.includes(effectiveStatus);
  const doneCnt = Object.values(ds.completedSteps).filter(Boolean).length;
  const allStepsDone =
    ds.activeSop &&
    (ds.activeSop?.steps?.length ?? 0) > 0 &&
    doneCnt === (ds.activeSop?.steps?.length ?? 0);
  const { selectedStd, selectedVer, selectedTest } = ds;
  const stdData = selectedStd ? standardTree[selectedStd] : null;
  const verData = selectedVer ? stdData?.versions?.[selectedVer] : null;
  const testData = selectedTest ? verData?.tests?.[selectedTest] : null;

  const updateDS = (id, patch) =>
    setDeviceStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  useEffect(() => {
    if (!isEmergency) {
      setEmergencyFlash(false);
      return;
    }
    const t = setInterval(() => setEmergencyFlash((f) => !f), 600);
    return () => clearInterval(t);
  }, [isEmergency]);

  // S3 fix: 只有當 status 已符合 optimistic 值才清除，避免過早 reset
  useEffect(() => {
    if (pauseOptimistic && data.status === effectiveStatus) {
      setPauseOptimistic(null);
    }
  }, [data.status, pauseOptimistic, effectiveStatus]);

  useEffect(() => {
    api
      .get("/api/sop/standards/tree")
      .then((r) => {
        setStandardTree(r.data);
        setTreeLoaded(true);
      })
      .catch(() => setTreeLoaded(true));
  }, []);

  const fetchHistory = useCallback((deviceId, startedAt) => {
    if (!startedAt) return;
    historyFetchingRef.current = deviceId;
    api
      .get(`/api/devices/${deviceId}/history`)
      .then((res) => {
        if (historyFetchingRef.current === deviceId)
          setDeviceStates((prev) => ({
            ...prev,
            [deviceId]: {
              ...prev[deviceId],
              chartHistory: res.data,
              chartStartedAt: startedAt,
            },
          }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;
    const poll = () => {
      api
        .get("/api/devices")
        .then((r) => {
          const map = {};
          r.data.forEach((d) => {
            map[d.device_id] = d;
          });
          setAllDevices(map);
          setDeviceStates((prev) => {
            const next = { ...prev };
            DEVICE_IDS.forEach((id) => {
              const cur = map[id];
              if (!cur) return;
              const p = prev[id];
              let restoredSop = p.activeSop;
              if (!restoredSop && cur.active_sop_json) {
                try {
                  restoredSop = JSON.parse(cur.active_sop_json);
                } catch {
                  /* ignore */
                }
              }
              if (
                !cur.active_sop_json &&
                p.activeSop &&
                !ACTIVE_STATUSES.includes(cur.status)
              )
                restoredSop = null;
              const selPatch =
                restoredSop && !p.selectedStd && cur.active_sop_json
                  ? { _pendingRestoreSopId: restoredSop.sop_id }
                  : {};
              next[id] = { ...p, activeSop: restoredSop, ...selPatch };
            });
            return next;
          });
          const now = new Date();
          const min = now.getHours() * 60 + now.getMinutes();
          if (now.getSeconds() < 10 && min !== lastHistoryMinuteRef.current) {
            lastHistoryMinuteRef.current = min;
            if (map[selectedDevice]?.started_at)
              fetchHistory(selectedDevice, map[selectedDevice].started_at);
          }
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [selectedDevice, active, fetchHistory]);

  useEffect(() => {
    if (!treeLoaded) return;
    setDeviceStates((prev) => {
      const next = { ...prev };
      DEVICE_IDS.forEach((id) => {
        const pending = prev[id]._pendingRestoreSopId;
        if (pending && !prev[id].selectedStd) {
          const restored = restoreSelectionFromSopId(pending, standardTree);
          if (restored)
            next[id] = {
              ...prev[id],
              ...restored,
              _pendingRestoreSopId: undefined,
            };
        }
      });
      return next;
    });
  }, [treeLoaded, standardTree]);

  useEffect(() => {
    if (!active) return;
    lastHistoryMinuteRef.current = -1;
    const d = allDevices[selectedDevice];
    if (d?.started_at) fetchHistory(selectedDevice, d.started_at);
    else updateDS(selectedDevice, { chartHistory: [], chartStartedAt: null });
  }, [selectedDevice]); // eslint-disable-line

  const startedAt = allDevices[selectedDevice]?.started_at;
  useEffect(() => {
    if (!startedAt) {
      updateDS(selectedDevice, { chartHistory: [], chartStartedAt: null });
      return;
    }
    fetchHistory(selectedDevice, startedAt);
  }, [startedAt]); // eslint-disable-line

  // Phase 9-2: 根據 sim_phase 自動確認步驟
  const simPhase = allDevices[selectedDevice]?.sim_phase || "";
  const simCycle = allDevices[selectedDevice]?.sim_cycle || 0;

  const autoTriggerMap = useMemo(() => {
    const steps = deviceStates[selectedDevice]?.activeSop?.steps || [];
    const map = {};
    steps.forEach((s) => {
      if (s.auto_trigger) map[s.auto_trigger] = (map[s.auto_trigger] || []).concat(s.step_id);
    });
    return map;
  }, [deviceStates, selectedDevice]);
  const autoTriggerMapRef = useRef({});
  autoTriggerMapRef.current = autoTriggerMap;
  const deviceStatesRef = useRef(deviceStates);
  deviceStatesRef.current = deviceStates;

  // 切換設備時重置 prev refs，避免誤觸發
  useEffect(() => {
    prevSimPhaseRef.current = simPhase;
    prevSimCycleRef.current = simCycle;
  }, [selectedDevice]); // eslint-disable-line

  // 載入已執行中設備時，根據當前 sim_phase 恢復自動步驟狀態
  useEffect(() => {
    const curDs = deviceStatesRef.current[selectedDevice];
    if (!curDs?.activeSop || Object.keys(curDs.completedSteps).length > 0) return;

    const phase = simPhase;
    const cycle = simCycle;
    const steps = curDs.activeSop.steps || [];
    const totalCycles = curDs.activeSop.cycles || 1;
    const firedTriggers = new Set();

    if (phase && phase !== "idle") firedTriggers.add("first_ramp");
    if (["dwell_high", "ramp_to_low2", "dwell_low", "ramp_to_ambient"].includes(phase)) firedTriggers.add("first_dwell");
    if (["dwell_low", "ramp_to_ambient"].includes(phase)) firedTriggers.add("second_dwell");
    if (phase === "ramp_to_ambient") firedTriggers.add("complete");
    if (cycle >= Math.ceil(totalCycles / 2)) firedTriggers.add("cycle_half");

    const newCompleted = {};
    steps.forEach((s) => {
      if (s.auto_trigger && firedTriggers.has(s.auto_trigger)) newCompleted[s.step_id] = true;
    });

    if (Object.keys(newCompleted).length > 0) {
      setDeviceStates((prev) => ({
        ...prev,
        [selectedDevice]: { ...prev[selectedDevice], completedSteps: newCompleted },
      }));
    }
  }, [ds.activeSop?.sop_id, selectedDevice]); // eslint-disable-line

  useEffect(() => {
    const prevPhase = prevSimPhaseRef.current;
    const prevCycle = prevSimCycleRef.current;
    prevSimPhaseRef.current = simPhase;
    prevSimCycleRef.current = simCycle;

    // 初次載入或切換設備後第一次 poll，不觸發（refs 已在上方 useEffect 初始化）
    if (!prevPhase && !prevCycle) return;

    const curDs = deviceStatesRef.current[selectedDevice];
    if (!curDs?.activeSop || !ACTIVE_STATUSES.includes(allDevices[selectedDevice]?.status)) return;

    const totalCycles = curDs.activeSop.cycles || 1;
    let changed = false;
    const pendingChecks = [];

    const autoCheck = (trigger) => {
      const ids = autoTriggerMapRef.current[trigger] || [];
      ids.forEach((id) => {
        if (!curDs.completedSteps[id]) { pendingChecks.push(id); changed = true; }
      });
    };

    // 進入第一個 ramp（非 ambient）
    if (!prevPhase.startsWith("ramp") && simPhase.startsWith("ramp_to") && simPhase !== "ramp_to_ambient") {
      autoCheck("first_ramp");
    }
    // 進入第一個 dwell_high
    if (prevPhase !== "dwell_high" && simPhase === "dwell_high") {
      autoCheck("first_dwell");
    }
    // 進入 dwell_low
    if (prevPhase !== "dwell_low" && simPhase === "dwell_low") {
      autoCheck("second_dwell");
    }
    // 循環過半
    if (simCycle !== prevCycle && simCycle >= Math.ceil(totalCycles / 2)) {
      autoCheck("cycle_half");
    }

    // 進入 ramp_to_ambient = 測試自然完成，自動確認剩餘步驟並標記自動存報告
    let triggerAutoSave = false;
    if (prevPhase !== "ramp_to_ambient" && simPhase === "ramp_to_ambient") {
      autoCheck("complete");
      triggerAutoSave = true;
    }

    if (changed || triggerAutoSave) {
      setDeviceStates((prev) => {
        const prevDs = prev[selectedDevice];
        const newCompleted = { ...prevDs.completedSteps };
        pendingChecks.forEach((id) => { newCompleted[id] = true; });
        return {
          ...prev,
          [selectedDevice]: {
            ...prevDs,
            completedSteps: newCompleted,
            ...(triggerAutoSave ? { autoSave: true } : {}),
          },
        };
      });
    }
  }, [simPhase, simCycle]); // eslint-disable-line

  const startSop = async (confirmedOperator) => {
    if (!testData || starting) return;
    const sopSteps = testData.steps || [];
    if (!sopSteps.length) {
      setStartError("⚠️ SOP 步驟資料不完整，請確認後端設定後重試。");
      return;
    }
    setStartError("");
    setStarting(true);
    try {
      await api.post("/api/sop/start", {
        sop_id: testData.sop_id,
        device_id: selectedDevice,
        operator: confirmedOperator || "",
      });
      updateDS(selectedDevice, {
        activeSop: { ...testData, steps: sopSteps },
        completedSteps: {},
        savedExecutionId: null,
      });
    } catch (err) {
      setStartError(
        `❌ 啟動失敗：${err?.response?.data?.detail || err?.message || "未知錯誤"}`,
      );
    } finally {
      setStarting(false);
    }
  };

  const handleAction = async (type) => {
    if (type === "pause")
      setPauseOptimistic(effectiveStatus === "RUNNING" ? "PAUSED" : "RUNNING");
    try {
      await api.post(`/api/stop/${selectedDevice}/${type}`);
      if (type === "normal" || type === "emergency") {
        updateDS(selectedDevice, {
          activeSop: null,
          completedSteps: {},
          savedExecutionId: null,
          autoSave: false,
          safetyChecked: [false, false, false, false],
        });
        setStartError("");
        setPauseOptimistic(null);
      }
    } catch (e) {
      console.error("[SOPPage] action:", e);
      setPauseOptimistic(null);
    }
  };

  const handleToggleStep = (stepId, stepIndex) => {
    const steps = ds.activeSop?.steps || [];
    const newCompleted = { ...ds.completedSteps };

    if (newCompleted[stepId]) {
      setConfirmModal({
        message: `取消「Step ${stepId}」將清除後續所有步驟，確定？`,
        onConfirm: async () => {
          setConfirmModal(null);
          steps.slice(stepIndex).forEach((s) => delete newCompleted[s.step_id]);
          updateDS(selectedDevice, { completedSteps: newCompleted });
          try {
            await api.post(`/api/devices/${selectedDevice}/progress`, {
              completed: Object.values(newCompleted).filter(Boolean).length,
            });
          } catch (e) {
            console.error("[SOPPage] progress:", e);
          }
        },
      });
    } else {
      newCompleted[stepId] = true;
      updateDS(selectedDevice, { completedSteps: newCompleted });
      api
        .post(`/api/devices/${selectedDevice}/progress`, {
          completed: Object.values(newCompleted).filter(Boolean).length,
        })
        .catch((e) => console.error("[SOPPage] progress:", e));
    }
  };

  return (
    <div className="sop-page-layout">
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      <MonitorSide
        selectedDevice={selectedDevice}
        allDevices={allDevices}
        data={data}
        ds={ds}
        doneCnt={doneCnt}
        isActive={isActive}
        isOffline={isOffline}
        isEmergency={isEmergency}
        onSelectDevice={setSelectedDevice}
        embedded={!!externalDevice}
      />

      <main className={`control-side${externalDevice ? " embedded" : ""}`}>
        <div className="scroll-wrapper">
          <ControlPanel
            selectedDevice={selectedDevice}
            data={data}
            emergencyFlash={emergencyFlash}
            effectiveStatus={effectiveStatus}
            effectiveIsActive={effectiveIsActive}
            canStop={canStop}
            isOffline={isOffline}
            isEmergency={isEmergency}
            onAction={handleAction}
          />

          {isActive && ds.activeSop && (
            <section
              className="operation-box"
              style={{ borderLeft: "3px solid #58a6ff" }}
            >
              <div className="box-header">
                <span>📋</span>
                <h2 style={{ fontSize: 13 }}>{ds.activeSop.name}</h2>
              </div>
              <StepList
                steps={ds.activeSop.steps || []}
                completedSteps={ds.completedSteps}
                onToggle={handleToggleStep}
              />
              {allStepsDone && (
                <ExecutionPanel
                  activeSop={ds.activeSop}
                  selectedDevice={selectedDevice}
                  completedSteps={ds.completedSteps}
                  operator={operator}
                  startedAt={data.started_at}
                  savedExecutionId={ds.savedExecutionId}
                  autoSave={ds.autoSave}
                  onSaved={(id) =>
                    updateDS(selectedDevice, { savedExecutionId: id, autoSave: false })
                  }
                  onError={setStartError}
                />
              )}
            </section>
          )}

          {!isActive && (
            <>
              <section
                className="operation-box"
                style={{ borderLeft: "3px solid #58a6ff" }}
              >
                <div className="box-header">
                  <span>🔬</span>
                  <h2>選擇測試標準</h2>
                </div>
                {!treeLoaded ? (
                  <div
                    style={{ color: "#484f58", fontSize: 12, padding: "8px 0" }}
                  >
                    ⏳ 載入標準資料中...
                  </div>
                ) : (
                  <SelectGroup
                    step={1}
                    title="選擇法規"
                    accent="#58a6ff"
                    items={Object.entries(standardTree).map(([k, v]) => [
                      k,
                      v.label,
                    ])}
                    selected={selectedStd}
                    onSelect={(k) =>
                      updateDS(selectedDevice, {
                        selectedStd: k,
                        selectedVer: null,
                        selectedTest: null,
                      })
                    }
                  />
                )}
                {stdData && (
                  <>
                    <div
                      style={{
                        borderTop: "1px solid #21262d",
                        margin: "4px 0 14px",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: "#8b949e",
                        marginBottom: 10,
                        lineHeight: 1.5,
                      }}
                    >
                      {stdData.description}
                    </div>
                    <SelectGroup
                      step={2}
                      title="選擇版本 / Class"
                      accent="#f0a500"
                      items={Object.entries(stdData.versions).map(([k, v]) => [
                        k,
                        v.label,
                      ])}
                      selected={selectedVer}
                      onSelect={(k) =>
                        updateDS(selectedDevice, {
                          selectedVer: k,
                          selectedTest: null,
                        })
                      }
                    />
                  </>
                )}
                {verData && (
                  <>
                    <div
                      style={{
                        borderTop: "1px solid #21262d",
                        margin: "4px 0 14px",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: "#8b949e",
                        marginBottom: 10,
                        lineHeight: 1.5,
                      }}
                    >
                      {verData.description}
                    </div>
                    <SelectGroup
                      step={3}
                      title="選擇測試條件"
                      accent="#57ab5a"
                      items={Object.entries(verData.tests).map(([k, v]) => [
                        k,
                        v.name,
                      ])}
                      selected={selectedTest}
                      onSelect={(k) =>
                        updateDS(selectedDevice, { selectedTest: k })
                      }
                    />
                  </>
                )}
                {testData && <ConditionCard test={testData} />}
              </section>

              {testData && (
                <SafetyChecklist
                  operator={operator}
                  onOperatorChange={(val) => {
                    setOperator(val);
                    if (val) localStorage.setItem("dqa_operator", val);
                  }}
                  safetyChecked={ds.safetyChecked}
                  onSafetyChange={(i) => {
                    const u = [...ds.safetyChecked];
                    u[i] = !u[i];
                    updateDS(selectedDevice, { safetyChecked: u });
                  }}
                  testData={testData}
                  selectedDevice={selectedDevice}
                  starting={starting}
                  startError={startError}
                  onStart={startSop}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default SOPPage;

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api from "./api";
import { useToast } from "./components/Toast";
import MonitorSide from "./components/sop/MonitorSide";
import ControlPanel from "./components/sop/ControlPanel";
import ConditionCard from "./components/sop/ConditionCard";
import SelectGroup from "./components/sop/SelectGroup";
import StepList from "./components/sop/StepList";
import ExecutionPanel from "./components/sop/ExecutionPanel";
import SafetyChecklist from "./components/sop/SafetyChecklist";
import "./SOPPage.css";
import { DEVICE_IDS, ACTIVE_STATUSES, FINISHING_STATUS, OFFLINE_STATUS, EMERGENCY_STATUS } from "./constants";
import ConfirmModal from "./components/ConfirmModal";

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
  conditionConfirmed: false,
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


const SOPPage = ({ active = true, externalDevice, onOpenExecutions }) => {
  const { showToast } = useToast();
  const [selectedDevice, setSelectedDevice] = useState(externalDevice || "CH-01");
  const [pendingSchedule, setPendingSchedule] = useState(null);
  const [confirmingSched, setConfirmingSched] = useState(false);
  const prevDeviceStatusRef = useRef({});

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
  const [manualMode, setManualMode] = useState(false);
  const role = localStorage.getItem("user_role") || "guest";
  const isAdmin = role === "admin";

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
  const isFinishing = data.status === FINISHING_STATUS;
  const isOffline = data.status === OFFLINE_STATUS;
  const isEmergency = data.status === EMERGENCY_STATUS;
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
                !ACTIVE_STATUSES.includes(cur.status) &&
                cur.status !== FINISHING_STATUS
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

  // 偵測設備從 RUNNING → IDLE，查詢是否有等待確認的排程
  useEffect(() => {
    const prevStatus = prevDeviceStatusRef.current[selectedDevice];
    const curStatus = data.status;
    prevDeviceStatusRef.current[selectedDevice] = curStatus;
    if (prevStatus && prevStatus !== "IDLE" && curStatus === "IDLE") {
      api.get("/api/schedules?status=RUNNING").then((r) => {
        const match = r.data.find((s) => s.device_id === selectedDevice);
        setPendingSchedule(match || null);
      }).catch(() => {});
    } else if (curStatus !== "IDLE") {
      setPendingSchedule(null);
    }
  }, [data.status, selectedDevice]); // eslint-disable-line

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
  const currentStatus = allDevices[selectedDevice]?.status;
  useEffect(() => {
    if (!startedAt) {
      if (currentStatus !== FINISHING_STATUS)
        updateDS(selectedDevice, { chartHistory: [], chartStartedAt: null });
      return;
    }
    fetchHistory(selectedDevice, startedAt);
  }, [startedAt, currentStatus]); // eslint-disable-line

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
    // FINISHING 不恢復：正常停止後 active_sop_json 尚未清除會導致誤觸發
    if (!ACTIVE_STATUSES.includes(allDevices[selectedDevice]?.status)) return;

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
  }, [ds.activeSop?.sop_id, selectedDevice, simPhase]); // eslint-disable-line

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
      showToast("測試已啟動", "success");
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "未知錯誤";
      setStartError(`❌ 啟動失敗：${msg}`);
      showToast(`啟動失敗：${msg}`, "error");
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
        const patch = { completedSteps: {}, savedExecutionId: null, autoSave: false, safetyChecked: [false, false, false, false] };
        if (type === "emergency") patch.activeSop = null;
        updateDS(selectedDevice, patch);
        setStartError("");
        const msg = type === "emergency" ? "緊急停止已執行" : "測試已停止";
        showToast(msg, "success");
      } else if (type === "pause") {
        const msg = effectiveStatus === "RUNNING" ? "測試已暫停" : "測試已繼續";
        showToast(msg, "success");
      }
    } catch (e) {
      console.error("[SOPPage] action:", e);
      const msg = e.response?.data?.detail || "操作失敗";
      showToast(msg, "error");
    } finally {
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
            const msg = e.response?.data?.detail || "進度更新失敗";
            showToast(msg, "error");
          }
        },
      });
    } else {
      // 用 functional setState 確保讀到最新 completedSteps，避免快速連勾 race condition
      setDeviceStates((prev) => {
        const prevDs = prev[selectedDevice];
        const newComp = { ...prevDs.completedSteps, [stepId]: true };
        api
          .post(`/api/devices/${selectedDevice}/progress`, {
            completed: Object.values(newComp).filter(Boolean).length,
          })
          .catch((e) => console.error("[SOPPage] progress:", e));
        return { ...prev, [selectedDevice]: { ...prevDs, completedSteps: newComp } };
      });
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
        onSelectDevice={setSelectedDevice}
        embedded={!!externalDevice}
      />

      <main className={`control-side${externalDevice ? " embedded" : ""}`}>
        <div className="scroll-wrapper">
          {role === "guest" ? (
            <section
              className="operation-box"
              style={{
                borderLeft: "3px solid #f0a500",
                background: "#1a1500",
                textAlign: "center",
              }}
            >
              <div style={{ color: "#f0a500", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                🔒 訪客模式
              </div>
              <div style={{ color: "#8b949e", fontSize: 12, lineHeight: 1.6 }}>
                訪客可查看設備狀態、測試歷史、排程及治具，並可使用 AI 諮詢。<br />
                無法進行啟動、暫停或停止等操作。
              </div>
            </section>
          ) : (
            <ControlPanel
              selectedDevice={selectedDevice}
              data={data}
              emergencyFlash={emergencyFlash}
              effectiveStatus={effectiveStatus}
              effectiveIsActive={effectiveIsActive}
              onAction={handleAction}
            />
          )}

          {isActive && ds.activeSop && (
            <section
              className="operation-box"
              style={{ borderLeft: "3px solid #58a6ff" }}
            >
              <div className="box-header" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>📋</span>
                  <h2 style={{ fontSize: 13 }}>{ds.activeSop.name}</h2>
                </div>
                {isAdmin && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => setManualMode((v) => !v)}
                      title="手動接管模式：解鎖 Auto 步驟，允許手動勾選"
                      style={{
                        padding: "3px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                        background: manualMode ? "#0f2318" : "#21262d",
                        color: manualMode ? "#57ab5a" : "#8b949e",
                        border: `1px solid ${manualMode ? "#2d5a3a" : "#30363d"}`,
                      }}
                    >
                      {manualMode ? "🔓 手動中" : "🔒 自動"}
                    </button>
                    <button
                      onClick={() => {
                        setConfirmModal({
                          message: "確定跳至降溫階段？此操作將略過剩餘測試步驟，直接回溫到 25°C。",
                          onConfirm: async () => {
                            setConfirmModal(null);
                            try {
                              await api.post(`/api/devices/${selectedDevice}/set-phase`, { phase: "ramp_to_ambient" });
                              showToast("已跳轉至降溫階段", "success");
                            } catch (e) {
                              const msg = e?.response?.data?.detail || "操作失敗";
                              showToast(msg, "error");
                            }
                          },
                        });
                      }}
                      title="跳至降溫（略過剩餘測試直接回 25°C）"
                      style={{
                        padding: "3px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                        background: "#21262d", color: "#58a6ff",
                        border: "1px solid #1f6feb",
                      }}
                    >
                      ⏩ 跳至降溫
                    </button>
                  </div>
                )}
              </div>
              <StepList
                steps={ds.activeSop.steps || []}
                completedSteps={ds.completedSteps}
                onToggle={handleToggleStep}
                manualMode={manualMode}
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

          {!isActive && !isFinishing && pendingSchedule && (() => {
            const conds = pendingSchedule.conditions || [];
            const idx = pendingSchedule.current_condition_index ?? 0;
            const isLast = idx >= conds.length;
            const label = isLast
              ? "✅ 確認全部完成"
              : `▶ 開始第 ${idx + 1} 條件（共 ${conds.length}）`;
            const condName = isLast ? null : (pendingSchedule.condition_names?.[idx] || conds[idx]);
            return (
              <section
                className="operation-box"
                style={{ borderLeft: "3px solid #f0a500", background: "#1a1500" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ color: "#f0a500", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                      ⚠️ 條件 {idx}/{conds.length} 已完成，等待確認
                    </div>
                    <div style={{ color: "#8b949e", fontSize: 12, marginBottom: 4 }}>
                      {pendingSchedule.project_number} / {pendingSchedule.sample_name}
                    </div>
                    {condName && (
                      <div style={{ color: "#cdd9e5", fontSize: 12 }}>
                        下一條件：{condName}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {onOpenExecutions && (
                      <button
                        onClick={onOpenExecutions}
                        style={{
                          padding: "6px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                          background: "#21262d", color: "#cdd9e5", border: "1px solid #30363d",
                        }}
                      >
                        📋 查看報告
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        setConfirmingSched(true);
                        try {
                          const res = await api.post(`/api/schedules/${pendingSchedule.id}/confirm-condition`);
                          if (res.data.status === "completed") {
                            showToast("排程全部條件完成！", "success");
                          } else {
                            showToast(`已啟動下一條件：${res.data.sop_id}`, "success");
                          }
                          setPendingSchedule(null);
                        } catch (e) {
                          showToast(e.response?.data?.detail || "操作失敗", "error");
                        } finally {
                          setConfirmingSched(false);
                        }
                      }}
                      disabled={confirmingSched}
                      style={{
                        padding: "6px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                        background: isLast ? "#238636" : "#1f6feb",
                        color: "#fff", border: "none", fontWeight: 600,
                      }}
                    >
                      {confirmingSched ? "處理中..." : label}
                    </button>
                  </div>
                </div>
              </section>
            );
          })()}

          {!isActive && !isFinishing && (
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
                        conditionConfirmed: false,
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
                          conditionConfirmed: false,
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
                        updateDS(selectedDevice, { selectedTest: k, conditionConfirmed: false })
                      }
                    />
                  </>
                )}
                {testData && (
                  <>
                    <ConditionCard test={testData} />
                    {!ds.conditionConfirmed && (
                      <button
                        onClick={() => updateDS(selectedDevice, { conditionConfirmed: true })}
                        style={{
                          width: "100%",
                          marginTop: 12,
                          padding: "10px",
                          backgroundColor: "#238636",
                          color: "#fff",
                          border: "1px solid #2ea043",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        ✅ 確認選擇，進入安全確認
                      </button>
                    )}
                  </>
                )}
              </section>

              {testData && ds.conditionConfirmed && role !== "guest" && (
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

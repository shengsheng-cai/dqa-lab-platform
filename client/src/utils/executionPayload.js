/**
 * 組出要送給 POST /api/sop-executions/ 的執行紀錄。
 *
 * 有兩個地方會存執行紀錄：SOP 面板按下儲存，以及設備已經回到待機、面板卻沒接到
 * 通知時的補存。兩邊送的欄位必須一致——少送測試時間，報告撈不到那段感測資料；
 * 少送 manual_mode，後端會把除錯用的手動測試當成正式執行並誤發 LINE 推播。
 * 所以兩條路徑都從這裡取資料，不各自組一份。
 *
 * @param {object} p
 * @param {object} p.sop  進行中的 SOP，要有 sop_id 與 steps
 * @param {string} p.deviceId  設備編號
 * @param {string} [p.operator]  操作者，前後空白會去掉，沒填就送 null
 * @param {string} [p.startedAt]  測試開始時間（ISO 字串）
 * @param {boolean} [p.manualMode]  手動除錯模式，後端據此決定不推播
 * @param {object} [p.completedSteps]  step_id 對應到有沒有完成
 */
export function buildExecutionPayload({
  sop,
  deviceId,
  operator,
  startedAt,
  manualMode = false,
  completedSteps = {},
}) {
  return {
    sop_id: sop.sop_id,
    device_id: deviceId,
    operator: operator?.trim() || null,
    test_started_at: startedAt || null,
    test_ended_at: new Date().toISOString(),
    manual_mode: manualMode,
    steps: (sop.steps || []).map((s) => ({
      step_id: s.step_id,
      completed: !!completedSteps[s.step_id],
      parameters: null,
    })),
  };
}

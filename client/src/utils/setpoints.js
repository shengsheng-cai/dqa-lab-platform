// 一支測試條件有幾個溫度設定點，以及每個設定點該叫什麼。
//
// 標準資料用三個欄位表達三種形狀：熱測只填 high_temperature，冷測只填
// low_temperature（外加一個等值的 target_temperature），雙溫兩個都填。固定印
// 「高溫上限／低溫下限」兩列的話，冷測會多一列空的高溫、熱測會多一列空的低溫，
// 看起來像資料沒串進來。後端報告的 _setpoint_rows 是同一條規則。

/**
 * 回傳這支測試要交代的設定點 [{ label, short, value }]，冷熱由有沒有填高溫決定。
 *
 * 判斷冷熱不能看溫度正負：熱測有 +5°C 這種正值不高的，冷測也不保證是負值。
 *
 * 刻意不讀 target_temperature：冷測那個欄位只是 low_temperature 的複本，而排程頁的
 * 條件清單（schedules.py 的白名單）根本沒送它。退回去讀反而會讓兩個畫面不一致。
 */
export function setpointsOf(test) {
  if (!test) return [];
  const high = test.high_temperature;
  const low = test.low_temperature;

  // 長名給條件卡的欄位標籤，短名給一行摘要；兩個並列，不靠截字互相推導
  const HIGH = { label: "高溫上限", short: "高溫" };
  const LOW = { label: "低溫下限", short: "低溫" };

  // 兩端差距超過 0.1 才算雙溫，跟後端模擬器同一條判準（simulator.py 的 is_two_temp）
  if (high != null && low != null && Math.abs(high - low) > 0.1) {
    return [{ ...HIGH, value: high }, { ...LOW, value: low }];
  }

  const only = high != null ? high : low;
  if (only == null) return [];
  return [{ ...(high != null ? HIGH : LOW), value: only }];
}

/** 條件清單那種一行摘要用的短字串，例如「高溫 70°C / 低溫 -25°C」。 */
export function setpointSummary(test) {
  return setpointsOf(test)
    .map(({ short, value }) => `${short} ${value}°C`)
    .join(" / ");
}

export function conditionLabel(schedule, prefix = "") {
  const idx = schedule.current_condition_index ?? 0;
  const total = (schedule.conditions || []).length;
  const isLast = idx >= total;
  return { idx, total, label: `${prefix}${isLast ? "✅ 確認完成" : `▶ 第 ${idx + 1}/${total} 條件`}` };
}

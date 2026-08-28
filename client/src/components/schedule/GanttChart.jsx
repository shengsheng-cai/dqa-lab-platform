import { C } from "../../styles/theme";
import { btnBare } from "../../styles/common";
import { useRef, useEffect } from "react";
import { DEVICE_IDS, parseUtcDate } from "../../constants";
import { HOUR_PX, DAY_PX, ROW_H, HEADER_H, LABEL_W, STATUS_COLOR, fmtDt } from "./scheduleUtils";

export default function GanttChart({ schedules, blockedPeriods, rangeStart, rangeEnd, onClickSchedule }) {
  // range 使用 epoch 毫秒，API 時間先經 parseUtcDate；所有區塊共用同一條時間軸，
  // 日期刻度則以瀏覽器本地午夜切日，避免日期欄和使用者看到的本地日期錯位。
  const scrollRef = useRef(null);
  const totalMs = rangeEnd - rangeStart;
  const totalPx = (totalMs / 3600000) * HOUR_PX;

  useEffect(() => {
    if (scrollRef.current) {
      // 現在時間左側保留 200px，讓使用者能同時看到剛發生的排程。
      const nowOffset = ((Date.now() - rangeStart) / 3600000) * HOUR_PX - 200;
      scrollRef.current.scrollLeft = Math.max(0, nowOffset);
    }
  }, [rangeStart]);

  const dayTicks = [];
  let cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < rangeEnd) {
    dayTicks.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  function toPx(dt) {
    return ((parseUtcDate(dt) - rangeStart) / 3600000) * HOUR_PX;
  }

  const nowLeft = toPx(new Date());

  return (
    <div style={{ border: "1px solid #30363d", borderRadius: 8, overflow: "hidden", background: "#0d1117" }}>
      <div style={{ display: "flex" }}>
        <div style={{ width: LABEL_W, flexShrink: 0, background: "#0d1117", zIndex: 2, borderRight: "1px solid #30363d" }}>
          <div style={{ height: HEADER_H, borderBottom: "1px solid #30363d" }} />
          {DEVICE_IDS.map((id) => (
            <div
              key={id}
              style={{
                height: ROW_H,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderBottom: "1px solid #21262d",
                fontSize: 12, fontWeight: 700, color: "#8b949e",
                fontFamily: "monospace",
              }}
            >
              {id}
            </div>
          ))}
        </div>

        <div ref={scrollRef} style={{ overflowX: "auto", flex: 1 }}>
          <div style={{ width: totalPx, position: "relative", minWidth: "100%", height: HEADER_H + DEVICE_IDS.length * ROW_H }}>

            <div style={{ height: HEADER_H, position: "relative", borderBottom: "1px solid #30363d" }}>
              {dayTicks.map((day) => {
                const left = toPx(day);
                const isToday = day.toDateString() === new Date().toDateString();
                return (
                  <div
                    key={day.toISOString()}
                    style={{
                      position: "absolute", left, top: 0,
                      width: DAY_PX, height: HEADER_H,
                      display: "flex", alignItems: "center",
                      paddingLeft: 6, fontSize: 11,
                      color: isToday ? "#58a6ff" : "#484f58",
                      fontWeight: isToday ? 700 : 400,
                      borderLeft: "1px solid #21262d",
                      boxSizing: "border-box",
                    }}
                  >
                    {`${day.getMonth() + 1}/${day.getDate()}`}
                    {isToday && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: "#58a6ff" }}>今天</span>
                    )}
                  </div>
                );
              })}
              {dayTicks.map((day) =>
                [6, 12, 18].map((h) => {
                  const left = toPx(new Date(day.getTime() + h * 3600000));
                  return (
                    <div
                      key={`${day.toISOString()}-${h}`}
                      style={{
                        position: "absolute", left, top: HEADER_H - 8,
                        width: 1, height: 8, background: "#30363d",
                      }}
                    />
                  );
                })
              )}
            </div>

            {DEVICE_IDS.map((deviceId, rowIdx) => {
              const rowTop = HEADER_H + rowIdx * ROW_H;
              const deviceSchedules = schedules.filter((s) => s.device_id === deviceId && s.start_time && s.end_time);
              const deviceBlocked = blockedPeriods.filter((b) => b.device_id === deviceId);

              return (
                <div
                  key={deviceId}
                  style={{
                    position: "absolute", top: rowTop, left: 0, right: 0,
                    height: ROW_H, borderBottom: "1px solid #21262d",
                  }}
                >
                  {dayTicks.map((day) => (
                    <div
                      key={day.toISOString()}
                      style={{
                        position: "absolute",
                        left: toPx(day), top: 0, width: 1, height: ROW_H,
                        background: "#161b22",
                      }}
                    />
                  ))}

                  {nowLeft >= 0 && nowLeft <= totalPx && (
                    <div style={{
                      position: "absolute", left: nowLeft, top: 0,
                      width: 1, height: ROW_H, background: "#58a6ff",
                      opacity: 0.5, zIndex: 1,
                    }} />
                  )}

                  {deviceBlocked.map((b) => {
                    const left = Math.max(0, toPx(b.start_time));
                    const right = Math.min(totalPx, toPx(b.end_time));
                    if (right <= left) return null;
                    return (
                      <div
                        key={b.id}
                        title={`不可用：${b.reason || "未說明"}\n${fmtDt(b.start_time)} → ${fmtDt(b.end_time)}`}
                        style={{
                          position: "absolute", left, top: 4,
                          width: right - left, height: ROW_H - 8,
                          background: `repeating-linear-gradient(135deg, ${C.errorSurface} 0px, ${C.errorSurface} 6px, ${C.errorSurfaceDark} 6px, ${C.errorSurfaceDark} 12px)`,
                          border: "1px solid #6e1b1b",
                          borderRadius: 3, opacity: 0.7, zIndex: 1,
                        }}
                      />
                    );
                  })}

                  {deviceSchedules.map((s) => {
                    const left = toPx(s.start_time);
                    const right = toPx(s.end_time);
                    if (right <= 0 || left >= totalPx) return null;
                    // 跨出查詢範圍的排程仍顯示可見部分，不讓區塊溢出時間軸。
                    const clampLeft = Math.max(0, left);
                    const clampRight = Math.min(totalPx, right);
                    const color = STATUS_COLOR[s.status] || STATUS_COLOR["待審核"];
                    const blockW = clampRight - clampLeft;
                    // 區塊夠寬時畫面會多顯示條件進度，名稱要含得住看得到的字
                    const progress = s.status === "進行中" && (s.conditions?.length ?? 0) > 1
                      ? ` (${(s.current_condition_index ?? 0) + 1}/${s.conditions.length})`
                      : "";
                    // title 只在滑鼠 hover 時出現，鍵盤聚焦不會觸發，所以同一份內容用 aria-label 再給一次
                    return (
                      <button
                        key={s.id}
                        onClick={() => onClickSchedule(s)}
                        title={`${s.project_number} / ${s.sample_name}\n${s.status}\n${fmtDt(s.start_time)} → ${fmtDt(s.end_time)}`}
                        aria-label={`${s.project_number} ${s.sample_name}${progress}，${s.status}，${fmtDt(s.start_time)} 到 ${fmtDt(s.end_time)}`}
                        style={{
                          ...btnBare,
                          position: "absolute", left: clampLeft, top: 6,
                          width: Math.max(blockW, 4), height: ROW_H - 12,
                          background: color.bg,
                          border: `1px solid ${color.border}`,
                          borderRadius: 4, zIndex: 2,
                          overflow: "hidden",
                          display: "flex", alignItems: "center",
                          padding: "0 0 0 5px",
                        }}
                      >
                        {blockW > 30 && (
                          <span style={{
                            fontSize: 10, color: color.text,
                            whiteSpace: "nowrap", overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontWeight: 600,
                          }}>
                            {s.project_number} {s.sample_name}{progress}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            <div style={{ height: HEADER_H + DEVICE_IDS.length * ROW_H }} />
          </div>
        </div>
      </div>
    </div>
  );
}

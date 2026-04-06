import { } from "react";

// 純 select 日期選擇器，value 格式 YYYY-MM-DD
export default function DatePicker({ value, onChange, style }) {
  const now = new Date();
  const curYear = now.getFullYear();
  const year  = value ? parseInt(value.slice(0, 4))  : curYear;
  const month = value ? parseInt(value.slice(5, 7))  : now.getMonth() + 1;
  const day   = value ? parseInt(value.slice(8, 10)) : now.getDate();

  const emit = (y, mo, d) => {
    const pad = (n) => String(n).padStart(2, "0");
    const maxDay = new Date(y, mo, 0).getDate();
    const safeDay = Math.min(Number(d), maxDay);
    onChange(`${y}-${pad(mo)}-${pad(safeDay)}`);
  };

  const years  = [curYear - 1, curYear, curYear + 1, curYear + 2];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days   = Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1);
  const lbl    = { color: "#6e7681", fontSize: 11 };
  const sel    = { ...style, padding: "4px 4px" };

  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      <select value={year}  onChange={(e) => emit(e.target.value, month, day)} style={{ ...sel, width: 64 }}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <span style={lbl}>年</span>
      <select value={month} onChange={(e) => emit(year, e.target.value, day)} style={{ ...sel, width: 44 }}>
        {months.map((mo) => <option key={mo} value={mo}>{String(mo).padStart(2, "0")}</option>)}
      </select>
      <span style={lbl}>月</span>
      <select value={day}   onChange={(e) => emit(year, month, e.target.value)} style={{ ...sel, width: 44 }}>
        {days.map((d) => <option key={d} value={d}>{String(d).padStart(2, "0")}</option>)}
      </select>
      <span style={lbl}>日</span>
    </div>
  );
}

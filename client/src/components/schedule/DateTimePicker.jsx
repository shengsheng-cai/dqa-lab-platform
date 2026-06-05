export default function DateTimePicker({ value, onChange, style }) {
  const now = new Date();
  const curYear = now.getFullYear();

  const year  = value ? parseInt(value.slice(0, 4))  : curYear;
  const month = value ? parseInt(value.slice(5, 7))  : now.getMonth() + 1;
  const day   = value ? parseInt(value.slice(8, 10)) : now.getDate();
  const h     = value && value.length >= 16 ? value.slice(11, 13) : "09";
  const m     = value && value.length >= 16 ? value.slice(14, 16) : "00";

  const emit = (y, mo, d, hh, mm) => {
    const pad = (n) => String(n).padStart(2, "0");
    const maxDay = new Date(y, mo, 0).getDate();
    const safeDay = Math.min(Number(d), maxDay);
    onChange(`${y}-${pad(mo)}-${pad(safeDay)}T${pad(hh)}:${pad(mm)}`);
  };

  const years   = [curYear - 1, curYear, curYear + 1, curYear + 2];
  const months  = Array.from({ length: 12 }, (_, i) => i + 1);
  const days    = Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1);
  const hours   = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  const sel = { ...style, padding: "4px 4px" };
  const lbl = { color: "#6e7681", fontSize: 11 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        <select value={year}  onChange={(e) => emit(e.target.value, month, day, h, m)} style={{ ...sel, width: 64 }}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={lbl}>年</span>
        <select value={month} onChange={(e) => emit(year, e.target.value, day, h, m)} style={{ ...sel, width: 44 }}>
          {months.map((mo) => <option key={mo} value={mo}>{String(mo).padStart(2, "0")}</option>)}
        </select>
        <span style={lbl}>月</span>
        <select value={day}   onChange={(e) => emit(year, month, e.target.value, h, m)} style={{ ...sel, width: 44 }}>
          {days.map((d) => <option key={d} value={d}>{String(d).padStart(2, "0")}</option>)}
        </select>
        <span style={lbl}>日</span>
      </div>
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        <select value={h} onChange={(e) => emit(year, month, day, e.target.value, m)} style={{ ...sel, width: 50 }}>
          {hours.map((n) => <option key={n} value={String(n).padStart(2, "0")}>{String(n).padStart(2, "0")}</option>)}
        </select>
        <span style={lbl}>時</span>
        <select value={m} onChange={(e) => emit(year, month, day, h, e.target.value)} style={{ ...sel, width: 50 }}>
          {minutes.map((n) => <option key={n} value={String(n).padStart(2, "0")}>{String(n).padStart(2, "0")}</option>)}
        </select>
        <span style={lbl}>分</span>
      </div>
    </div>
  );
}

// SP 波形計算（純函式）
import { parseUtcDate } from "../../constants";

export function fmtMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function toElapsedMin(startedAt, fullTime) {
  if (!startedAt || !fullTime) return null;
  try {
    return Math.round((parseUtcDate(fullTime) - parseUtcDate(startedAt)) / 60000);
  } catch {
    return null;
  }
}

export function generateSP(sop) {
  if (!sop) return [];
  const ramp = sop.ramp_rate || 1;
  const high = sop.high_temperature ?? sop.target_temperature ?? 25;
  const low = sop.low_temperature ?? null;
  const dwell = (sop.dwell_time_hours || 1) * 60;
  const cycles = sop.cycles || 1;
  const ambientTemp = 25;
  const humiVal = sop.humidity_rh_percent ?? null;

  const pts = [];
  let t = 0;

  const pushRamp = (from, to) => {
    if (from === to) return; // ← 加這行
    const steps = Math.max(1, Math.round(Math.abs(to - from) / ramp));
    for (let i = 1; i <= steps; i++) {
      pts.push({ min: t, sp_temp: from + (to - from) * (i / steps) });
      t++;
    }
  };
  const pushDwell = (temp, duration) => {
    for (let i = 0; i < duration; i++) {
      pts.push({ min: t, sp_temp: temp });
      t++;
    }
  };

  if (low !== null && low < ambientTemp) {
    pushRamp(ambientTemp, low);
    if (Math.abs(high - low) < 0.1) {
      // 單溫冷測（high == low）：只有一段 dwell，對齊狀態機行為
      pushDwell(low, dwell);
    } else {
      for (let c = 0; c < cycles; c++) {
        pushRamp(low, high);
        pushDwell(high, dwell);
        pushRamp(high, low);
        pushDwell(low, dwell);
      }
    }
    pushRamp(low, ambientTemp);
  } else if (low !== null) {
    pushRamp(ambientTemp, high);
    for (let c = 0; c < cycles; c++) {
      pushDwell(high, dwell);
      pushRamp(high, low);
      pushDwell(low, dwell);
      if (c < cycles - 1) pushRamp(low, high);
    }
    pushRamp(low, ambientTemp);
  } else {
    pushRamp(ambientTemp, high);
    pushDwell(high, dwell);
    pushRamp(high, ambientTemp);
  }

  return pts.map((p) => ({
    ...p,
    sp_temp: Math.round(p.sp_temp * 10) / 10,
    sp_humi: p.sp_temp < 0 ? null : humiVal,
    label: fmtMin(p.min),
  }));
}

export function mergeSpPv(spData, pvData) {
  const map = {};
  spData.forEach((p) => {
    map[p.min] = { ...p };
  });
  const spMins = spData.map((p) => p.min);
  const spMaxMin = spMins.length > 0 ? Math.max(...spMins) : 0;
  pvData.forEach((p) => {
    if (p.min == null) return;
    const minKey = Math.round(p.min);
    if (spMins.length > 0 && minKey <= spMaxMin + 2) {
      // SP 範圍內：找最近的 SP 時間點附著
      const nearest = spMins.reduce((a, b) =>
        Math.abs(b - minKey) < Math.abs(a - minKey) ? b : a,
      );
      map[nearest].pv_temp = p.temperature;
      map[nearest].pv_humi = p.humidity;
    } else {
      // 超出 SP 結尾：建新時間槽，SP 值為 null
      if (!map[minKey]) {
        map[minKey] = { min: minKey, sp_temp: null, sp_humi: null, label: String(minKey) };
      }
      map[minKey].pv_temp = p.temperature;
      map[minKey].pv_humi = p.humidity;
    }
  });
  return Object.values(map).sort((a, b) => a.min - b.min);
}

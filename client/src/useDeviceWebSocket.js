import { useEffect, useRef, useState, useCallback } from "react";
import { DEVICE_IDS } from "./constants";
import api, { WS_BASE } from "./api";

const WS_TICKET_PROTOCOL_PREFIX = "dqa-ws-ticket.";

const OFFLINE_DEVICES = DEVICE_IDS.map((id) => ({
  device_id: id,
  status: "OFFLINE",
  temperature: null,
}));

export function useDeviceWebSocket() {
  const [devices, setDevices] = useState(OFFLINE_DEVICES);
  const [connected, setConnected] = useState(false);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const wsRef = useRef(null);
  const retryDelay = useRef(1000);
  // 每次掛載給一個編號，卸載時 +1。還在等 ticket 的請求和排隊中的重連拿舊編號一比就知道
  // 自己已經過期，該收手。少了這個，「卸載後馬上又掛回來」（開發模式每次載入都會做一次）
  // 會讓上一輪的連線照樣建起來，而 wsRef 只留得住最後一條，前一條就沒人關了。
  const generation = useRef(0);
  const lastJsonRef = useRef(null);
  const connectRef = useRef(null);

  // 拿不到 ticket 和連線斷掉都走這條：等一下再試，每次等久一倍，最多 30 秒。
  const scheduleReconnect = useCallback((myGeneration) => {
    if (myGeneration !== generation.current) return;
    const delay = retryDelay.current;
    retryDelay.current = Math.min(delay * 2, 30000);
    setTimeout(() => {
      if (myGeneration === generation.current) connectRef.current?.();
    }, delay);
  }, []);

  const connect = useCallback(async () => {
    const myGeneration = generation.current;

    let ticket;
    try {
      const response = await api.post("/api/auth/ws-ticket");
      ticket = response.data.ticket;
    } catch {
      scheduleReconnect(myGeneration);
      return;
    }

    if (myGeneration !== generation.current) return;
    const ws = new WebSocket(
      `${WS_BASE}/ws/devices`,
      `${WS_TICKET_PROTOCOL_PREFIX}${ticket}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryDelay.current = 1000;
    };

    ws.onmessage = (e) => {
      try {
        const nextDevices = JSON.parse(e.data);
        setSnapshotReady(true);
        if (e.data === lastJsonRef.current) return;
        lastJsonRef.current = e.data;
        setDevices(nextDevices);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setSnapshotReady(false);
      scheduleReconnect(myGeneration);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [scheduleReconnect]);

  useEffect(() => {
    connectRef.current = connect;
    connect();
    return () => {
      generation.current += 1;
      retryDelay.current = 1000;
      wsRef.current?.close();
    };
  }, [connect]);

  return { devices, connected, devicesReady: connected && snapshotReady };
}

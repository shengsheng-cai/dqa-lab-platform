import { useEffect, useRef, useState, useCallback } from "react";
import { DEVICE_IDS } from "./constants";
import { WS_BASE } from "./api";

function getToken() {
  return localStorage.getItem("user_token") || localStorage.getItem("demo_password") || "";
}

const OFFLINE_DEVICES = DEVICE_IDS.map((id) => ({
  device_id: id,
  status: "OFFLINE",
  temperature: null,
}));

export function useDeviceWebSocket() {
  const [devices, setDevices] = useState(OFFLINE_DEVICES);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const retryDelay = useRef(1000);
  const unmounted = useRef(false);
  const lastJsonRef = useRef(null);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const token = getToken();
    const url = `${WS_BASE}/ws/devices${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryDelay.current = 1000;
    };

    ws.onmessage = (e) => {
      try {
        if (e.data === lastJsonRef.current) return;
        lastJsonRef.current = e.data;
        setDevices(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (!unmounted.current) {
        const delay = retryDelay.current;
        retryDelay.current = Math.min(delay * 2, 30000);
        setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      retryDelay.current = 1000;
      wsRef.current?.close();
    };
  }, [connect]);

  return { devices, connected };
}

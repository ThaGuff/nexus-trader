import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
})();

export function useTraderSocket() {
  const [connected, setConnected] = useState(false);
  const [state, setState]   = useState(null);
  const [prices, setPrices] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log('[WS] Connected');
        if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.state)  setState(msg.state);
          if (msg.prices) setPrices(msg.prices);
          if (msg.lastUpdated) setLastUpdated(msg.lastUpdated);
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[WS] Disconnected, reconnecting in 3s...');
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    } catch (e) {
      console.error('[WS] Connection error:', e);
      reconnectRef.current = setTimeout(connect, 5000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { connected, state, prices, lastUpdated };
}

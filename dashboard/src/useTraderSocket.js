import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
})();

export function useTraderSocket() {
  const [connected, setConnected]   = useState(false);
  const [state, setState]           = useState(null);
  const [prices, setPrices]         = useState({});
  const [botLog, setBotLog]         = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const wsRef       = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen  = () => {
        setConnected(true);
        if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.state)       setState(msg.state);
          if (msg.prices)      setPrices(msg.prices);
          if (msg.botLog)      setBotLog(msg.botLog);
          if (msg.lastUpdated) setLastUpdated(msg.lastUpdated);
          if (msg.type === 'INIT')         { if(msg.state)setState(msg.state); if(msg.prices)setPrices(msg.prices); if(msg.botLog)setBotLog(msg.botLog); }
          if (msg.type === 'UPDATE')       { if(msg.state)setState(msg.state); if(msg.prices)setPrices(msg.prices); if(msg.botLog)setBotLog(msg.botLog); if(msg.lastUpdated)setLastUpdated(msg.lastUpdated); }
          if (msg.type === 'PRICES')       setPrices(msg.prices);
        } catch {}
      };
      ws.onclose = () => { setConnected(false); reconnectRef.current = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    } catch { reconnectRef.current = setTimeout(connect, 5000); }
  }, []);

  useEffect(() => {
    connect();
    return () => { if(wsRef.current)wsRef.current.close(); if(reconnectRef.current)clearTimeout(reconnectRef.current); };
  }, [connect]);

  return { connected, state, prices, botLog, lastUpdated };
}

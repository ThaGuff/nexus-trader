/**
 * NEXUS TRADER · Server v2
 * Express + WebSocket with full control API
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.DASHBOARD_SECRET || 'nexus-secret';

const app  = express();
const http = createServer(app);
const wss  = new WebSocketServer({ server: http });

app.use(express.json());

const dashPath = path.join(__dirname, '../../dashboard/dist');
app.use(express.static(dashPath));

let botModule = null;
export function setBotModule(mod) { botModule = mod; }

// ── REST API ────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.get('/api/state', (_, res) => {
  if (!botModule) return res.json({ state: {}, prices: {}, botLog: [] });
  res.json({ state: botModule.getState(), prices: botModule.getPrices(), botLog: botModule.getBotLog() });
});

app.post('/api/control', (req, res) => {
  const { action, secret, value, maxLeverage } = req.body;
  if (secret !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!botModule) return res.status(503).json({ error: 'Bot not ready' });

  switch (action) {
    case 'start':    botModule.startBot();                        return res.json({ ok: true, action: 'started' });
    case 'stop':     botModule.stopBot();                         return res.json({ ok: true, action: 'stopped' });
    case 'reset':    botModule.forceReset();                      return res.json({ ok: true, action: 'reset' });
    case 'run_once': botModule.runOnce();                         return res.json({ ok: true, action: 'run_once' });
    case 'leverage': botModule.toggleLeverage(!!value, maxLeverage); return res.json({ ok: true, action: 'leverage', value: !!value });
    default:         return res.status(400).json({ error: 'Unknown action' });
  }
});

app.get('*', (_, res) => {
  const idx = path.join(dashPath, 'index.html');
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.json({ status: 'Dashboard not built' });
});

// ── WebSocket ────────────────────────────────────────────────────────────────
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  // Send current state on connect
  if (botModule) {
    try {
      ws.send(JSON.stringify({
        type: 'INIT',
        state: botModule.getState(),
        prices: botModule.getPrices(),
        botLog: botModule.getBotLog(),
        lastUpdated: new Date().toISOString(),
      }));
    } catch {}
  }
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

export function broadcastUpdate(data) {
  const msg = JSON.stringify({ type: 'UPDATE', ...data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch {}
    }
  }
}

export function startServer() {
  http.listen(PORT, () => {
    console.log(`[Server] http://localhost:${PORT}`);
  });
}

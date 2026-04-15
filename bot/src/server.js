/**
 * NEXUS TRADER · Dashboard Server
 * Express HTTP + WebSocket server
 * Serves the React dashboard and provides real-time data via WebSocket
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SECRET = process.env.DASHBOARD_SECRET || 'nexus-default-secret';

const app  = express();
const http = createServer(app);
const wss  = new WebSocketServer({ server: http });

app.use(express.json());

// Serve built dashboard
const dashPath = path.join(__dirname, '../../dashboard/dist');
app.use(express.static(dashPath));

// ── REST API ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.get('/api/state', async (req, res) => {
  try {
    const { getState, getPrices } = await import('./bot.js');
    res.json({ state: getState(), prices: getPrices() });
  } catch {
    res.json({ state: {}, prices: {} });
  }
});

app.post('/api/control', (req, res) => {
  const { action, secret } = req.body;
  if (secret !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!botModule) return res.status(503).json({ error: 'Bot not initialized' });

  if (action === 'start')  { botModule.startBot();  res.json({ ok: true, action: 'started' }); }
  else if (action === 'stop')  { botModule.stopBot();  res.json({ ok: true, action: 'stopped' }); }
  else if (action === 'reset') { botModule.forceReset(); res.json({ ok: true, action: 'reset' }); }
  else res.status(400).json({ error: 'Unknown action' });
});

// Fallback to dashboard for SPA routing
app.get('*', (req, res) => {
  const index = path.join(dashPath, 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.json({ status: 'Dashboard not built yet. Run: cd dashboard && npm run build' });
});

// ── WebSocket ────────────────────────────────────────────────────────────────
const clients = new Set();

// Bot module reference — set after bot starts
let botModule = null;
export function setBotModule(mod) { botModule = mod; }

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected. Total: ${clients.size}`);

  // Send current state immediately on connect
  if (botModule && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'INIT',
      state: botModule.getState(),
      prices: botModule.getPrices(),
      lastUpdated: new Date().toISOString(),
    }));
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', () => clients.delete(ws));
});

export function broadcastUpdate(data) {
  const msg = JSON.stringify({ type: 'UPDATE', ...data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg); } catch {}
    }
  }
}

export function startServer() {
  http.listen(PORT, () => {
    console.log(`[Server] Dashboard running on http://localhost:${PORT}`);
    console.log(`[Server] WebSocket ready on ws://localhost:${PORT}`);
  });
}

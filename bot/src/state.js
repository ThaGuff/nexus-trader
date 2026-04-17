/**
 * NEXUS TRADER · State Manager v3
 * Settings now persist to disk — survive restarts
 */

import fs from 'fs';
import path from 'path';

const STATE_DIR  = process.env.RAILWAY_VOLUME_MOUNT_PATH || './data';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const LOG_FILE   = path.join(STATE_DIR, 'botlog.json');

function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function getDefaultState() {
  return {
    // Capital
    balance:         parseFloat(process.env.STARTING_BALANCE || '100'),
    startingBalance: parseFloat(process.env.STARTING_BALANCE || '100'),
    // Portfolio
    portfolio:  {},
    trades:     [],
    cycleCount: 0,
    totalFeesUSD: 0,
    peakValue:  parseFloat(process.env.STARTING_BALANCE || '100'),
    // Status
    mode:       process.env.TRADING_MODE || 'PAPER',
    startedAt:  new Date().toISOString(),
    lastCycleAt: null,
    status:     'idle',
    // Settings — persisted so they survive restarts
    settings: {
      maxTradeUSD:     parseFloat(process.env.MAX_TRADE_USD    || '20'),
      stopLossPct:     parseFloat(process.env.STOP_LOSS_PCT    || '0.05'),
      takeProfitPct:   parseFloat(process.env.TAKE_PROFIT_PCT  || '0.08'),
      maxDrawdownPct:  parseFloat(process.env.MAX_DRAWDOWN_PCT || '0.20'),
      leverageEnabled: process.env.LEVERAGE_ENABLED === 'true',
      maxLeverage:     parseInt(process.env.MAX_LEVERAGE || '5'),
      startingBalance: parseFloat(process.env.STARTING_BALANCE || '100'),
    },
  };
}

export function loadState() {
  ensureDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      const defaults = getDefaultState();
      // Deep merge settings so new keys get defaults
      return {
        ...defaults,
        ...saved,
        settings: { ...defaults.settings, ...(saved.settings || {}) },
      };
    }
  } catch (e) {
    console.error('[State] Load failed, using defaults:', e.message);
  }
  return getDefaultState();
}

export function saveState(state) {
  ensureDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, trades: state.trades.slice(0, 500) }, null, 2));
  } catch (e) {
    console.error('[State] Save failed:', e.message);
  }
}

// ── Log ────────────────────────────────────────────────────────────────────
let memLog = [];

export function appendLog(entry) {
  memLog.unshift(entry);
  if (memLog.length > 300) memLog.pop();
  if (memLog.length % 10 === 0) {
    ensureDir();
    try { fs.writeFileSync(LOG_FILE, JSON.stringify(memLog, null, 2)); } catch {}
  }
}

export function getLog()  { return memLog; }
export function loadLog() {
  ensureDir();
  try { if (fs.existsSync(LOG_FILE)) memLog = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
  return memLog;
}

export function resetState() {
  const fresh = getDefaultState();
  fresh.startedAt = new Date().toISOString();
  saveState(fresh);
  memLog = [];
  return fresh;
}

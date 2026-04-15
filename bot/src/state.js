/**
 * NEXUS TRADER · State Manager
 * Persists portfolio, trades, and bot state to disk
 * On Railway: uses /data volume mount for persistence
 */

import fs from 'fs';
import path from 'path';

const STATE_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || './data';
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

const DEFAULT_STATE = {
  balance: parseFloat(process.env.STARTING_BALANCE || '100'),
  startingBalance: parseFloat(process.env.STARTING_BALANCE || '100'),
  portfolio: {},       // { BTC: { qty, avgCost, entryTime } }
  trades: [],          // last 500 trades
  cycleCount: 0,
  totalFeesUSD: 0,
  peakValue: parseFloat(process.env.STARTING_BALANCE || '100'),
  mode: process.env.TRADING_MODE || 'PAPER',
  startedAt: new Date().toISOString(),
  lastCycleAt: null,
  status: 'idle',      // idle | running | paused | error
};

export function loadState() {
  ensureDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('[State] Failed to load state, using defaults:', e.message);
  }
  return { ...DEFAULT_STATE };
}

export function saveState(state) {
  ensureDir();
  try {
    // Keep only last 500 trades in state file
    const trimmed = { ...state, trades: state.trades.slice(0, 500) };
    fs.writeFileSync(STATE_FILE, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    console.error('[State] Failed to save state:', e.message);
  }
}

export function resetState() {
  ensureDir();
  const fresh = { ...DEFAULT_STATE, startedAt: new Date().toISOString() };
  saveState(fresh);
  return fresh;
}

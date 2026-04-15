/**
 * NEXUS TRADER · Main Bot Orchestrator
 * Core trading loop — runs every N seconds
 */

import 'dotenv/config';
import { fetchPrices, buildMarketSummary, COINS } from './market.js';
import { getAIDecision, getRulesDecision, calcTotalValue } from './ai.js';
import { executeBuy, executeSell } from './executor.js';
import { loadState, saveState } from './state.js';
import { notify, notifyStart } from './notify.js';
import { broadcastUpdate } from './server.js';

const CYCLE_SECONDS = parseInt(process.env.CYCLE_INTERVAL_SECONDS || '60');
const USE_AI = !!process.env.ANTHROPIC_API_KEY;
const FEE = 0.006;

let state  = loadState();
let prices = {};
let cycleTimer = null;
let isRunning  = false;
let isCycling  = false;

console.log(`
╔══════════════════════════════════════════╗
║         NEXUS TRADER v2.0                ║
║   Autonomous Crypto Trading Engine       ║
╠══════════════════════════════════════════╣
║  Mode:    ${(state.mode + '                    ').slice(0,30)}║
║  Balance: $${(state.balance.toFixed(2) + '                   ').slice(0,29)}║
║  AI:      ${(USE_AI ? 'Claude Opus (live AI)' : 'Rules Engine (no API key)') + '         '}║
║  Cycle:   every ${CYCLE_SECONDS}s                      ║
╚══════════════════════════════════════════╝
`);

// ── Price refresh loop ─────────────────────────────────────────────────────
async function refreshPrices() {
  try {
    prices = await fetchPrices();
    broadcast();
  } catch (e) {
    console.error('[Bot] Price refresh failed:', e.message);
  }
}

// ── Main trading cycle ─────────────────────────────────────────────────────
async function tradingCycle() {
  if (isCycling) { console.log('[Bot] Cycle already running, skipping'); return; }
  isCycling = true;

  const cycleNum = ++state.cycleCount;
  state.lastCycleAt = new Date().toISOString();
  state.status = 'cycling';

  console.log(`\n[Bot] ═══ Cycle #${cycleNum} | Cash: $${state.balance.toFixed(2)} | Mode: ${state.mode} ═══`);

  try {
    // Ensure fresh prices
    if (Object.keys(prices).length === 0) {
      prices = await fetchPrices();
    }

    const totalValue = calcTotalValue(prices, state.portfolio, state.balance);

    // Update peak
    if (totalValue > state.peakValue) state.peakValue = totalValue;

    const marketSummary = buildMarketSummary(prices, state.portfolio, state.balance);
    console.log('[Bot] Market Summary:\n' + marketSummary);

    // ── Get decision ────────────────────────────────────────────────────────
    let decision;
    if (USE_AI) {
      try {
        console.log('[Bot] Querying Claude AI...');
        decision = await getAIDecision(marketSummary, prices, state.portfolio, state.balance, state);
        console.log(`[Bot] AI Decision: ${decision.action} ${decision.coin || ''} conf:${decision.confidence}/10`);
      } catch (e) {
        console.error('[Bot] AI failed, falling back to rules:', e.message);
        decision = getRulesDecision(prices, state.portfolio, state.balance, state);
      }
    } else {
      decision = getRulesDecision(prices, state.portfolio, state.balance, state);
      console.log(`[Bot] Rules Decision: ${decision.action} ${decision.coin || ''} conf:${decision.confidence}/10`);
    }

    console.log(`[Bot] Reasoning: ${decision.reasoning}`);

    // ── Execute ─────────────────────────────────────────────────────────────
    let tradeRecord = null;

    if (decision.action === 'BUY' && decision.coin) {
      const rawAmount = Math.min(decision.usdAmount || 10, state.balance, 20);
      if (rawAmount < 5 || state.balance < 5) {
        console.log('[Bot] Insufficient balance for minimum trade, skipping BUY');
      } else {
        const px = prices[decision.coin]?.price;
        if (!px) { console.log(`[Bot] No price for ${decision.coin}, skipping`); }
        else {
          const { qty, price, fee, gross, net } = await executeBuy(decision.coin, rawAmount, px);
          state.balance = +(state.balance - gross).toFixed(8);
          state.totalFeesUSD += fee;

          const existing = state.portfolio[decision.coin];
          if (existing) {
            const newQty = existing.qty + qty;
            const newAvg = (existing.qty * existing.avgCost + net) / newQty;
            state.portfolio[decision.coin] = { qty: newQty, avgCost: newAvg, entryTime: existing.entryTime };
          } else {
            state.portfolio[decision.coin] = { qty, avgCost: price, entryTime: new Date().toISOString() };
          }

          tradeRecord = {
            id: Date.now(), type: 'BUY', coin: decision.coin,
            qty, price, gross, fee, net, usdAmount: gross,
            confidence: decision.confidence, signals: decision.signals,
            reasoning: decision.reasoning, ts: new Date().toISOString(),
          };
          console.log(`[Bot] ✅ BUY ${qty.toFixed(6)} ${decision.coin} @ $${price.toFixed(4)} | $${gross.toFixed(2)} gross | fee $${fee.toFixed(3)}`);
        }
      }

    } else if (decision.action === 'SELL' && decision.coin) {
      const pos = state.portfolio[decision.coin];
      if (!pos) { console.log(`[Bot] No position in ${decision.coin} to sell`); }
      else {
        const px = prices[decision.coin]?.price;
        if (!px) { console.log(`[Bot] No price for ${decision.coin}, skipping`); }
        else {
          const { sellQty, price, fee, gross, netProceeds } = await executeSell(
            decision.coin, pos.qty, decision.sellPct || 0.5, px
          );
          const costBasis = sellQty * pos.avgCost;
          const pnl = netProceeds - costBasis;

          state.balance = +(state.balance + netProceeds).toFixed(8);
          state.totalFeesUSD += fee;

          const remaining = pos.qty - sellQty;
          if (remaining < 0.000001) {
            delete state.portfolio[decision.coin];
          } else {
            state.portfolio[decision.coin] = { ...pos, qty: remaining };
          }

          tradeRecord = {
            id: Date.now(), type: 'SELL', coin: decision.coin,
            qty: sellQty, price, gross, fee, netProceeds, pnl,
            confidence: decision.confidence, signals: decision.signals,
            reasoning: decision.reasoning, ts: new Date().toISOString(),
          };
          console.log(`[Bot] ✅ SELL ${sellQty.toFixed(6)} ${decision.coin} @ $${price.toFixed(4)} | Net $${netProceeds.toFixed(2)} | PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}`);
        }
      }

    } else {
      console.log(`[Bot] ⏸ HOLD — ${decision.reasoning?.slice(0, 80)}`);
      tradeRecord = {
        id: Date.now(), type: 'HOLD', coin: null,
        confidence: decision.confidence, signals: decision.signals,
        reasoning: decision.reasoning, ts: new Date().toISOString(),
      };
    }

    // Record trade
    if (tradeRecord) {
      state.trades.unshift(tradeRecord);
      if (state.trades.length > 500) state.trades.pop();
      if (tradeRecord.type !== 'HOLD') {
        const tv = calcTotalValue(prices, state.portfolio, state.balance);
        await notify(tradeRecord, tv);
      }
    }

  } catch (e) {
    console.error('[Bot] Cycle error:', e.message, e.stack);
    state.status = 'error';
  }

  state.status = 'running';
  saveState(state);
  broadcast();
  isCycling = false;
}

function broadcast() {
  const totalValue = calcTotalValue(prices, state.portfolio, state.balance);
  broadcastUpdate({
    state: {
      ...state,
      totalValue,
      pnl: totalValue - state.startingBalance,
      pnlPct: ((totalValue / state.startingBalance) - 1) * 100,
      drawdown: state.peakValue > 0 ? ((state.peakValue - totalValue) / state.peakValue) * 100 : 0,
    },
    prices,
    lastUpdated: new Date().toISOString(),
  });
}

export function startBot() {
  if (isRunning) return;
  isRunning = true;
  state.status = 'running';

  console.log('[Bot] Starting price refresh loop...');
  refreshPrices();
  setInterval(refreshPrices, 15000);

  console.log(`[Bot] Starting trading cycle every ${CYCLE_SECONDS}s...`);
  setTimeout(() => {
    tradingCycle();
    cycleTimer = setInterval(tradingCycle, CYCLE_SECONDS * 1000);
  }, 8000); // wait 8s for first price data

  notifyStart(state.mode, state.balance);
  saveState(state);
}

export function stopBot() {
  if (cycleTimer) clearInterval(cycleTimer);
  isRunning = false;
  state.status = 'stopped';
  saveState(state);
  console.log('[Bot] Bot stopped.');
}

export function getState() { return state; }
export function getPrices() { return prices; }
export function forceReset() {
  state = {
    balance: parseFloat(process.env.STARTING_BALANCE || '100'),
    startingBalance: parseFloat(process.env.STARTING_BALANCE || '100'),
    portfolio: {}, trades: [], cycleCount: 0,
    totalFeesUSD: 0, peakValue: parseFloat(process.env.STARTING_BALANCE || '100'),
    mode: process.env.TRADING_MODE || 'PAPER',
    startedAt: new Date().toISOString(), lastCycleAt: null, status: 'running',
  };
  saveState(state);
  broadcast();
}

/**
 * NEXUS TRADER · Bot Orchestrator v3
 * Smart caching — reduces Claude API calls by ~75%
 * Only calls AI when market conditions change meaningfully
 */

import 'dotenv/config';
import { fetchPrices, buildMarketSummary, computeIndicators, COINS } from './market.js';
import { getAIDecision, getRulesDecision, calcTotalValue } from './ai.js';
import { executeBuy, executeSell } from './executor.js';
import { loadState, saveState, appendLog, getLog, loadLog, resetState } from './state.js';
import { shouldCallAI, cacheDecision, getCachedDecision, getTokenStats, resetCache } from './cache.js';
import { notify, notifyStart } from './notify.js';
import { broadcastUpdate } from './server.js';

const CYCLE_SECONDS = parseInt(process.env.CYCLE_INTERVAL_SECONDS || '60');
const USE_AI = !!process.env.GEMINI_API_KEY;

let state      = loadState();
let prices     = {};
let cycleTimer = null;
let priceTimer = null;
let isRunning  = false;
let isCycling  = false;

loadLog();

function log(msg, level = 'INFO') {
  const entry = { ts: new Date().toISOString(), level, msg };
  console.log(`[${level}] ${msg}`);
  appendLog(entry);
}

function broadcast() {
  const totalValue = calcTotalValue(prices, state.portfolio, state.balance);
  const tokenStats = getTokenStats();
  broadcastUpdate({
    state: {
      ...state,
      totalValue,
      pnl:        totalValue - state.startingBalance,
      pnlPct:     ((totalValue / state.startingBalance) - 1) * 100,
      drawdown:   state.peakValue > 0 ? ((state.peakValue - totalValue) / state.peakValue) * 100 : 0,
      tokenStats,
    },
    prices,
    botLog:      getLog().slice(0, 150),
    lastUpdated: new Date().toISOString(),
  });
}

async function refreshPrices() {
  try {
    prices = await fetchPrices();
    broadcast();
  } catch (e) {
    log(`Price refresh failed: ${e.message}`, 'ERROR');
  }
}

async function tradingCycle() {
  if (isCycling) return;
  isCycling = true;
  const n = ++state.cycleCount;
  state.lastCycleAt = new Date().toISOString();
  state.status = 'cycling';

  const totalValue = calcTotalValue(prices, state.portfolio, state.balance);
  log(`━━━ Cycle #${n} | Cash: $${state.balance.toFixed(2)} | Value: $${totalValue.toFixed(2)} ━━━`, 'CYCLE');

  try {
    if (Object.keys(prices).length === 0) {
      log('Fetching initial prices...', 'INFO');
      prices = await fetchPrices();
    }

    if (totalValue > state.peakValue) state.peakValue = totalValue;

    // Build indicators for all coins
    const indicators = {};
    for (const { symbol } of COINS) {
      indicators[symbol] = computeIndicators(symbol);
    }

    // Log market snapshot
    log(`Prices: ${COINS.map(c => prices[c.symbol] ? `${c.symbol}=$${prices[c.symbol].price.toFixed(2)}` : '').filter(Boolean).join(' ')}`, 'MARKET');

    // Log open positions
    for (const [sym, pos] of Object.entries(state.portfolio)) {
      const cur    = prices[sym]?.price || 0;
      const pnlPct = pos.avgCost > 0 ? ((cur - pos.avgCost) / pos.avgCost * 100) : 0;
      log(`Position ${sym}: ${pos.qty.toFixed(6)} units | avg $${pos.avgCost.toFixed(4)} | now $${cur.toFixed(4)} | PnL ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%${pos.leverage > 1 ? ` | ${pos.leverage}x LEV` : ''}`, 'POSITION');
    }

    const marketSummary = buildMarketSummary(prices, state.portfolio, state.balance);

    // ── Smart caching decision ─────────────────────────────────────────────
    let decision;
    let source = 'RULES';

    if (USE_AI) {
      const { shouldCall, reason } = shouldCallAI(prices, indicators, state.portfolio, state.balance);

      if (shouldCall) {
        log(`AI call triggered: ${reason}`, 'AI');
        try {
          decision = await getAIDecision(marketSummary, prices, state.portfolio, state.balance, state);
          cacheDecision(decision, prices, indicators);
          source = 'AI';
          log(`Claude decision: ${decision.action} ${decision.coin || ''} | Strategy: ${decision.strategy} | Conf: ${decision.confidence}/10`, 'AI');
        } catch (e) {
          log(`Claude API error: ${e.message} — using rules engine`, 'WARN');
          decision = getRulesDecision(prices, state.portfolio, state.balance, state);
          source = 'RULES_FALLBACK';
        }
      } else {
        // Use cache — check if rules engine wants to fire a stop/take-profit
        const rulesCheck = getRulesDecision(prices, state.portfolio, state.balance, state);
        if (['STOP_LOSS', 'TAKE_PROFIT'].includes(rulesCheck.strategy)) {
          decision = rulesCheck;
          source = 'RULES_TRIGGER';
          log(`Cache skipped — urgent ${rulesCheck.strategy} triggered by rules`, 'WARN');
        } else {
          decision = getCachedDecision() || { action: 'HOLD', coin: null, confidence: 4, strategy: 'HOLD', signals: ['CACHE_HIT'], reasoning: `Market stable. ${reason}. No new AI call needed.` };
          source = 'CACHE';
          log(`Using cached decision (${reason}) — no AI call needed`, 'INFO');
        }
      }
    } else {
      decision = getRulesDecision(prices, state.portfolio, state.balance, state);
      source = 'RULES';
    }

    log(`[${source}] ${decision.action} ${decision.coin || 'HOLD'} | Signals: ${(decision.signals||[]).join(', ')}`, 'SIGNAL');
    log(`Reasoning: ${decision.reasoning}`, 'REASONING');

    // ── Execute ────────────────────────────────────────────────────────────
    let tradeRecord = null;

    if (decision.action === 'BUY' && decision.coin) {
      const raw = Math.min(decision.usdAmount || 10, state.balance, 20);
      if (raw < 5 || state.balance < 5) {
        log(`Skipping BUY — insufficient balance ($${state.balance.toFixed(2)})`, 'WARN');
      } else {
        const px = prices[decision.coin]?.price;
        if (!px) {
          log(`No price for ${decision.coin} — skipping`, 'WARN');
        } else {
          const { qty, price, fee, gross, net } = await executeBuy(decision.coin, raw, px);
          const lev = (decision.isPerp && decision.leverage) ? decision.leverage : 1;
          state.balance = +(state.balance - gross).toFixed(8);
          state.totalFeesUSD += fee;
          const ex = state.portfolio[decision.coin];
          if (ex) {
            const nq = ex.qty + qty;
            state.portfolio[decision.coin] = { qty: nq, avgCost: (ex.qty * ex.avgCost + net) / nq, entryTime: ex.entryTime, leverage: lev, isPerp: decision.isPerp || false };
          } else {
            state.portfolio[decision.coin] = { qty, avgCost: price, entryTime: new Date().toISOString(), leverage: lev, isPerp: decision.isPerp || false };
          }
          tradeRecord = { id: Date.now(), type: 'BUY', coin: decision.coin, qty, price, gross, fee, net, leverage: lev, isPerp: decision.isPerp || false, strategy: decision.strategy, confidence: decision.confidence, signals: decision.signals, reasoning: decision.reasoning, source, ts: new Date().toISOString() };
          log(`✅ BUY ${qty.toFixed(6)} ${decision.coin} @ $${price.toFixed(4)} | $${gross.toFixed(2)} | fee $${fee.toFixed(3)}${lev > 1 ? ` | ${lev}x LEV` : ''}`, 'TRADE');
        }
      }

    } else if (decision.action === 'SELL' && decision.coin && state.portfolio[decision.coin]) {
      const pos = state.portfolio[decision.coin];
      const px  = prices[decision.coin]?.price;
      if (!px) {
        log(`No price for ${decision.coin} — skipping SELL`, 'WARN');
      } else {
        const { sellQty, price, fee, gross, netProceeds } = await executeSell(decision.coin, pos.qty, decision.sellPct || 0.5, px);
        const pnl    = (netProceeds - sellQty * pos.avgCost) * (pos.leverage || 1);
        state.balance = +(state.balance + netProceeds).toFixed(8);
        state.totalFeesUSD += fee;
        const remaining = pos.qty - sellQty;
        if (remaining < 0.000001) delete state.portfolio[decision.coin];
        else state.portfolio[decision.coin] = { ...pos, qty: remaining };
        tradeRecord = { id: Date.now(), type: 'SELL', coin: decision.coin, qty: sellQty, price, gross, fee, netProceeds, pnl, leverage: pos.leverage || 1, isPerp: pos.isPerp || false, strategy: decision.strategy, confidence: decision.confidence, signals: decision.signals, reasoning: decision.reasoning, source, ts: new Date().toISOString() };
        log(`✅ SELL ${sellQty.toFixed(6)} ${decision.coin} @ $${price.toFixed(4)} | Net $${netProceeds.toFixed(2)} | PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}`, pnl >= 0 ? 'PROFIT' : 'LOSS');
      }

    } else {
      log(`⏸ HOLD — ${decision.reasoning?.slice(0, 100)}`, 'HOLD');
      tradeRecord = { id: Date.now(), type: 'HOLD', coin: null, strategy: decision.strategy, confidence: decision.confidence, signals: decision.signals, reasoning: decision.reasoning, source, ts: new Date().toISOString() };
    }

    if (tradeRecord) {
      state.trades.unshift(tradeRecord);
      if (state.trades.length > 500) state.trades.pop();
      if (tradeRecord.type !== 'HOLD') {
        const tv = calcTotalValue(prices, state.portfolio, state.balance);
        log(`Portfolio after trade: $${tv.toFixed(2)} (${((tv/state.startingBalance-1)*100).toFixed(2)}% total return)`, 'INFO');
        await notify(tradeRecord, tv);
        resetCache(); // Force fresh AI analysis after any actual trade
      }
    }

  } catch (e) {
    log(`Cycle error: ${e.message}`, 'ERROR');
    console.error(e.stack);
  }

  state.status = 'running';
  saveState(state);
  broadcast();
  isCycling = false;
}

export function startBot() {
  if (isRunning) return;
  isRunning = true;
  state.status = 'running';
  log('▶ Bot started', 'SYSTEM');
  refreshPrices();
  priceTimer = setInterval(refreshPrices, 15000);
  setTimeout(() => {
    tradingCycle();
    cycleTimer = setInterval(tradingCycle, CYCLE_SECONDS * 1000);
  }, 8000);
  notifyStart(state.mode, state.balance);
  saveState(state);
}

export function stopBot() {
  if (cycleTimer) clearInterval(cycleTimer);
  if (priceTimer) clearInterval(priceTimer);
  isRunning = false;
  state.status = 'stopped';
  log('◼ Bot stopped by user', 'SYSTEM');
  saveState(state);
  broadcast();
}

export function forceReset() {
  stopBot();
  state = resetState();
  resetCache();
  state.status = 'idle';
  log('↺ Reset — $100 paper balance restored', 'SYSTEM');
  broadcast();
}

export function toggleLeverage(enabled, maxLev) {
  state.leverageEnabled = enabled;
  if (maxLev) state.maxLeverage = Math.max(2, Math.min(20, maxLev));
  log(`⚡ Leverage ${enabled ? `ENABLED (max ${state.maxLeverage}x)` : 'DISABLED'}`, 'SYSTEM');
  saveState(state);
  broadcast();
}

export function runOnce() {
  if (!isRunning) refreshPrices().then(() => setTimeout(tradingCycle, 2000));
  else tradingCycle();
}

export function getState()  { return state; }
export function getPrices() { return prices; }
export function getBotLog() { return getLog(); }

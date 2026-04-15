/**
 * NEXUS TRADER · Bot Orchestrator v2
 * Leverages full strategy suite, logs every decision step
 */

import 'dotenv/config';
import { fetchPrices, buildMarketSummary, COINS } from './market.js';
import { getAIDecision, getRulesDecision, calcTotalValue } from './ai.js';
import { executeBuy, executeSell } from './executor.js';
import { loadState, saveState, appendLog, getLog, loadLog, resetState, getDefaultState } from './state.js';
import { notify, notifyStart } from './notify.js';
import { broadcastUpdate } from './server.js';

const CYCLE_SECONDS = parseInt(process.env.CYCLE_INTERVAL_SECONDS || '60');
const USE_AI        = !!process.env.ANTHROPIC_API_KEY;

let state       = loadState();
let prices      = {};
let cycleTimer  = null;
let priceTimer  = null;
let isRunning   = false;
let isCycling   = false;

loadLog();

function log(msg, level = 'INFO') {
  const entry = { ts: new Date().toISOString(), level, msg };
  console.log(`[${level}] ${msg}`);
  appendLog(entry);
  broadcast();
}

console.log(`\n╔══════════════════════════════════════════╗
║         NEXUS TRADER v2.0                ║
║   Autonomous Crypto Trading Engine       ║
╠══════════════════════════════════════════╣
║  Mode:      ${(state.mode+'            ').slice(0,12)}              ║
║  Balance:   $${(state.balance.toFixed(2)+'           ').slice(0,12)}             ║
║  AI:        ${(USE_AI?'Claude Opus':'Rules Engine')+'            ').slice(0,14)}           ║
║  Leverage:  ${(state.leverageEnabled?'ENABLED':'DISABLED')+'            ').slice(0,12)}             ║
║  Cycle:     every ${CYCLE_SECONDS}s                    ║
╚══════════════════════════════════════════╝\n`);

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

  log(`━━━ Cycle #${n} | Cash: $${state.balance.toFixed(2)} | Value: $${calcTotalValue(prices, state.portfolio, state.balance).toFixed(2)} ━━━`, 'CYCLE');

  try {
    if (Object.keys(prices).length === 0) {
      log('No price data yet — fetching now...', 'WARN');
      prices = await fetchPrices();
    }

    const totalValue = calcTotalValue(prices, state.portfolio, state.balance);
    if (totalValue > state.peakValue) state.peakValue = totalValue;

    // Log current market snapshot
    log(`Market snapshot: ${COINS.map(c => prices[c.symbol] ? `${c.symbol}=$${prices[c.symbol].price.toFixed(2)}` : '').filter(Boolean).join(' | ')}`, 'MARKET');

    // Log open positions
    const posKeys = Object.keys(state.portfolio);
    if (posKeys.length > 0) {
      posKeys.forEach(sym => {
        const pos = state.portfolio[sym];
        const cur = prices[sym]?.price || 0;
        const pnlPct = pos.avgCost > 0 ? ((cur - pos.avgCost) / pos.avgCost * 100) : 0;
        log(`Position: ${sym} qty=${pos.qty.toFixed(6)} avg=$${pos.avgCost.toFixed(4)} now=$${cur.toFixed(4)} PnL=${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%${pos.leverage > 1 ? ` (${pos.leverage}x LEV)` : ''}`, 'POSITION');
      });
    } else {
      log('No open positions — scanning for entry opportunities', 'INFO');
    }

    const marketSummary = buildMarketSummary(prices, state.portfolio, state.balance);

    // Get decision
    let decision;
    if (USE_AI) {
      try {
        log('Querying Claude Opus AI for decision...', 'AI');
        decision = await getAIDecision(marketSummary, prices, state.portfolio, state.balance, state);
        log(`AI responded: ${decision.action} ${decision.coin || 'HOLD'} | Strategy: ${decision.strategy} | Confidence: ${decision.confidence}/10`, 'AI');
      } catch (e) {
        log(`Claude API error: ${e.message} — falling back to rules engine`, 'WARN');
        decision = getRulesDecision(prices, state.portfolio, state.balance, state);
      }
    } else {
      decision = getRulesDecision(prices, state.portfolio, state.balance, state);
      log(`Rules engine: ${decision.action} ${decision.coin || ''} | Strategy: ${decision.strategy} | Score: ${decision.confidence}/10`, 'RULES');
    }

    log(`Signals: ${(decision.signals || []).join(', ') || 'none'}`, 'SIGNAL');
    log(`Reasoning: ${decision.reasoning}`, 'REASONING');

    // Execute
    let tradeRecord = null;

    if (decision.action === 'BUY' && decision.coin) {
      const raw = Math.min(decision.usdAmount || 10, state.balance, 20);
      if (raw < 5 || state.balance < 5) {
        log(`Skipping BUY — insufficient balance ($${state.balance.toFixed(2)})`, 'WARN');
      } else {
        const px = prices[decision.coin]?.price;
        if (!px) {
          log(`No price available for ${decision.coin} — skipping`, 'WARN');
        } else {
          const { qty, price, fee, gross, net } = await executeBuy(decision.coin, raw, px);
          const lev = (decision.isPerp && decision.leverage) ? decision.leverage : 1;

          state.balance = +(state.balance - gross).toFixed(8);
          state.totalFeesUSD += fee;

          const existing = state.portfolio[decision.coin];
          if (existing) {
            const nq  = existing.qty + qty;
            const nav = (existing.qty * existing.avgCost + net) / nq;
            state.portfolio[decision.coin] = { qty: nq, avgCost: nav, entryTime: existing.entryTime, leverage: lev, isPerp: decision.isPerp || false };
          } else {
            state.portfolio[decision.coin] = { qty, avgCost: price, entryTime: new Date().toISOString(), leverage: lev, isPerp: decision.isPerp || false };
          }

          tradeRecord = {
            id: Date.now(), type: 'BUY', coin: decision.coin,
            qty, price, gross, fee, net,
            leverage: lev, isPerp: decision.isPerp || false,
            strategy: decision.strategy,
            confidence: decision.confidence, signals: decision.signals,
            reasoning: decision.reasoning, ts: new Date().toISOString(),
          };
          log(`✅ EXECUTED BUY: ${qty.toFixed(6)} ${decision.coin} @ $${price.toFixed(4)} | Spent $${gross.toFixed(2)} | Fee $${fee.toFixed(3)}${lev > 1 ? ` | ${lev}x LEVERAGE` : ''}`, 'TRADE');
        }
      }

    } else if (decision.action === 'SELL' && decision.coin && state.portfolio[decision.coin]) {
      const pos = state.portfolio[decision.coin];
      const px  = prices[decision.coin]?.price;
      if (!px) {
        log(`No price for ${decision.coin} — skipping SELL`, 'WARN');
      } else {
        const { sellQty, price, fee, gross, netProceeds } = await executeSell(decision.coin, pos.qty, decision.sellPct || 0.5, px);
        const costBasis = sellQty * pos.avgCost;
        const pnl       = netProceeds - costBasis;
        const lev       = pos.leverage || 1;
        const effPnl    = pnl * lev;

        state.balance = +(state.balance + netProceeds).toFixed(8);
        state.totalFeesUSD += fee;

        const remaining = pos.qty - sellQty;
        if (remaining < 0.000001) delete state.portfolio[decision.coin];
        else state.portfolio[decision.coin] = { ...pos, qty: remaining };

        tradeRecord = {
          id: Date.now(), type: 'SELL', coin: decision.coin,
          qty: sellQty, price, gross, fee, netProceeds,
          pnl: effPnl, leverage: lev, isPerp: pos.isPerp || false,
          strategy: decision.strategy,
          confidence: decision.confidence, signals: decision.signals,
          reasoning: decision.reasoning, ts: new Date().toISOString(),
        };
        log(`✅ EXECUTED SELL: ${sellQty.toFixed(6)} ${decision.coin} @ $${price.toFixed(4)} | Net $${netProceeds.toFixed(2)} | PnL ${effPnl >= 0 ? '+' : ''}$${effPnl.toFixed(4)}`, effPnl >= 0 ? 'PROFIT' : 'LOSS');
      }

    } else {
      log(`⏸ HOLD — ${decision.reasoning?.slice(0, 100)}`, 'HOLD');
      tradeRecord = {
        id: Date.now(), type: 'HOLD', coin: null,
        strategy: decision.strategy,
        confidence: decision.confidence, signals: decision.signals,
        reasoning: decision.reasoning, ts: new Date().toISOString(),
      };
    }

    if (tradeRecord) {
      state.trades.unshift(tradeRecord);
      if (state.trades.length > 500) state.trades.pop();
      if (tradeRecord.type !== 'HOLD') {
        const tv = calcTotalValue(prices, state.portfolio, state.balance);
        log(`Portfolio after trade: $${tv.toFixed(2)} (${((tv/state.startingBalance-1)*100).toFixed(2)}% all-time)`, 'INFO');
        await notify(tradeRecord, tv);
      }
    }

  } catch (e) {
    log(`Cycle error: ${e.message}`, 'ERROR');
    console.error(e.stack);
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
      pnl:      totalValue - state.startingBalance,
      pnlPct:   ((totalValue / state.startingBalance) - 1) * 100,
      drawdown: state.peakValue > 0 ? ((state.peakValue - totalValue) / state.peakValue) * 100 : 0,
    },
    prices,
    botLog: getLog().slice(0, 100),
    lastUpdated: new Date().toISOString(),
  });
}

export function startBot() {
  if (isRunning) { log('Bot already running', 'WARN'); return; }
  isRunning = true;
  state.status = 'running';
  log('▶ Bot started — initializing price feeds...', 'SYSTEM');
  refreshPrices();
  priceTimer = setInterval(refreshPrices, 15000);
  setTimeout(() => {
    log(`▶ First trading cycle starting (${USE_AI ? 'Claude AI' : 'Rules Engine'} mode)`, 'SYSTEM');
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
  state.status = 'idle';
  log('↺ Bot reset — $100 paper balance restored', 'SYSTEM');
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
  if (!isRunning) {
    refreshPrices().then(() => setTimeout(tradingCycle, 2000));
  } else {
    tradingCycle();
  }
}

export function getState()  { return state; }
export function getPrices() { return prices; }
export function getBotLog() { return getLog(); }

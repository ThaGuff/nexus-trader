/**
 * NEXUS TRADER · Bot Orchestrator v6
 * Settings now read from state.settings (persisted to disk)
 */

import 'dotenv/config';
import { fetchPrices, buildMarketSummary, computeIndicators, scoreForBuy, evaluateExit, COINS } from './market.js';
import { getAIDecision, getRulesDecision, calcTotalValue } from './ai.js';
import { loadState, saveState, appendLog, getLog, loadLog, resetState } from './state.js';
import { shouldCallAI, cacheDecision, getCachedDecision, getTokenStats, resetCache } from './cache.js';
import { notify, notifyStart } from './notify.js';
import { broadcastUpdate } from './server.js';

const CYCLE_SECONDS = parseInt(process.env.CYCLE_INTERVAL_SECONDS || '60');
const USE_AI        = !!process.env.GEMINI_API_KEY;

let state      = loadState();
let prices     = {};
let cycleTimer = null;
let priceTimer = null;
let isRunning  = false;
let isCycling  = false;

loadLog();

// Helper — get live settings from state (not env vars)
function getSettings() {
  return state.settings || {
    maxTradeUSD:     parseFloat(process.env.MAX_TRADE_USD    || '20'),
    stopLossPct:     parseFloat(process.env.STOP_LOSS_PCT    || '0.05'),
    takeProfitPct:   parseFloat(process.env.TAKE_PROFIT_PCT  || '0.08'),
    maxDrawdownPct:  parseFloat(process.env.MAX_DRAWDOWN_PCT || '0.20'),
    leverageEnabled: false,
    maxLeverage:     5,
    startingBalance: parseFloat(process.env.STARTING_BALANCE || '100'),
  };
}

function log(msg, level = 'INFO') {
  const entry = { ts: new Date().toISOString(), level, msg };
  console.log(`[${level}] ${msg}`);
  appendLog(entry);
}

function broadcast() {
  const settings    = getSettings();
  const totalValue  = calcTotalValue(prices, state.portfolio, state.balance);
  const tokenStats  = getTokenStats();
  broadcastUpdate({
    state: {
      ...state,
      totalValue,
      pnl:       totalValue - state.startingBalance,
      pnlPct:    ((totalValue / state.startingBalance) - 1) * 100,
      drawdown:  state.peakValue > 0 ? ((state.peakValue - totalValue) / state.peakValue) * 100 : 0,
      settings,  // always include current settings in broadcast
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

  const settings   = getSettings();
  const totalValue = calcTotalValue(prices, state.portfolio, state.balance);
  log(`━━━ Cycle #${n} | Cash $${state.balance.toFixed(2)} | Value $${totalValue.toFixed(2)} | MaxTrade $${settings.maxTradeUSD} | SL ${(settings.stopLossPct*100).toFixed(1)}% ━━━`, 'CYCLE');

  try {
    if (Object.keys(prices).length === 0) {
      log('Fetching initial prices...', 'INFO');
      prices = await fetchPrices();
    }

    if (totalValue > state.peakValue) state.peakValue = totalValue;

    // Log open positions with current settings
    for (const [sym, pos] of Object.entries(state.portfolio)) {
      const cur    = prices[sym]?.price || 0;
      const pnlPct = pos.avgCost > 0 ? ((cur - pos.avgCost) / pos.avgCost * 100) : 0;
      log(`Position ${sym}: ${pos.qty.toFixed(5)} @ avg $${pos.avgCost.toFixed(4)} | now $${cur.toFixed(4)} | PnL ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`, 'POSITION');
    }

    const marketSummary = buildMarketSummary(prices, state.portfolio);

    // ── Get decision ─────────────────────────────────────────────────────────
    let decision;
    let source = 'RULES';

    if (USE_AI) {
      const indicators = {};
      for (const { symbol } of COINS) indicators[symbol] = computeIndicators(symbol);
      const { shouldCall, reason } = shouldCallAI(prices, indicators, state.portfolio, state.balance);

      if (shouldCall) {
        log(`AI call triggered: ${reason}`, 'AI');
        try {
          decision = await getAIDecision(marketSummary, prices, state.portfolio, state.balance, { ...state, settings });
          cacheDecision(decision, prices, indicators);
          source = 'AI';
          log(`Gemini: ${decision.action} ${decision.coin||''} conf:${decision.confidence}/10`, 'AI');
        } catch (e) {
          log(`AI error: ${e.message} — rules fallback`, 'WARN');
          decision = getRulesDecision(prices, state.portfolio, state.balance, { ...state, settings });
          source = 'RULES_FALLBACK';
        }
      } else {
        const rulesCheck = getRulesDecision(prices, state.portfolio, state.balance, { ...state, settings });
        if (['STOP_LOSS','TAKE_PROFIT','TRAIL_STOP'].includes(rulesCheck.strategy)) {
          decision = rulesCheck; source = 'RULES_TRIGGER';
          log(`Cache bypassed — urgent ${rulesCheck.strategy}`, 'WARN');
        } else {
          decision = getCachedDecision() || rulesCheck;
          source = 'CACHE';
          log(`Cache hit (${reason}) — no AI call`, 'INFO');
        }
      }
    } else {
      decision = getRulesDecision(prices, state.portfolio, state.balance, { ...state, settings });
      source = 'RULES';
    }

    log(`[${source}] ${decision.action} ${decision.coin||'HOLD'} | ${decision.strategy} | Signals: ${(decision.signals||[]).join(', ')}`, 'SIGNAL');
    log(`Reasoning: ${decision.reasoning}`, 'REASONING');

    // ── Execute ───────────────────────────────────────────────────────────────
    const FEE = 0.006;
    let tradeRecord = null;

    if (decision.action === 'BUY' && decision.coin) {
      const raw = Math.min(decision.usdAmount || 10, state.balance, settings.maxTradeUSD);
      if (raw < 5 || state.balance < 5) {
        log(`Skipping BUY — balance $${state.balance.toFixed(2)} below minimum`, 'WARN');
      } else {
        const px  = prices[decision.coin]?.price;
        if (!px) { log(`No price for ${decision.coin}`, 'WARN'); }
        else {
          const fee = raw * FEE;
          const net = raw - fee;
          const qty = net / px;
          state.balance = +(state.balance - raw).toFixed(8);
          state.totalFeesUSD = (state.totalFeesUSD || 0) + fee;
          const ex = state.portfolio[decision.coin];
          if (ex) {
            const nq = ex.qty + qty;
            state.portfolio[decision.coin] = { qty: nq, avgCost: (ex.qty * ex.avgCost + net) / nq, entryTime: ex.entryTime };
          } else {
            state.portfolio[decision.coin] = { qty, avgCost: px, entryTime: new Date().toISOString() };
          }
          tradeRecord = { id:Date.now(), type:'BUY', coin:decision.coin, qty, price:px, gross:raw, fee, net, strategy:decision.strategy, confidence:decision.confidence, signals:decision.signals, reasoning:decision.reasoning, source, ts:new Date().toISOString() };
          log(`✅ BUY ${qty.toFixed(5)} ${decision.coin} @ $${px.toFixed(4)} | $${raw.toFixed(2)} | fee $${fee.toFixed(3)}`, 'TRADE');
        }
      }

    } else if (decision.action === 'SELL' && decision.coin && state.portfolio[decision.coin]) {
      const pos = state.portfolio[decision.coin];
      const px  = prices[decision.coin]?.price;
      if (!px) { log(`No price for ${decision.coin}`, 'WARN'); }
      else {
        const sellQty    = pos.qty * Math.min(decision.sellPct || 0.5, 1);
        const gross      = sellQty * px;
        const fee        = gross * FEE;
        const netProceeds = gross - fee;
        const pnl        = (netProceeds - sellQty * pos.avgCost) * (pos.leverage || 1);

        state.balance = +(state.balance + netProceeds).toFixed(8);
        state.totalFeesUSD = (state.totalFeesUSD || 0) + fee;
        const remaining = pos.qty - sellQty;
        if (remaining < 0.000001) delete state.portfolio[decision.coin];
        else state.portfolio[decision.coin] = { ...pos, qty: remaining };

        tradeRecord = { id:Date.now(), type:'SELL', coin:decision.coin, qty:sellQty, price:px, gross, fee, netProceeds, pnl, strategy:decision.strategy, confidence:decision.confidence, signals:decision.signals, reasoning:decision.reasoning, source, ts:new Date().toISOString() };
        log(`✅ SELL ${sellQty.toFixed(5)} ${decision.coin} @ $${px.toFixed(4)} | Net $${netProceeds.toFixed(2)} | PnL ${pnl>=0?'+':''}$${pnl.toFixed(4)}`, pnl >= 0 ? 'PROFIT' : 'LOSS');
      }

    } else {
      log(`⏸ HOLD — ${decision.reasoning?.slice(0, 100)}`, 'HOLD');
      tradeRecord = { id:Date.now(), type:'HOLD', coin:null, strategy:decision.strategy, confidence:decision.confidence, signals:decision.signals, reasoning:decision.reasoning, source, ts:new Date().toISOString() };
    }

    if (tradeRecord) {
      state.trades.unshift(tradeRecord);
      if (state.trades.length > 500) state.trades.pop();
      if (tradeRecord.type !== 'HOLD') {
        const tv = calcTotalValue(prices, state.portfolio, state.balance);
        log(`Portfolio: $${tv.toFixed(2)} (${((tv/state.startingBalance-1)*100).toFixed(2)}% total return)`, 'INFO');
        await notify(tradeRecord, tv);
        resetCache();
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
  }, 10000);
  notifyStart(state.mode, state.balance);
  saveState(state);
}

export function stopBot() {
  if (cycleTimer) clearInterval(cycleTimer);
  if (priceTimer) clearInterval(priceTimer);
  isRunning = false;
  state.status = 'stopped';
  log('◼ Bot stopped', 'SYSTEM');
  saveState(state);
  broadcast();
}

export function forceReset() {
  stopBot();
  state = resetState();
  resetCache();
  state.status = 'idle';
  log('↺ Reset — balance restored', 'SYSTEM');
  broadcast();
}

export function toggleLeverage(enabled, maxLev) {
  if (!state.settings) state.settings = {};
  state.settings.leverageEnabled = enabled;
  if (maxLev) state.settings.maxLeverage = Math.max(2, Math.min(20, maxLev));
  log(`⚡ Leverage ${enabled ? `ENABLED (max ${state.settings.maxLeverage}x)` : 'DISABLED'}`, 'SYSTEM');
  saveState(state);
  broadcast();
}

// ── Settings update — persists to disk, takes effect immediately ─────────────
export function updateSettings(settings) {
  if (!state.settings) state.settings = {};
  const s = state.settings;

  if (settings.maxTradeUSD     != null) s.maxTradeUSD     = Math.max(5,     Math.min(10000, Number(settings.maxTradeUSD)));
  if (settings.stopLossPct     != null) s.stopLossPct     = Math.max(0.005, Math.min(0.5,   Number(settings.stopLossPct)));
  if (settings.takeProfitPct   != null) s.takeProfitPct   = Math.max(0.01,  Math.min(1.0,   Number(settings.takeProfitPct)));
  if (settings.maxDrawdownPct  != null) s.maxDrawdownPct  = Math.max(0.05,  Math.min(0.5,   Number(settings.maxDrawdownPct)));
  if (settings.leverageEnabled != null) s.leverageEnabled = !!settings.leverageEnabled;
  if (settings.maxLeverage     != null) s.maxLeverage     = Math.max(2,     Math.min(20,    Number(settings.maxLeverage)));
  if (settings.startingBalance != null) s.startingBalance = Math.max(1,     Number(settings.startingBalance));

  saveState(state); // write to disk immediately
  log(`✅ Settings saved: maxTrade=$${s.maxTradeUSD} SL=${(s.stopLossPct*100).toFixed(1)}% TP=${(s.takeProfitPct*100).toFixed(1)}% DD=${(s.maxDrawdownPct*100).toFixed(1)}%`, 'SYSTEM');
  broadcast(); // push to dashboard immediately
}

export function runOnce() {
  if (!isRunning) refreshPrices().then(() => setTimeout(tradingCycle, 2000));
  else tradingCycle();
}

export function getState()  { return state; }
export function getPrices() { return prices; }
export function getBotLog() { return getLog(); }

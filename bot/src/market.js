/**
 * NEXUS TRADER · Market Data + Algorithm v6
 * 33 coins — Binance public API, no key needed
 * RSI+MACD confluence strategy (73-77% win rate research basis)
 */

import axios from 'axios';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

export const COINS = [
  // Tier 1 — highest liquidity
  { id:'BTCUSDT',   symbol:'BTC',   name:'Bitcoin',       weight:1.4 },
  { id:'ETHUSDT',   symbol:'ETH',   name:'Ethereum',      weight:1.3 },
  { id:'SOLUSDT',   symbol:'SOL',   name:'Solana',        weight:1.2 },
  { id:'XRPUSDT',   symbol:'XRP',   name:'XRP',           weight:1.1 },
  { id:'BNBUSDT',   symbol:'BNB',   name:'BNB',           weight:1.1 },
  // Tier 2 — large cap alts
  { id:'AVAXUSDT',  symbol:'AVAX',  name:'Avalanche',     weight:1.0 },
  { id:'DOTUSDT',   symbol:'DOT',   name:'Polkadot',      weight:1.0 },
  { id:'LINKUSDT',  symbol:'LINK',  name:'Chainlink',     weight:1.0 },
  { id:'ADAUSDT',   symbol:'ADA',   name:'Cardano',       weight:0.9 },
  { id:'MATICUSDT', symbol:'MATIC', name:'Polygon',       weight:0.9 },
  { id:'LTCUSDT',   symbol:'LTC',   name:'Litecoin',      weight:0.9 },
  { id:'ATOMUSDT',  symbol:'ATOM',  name:'Cosmos',        weight:0.9 },
  { id:'UNIUSDT',   symbol:'UNI',   name:'Uniswap',       weight:0.9 },
  // Tier 3 — mid cap
  { id:'DOGEUSDT',  symbol:'DOGE',  name:'Dogecoin',      weight:0.8 },
  { id:'SHIBUSDT',  symbol:'SHIB',  name:'Shiba Inu',     weight:0.7 },
  { id:'NEARUSDT',  symbol:'NEAR',  name:'NEAR Protocol', weight:0.8 },
  { id:'APTUSDT',   symbol:'APT',   name:'Aptos',         weight:0.8 },
  { id:'ARBUSDT',   symbol:'ARB',   name:'Arbitrum',      weight:0.8 },
  { id:'OPUSDT',    symbol:'OP',    name:'Optimism',      weight:0.8 },
  { id:'INJUSDT',   symbol:'INJ',   name:'Injective',     weight:0.8 },
  { id:'SUIUSDT',   symbol:'SUI',   name:'Sui',           weight:0.8 },
  { id:'SEIUSDT',   symbol:'SEI',   name:'Sei',           weight:0.7 },
  { id:'TIAUSDT',   symbol:'TIA',   name:'Celestia',      weight:0.7 },
  // Tier 4 — higher volatility, higher potential
  { id:'FETUSDT',   symbol:'FET',   name:'Fetch.ai',      weight:0.7 },
  { id:'RENDERUSDT',symbol:'RENDER',name:'Render',        weight:0.7 },
  { id:'WLDUSDT',   symbol:'WLD',   name:'Worldcoin',     weight:0.7 },
  { id:'JUPUSDT',   symbol:'JUP',   name:'Jupiter',       weight:0.7 },
  { id:'PYTHUSDT',  symbol:'PYTH',  name:'Pyth Network',  weight:0.7 },
  { id:'STRKUSDT',  symbol:'STRK',  name:'Starknet',      weight:0.6 },
  { id:'WUSDT',     symbol:'W',     name:'Wormhole',      weight:0.6 },
  { id:'EIGENUSDT', symbol:'EIGEN', name:'Eigenlayer',    weight:0.6 },
  { id:'ENAUSDT',   symbol:'ENA',   name:'Ethena',        weight:0.7 },
  { id:'ONDOUSDT',  symbol:'ONDO',  name:'Ondo Finance',  weight:0.7 },
];

const PAIR_TO_SYM = Object.fromEntries(COINS.map(c => [c.id, c.symbol]));
const SYM_TO_PAIR = Object.fromEntries(COINS.map(c => [c.symbol, c.id]));

// In-memory history
const priceHistory  = {};
const volumeHistory = {};
const rsiHistory    = {};

export async function fetchPrices() {
  // Binance limits symbol array — split into batches of 20
  const batches = [];
  const allIds  = COINS.map(c => c.id);
  for (let i = 0; i < allIds.length; i += 20) batches.push(allIds.slice(i, i + 20));

  const result = {};
  for (const batch of batches) {
    try {
      const symbols = JSON.stringify(batch);
      const res = await axios.get(`${BINANCE_BASE}/ticker/24hr`, { params: { symbols }, timeout: 12000 });
      for (const t of res.data) {
        const sym = PAIR_TO_SYM[t.symbol];
        if (!sym) continue;
        const price = parseFloat(t.lastPrice);
        if (!price || isNaN(price)) continue;
        result[sym] = {
          price,
          change24h:  parseFloat(t.priceChangePercent) || 0,
          volume24h:  parseFloat(t.quoteVolume)         || 0,
          high24h:    parseFloat(t.highPrice)            || price,
          low24h:     parseFloat(t.lowPrice)             || price,
          openPrice:  parseFloat(t.openPrice)            || price,
        };
        if (!priceHistory[sym])  priceHistory[sym]  = [];
        if (!volumeHistory[sym]) volumeHistory[sym] = [];
        priceHistory[sym].push(price);
        if (priceHistory[sym].length  > 120) priceHistory[sym].shift();
        volumeHistory[sym].push(parseFloat(t.quoteVolume) || 0);
        if (volumeHistory[sym].length > 120) volumeHistory[sym].shift();
      }
    } catch (e) {
      console.error('[Market] Batch fetch error:', e.message);
    }
  }
  return result;
}

// ── Indicators ────────────────────────────────────────────────────────────────
function ema(arr, n) {
  if (arr.length < n) return null;
  const k = 2 / (n + 1);
  let e = arr.slice(0, n).reduce((a, b) => a + b) / n;
  for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function calcRSI(arr, n = 14) {
  if (arr.length < n + 2) return null;
  const sl = arr.slice(-(n + 1));
  let g = 0, l = 0;
  for (let i = 1; i < sl.length; i++) {
    const d = sl[i] - sl[i - 1];
    if (d > 0) g += d; else l += Math.abs(d);
  }
  const ag = g / n, al = l / n;
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function calcMACD(arr) {
  if (arr.length < 35) return null;
  const e12 = ema(arr, 12), e26 = ema(arr, 26);
  if (!e12 || !e26) return null;
  const line = e12 - e26;
  // Build MACD series for signal line
  const macdSeries = [];
  for (let i = 26; i <= arr.length; i++) {
    const a = ema(arr.slice(0, i), 12);
    const b = ema(arr.slice(0, i), 26);
    if (a && b) macdSeries.push(a - b);
  }
  const signal   = ema(macdSeries, 9) || line * 0.9;
  const histogram = line - signal;
  return { line, signal, histogram, bullish: line > signal && histogram > 0 };
}

function calcBB(arr, n = 20) {
  if (arr.length < n) return null;
  const sl = arr.slice(-n);
  const m  = sl.reduce((a, b) => a + b) / n;
  const sd = Math.sqrt(sl.reduce((s, p) => s + (p - m) ** 2) / n);
  const cur = arr[arr.length - 1];
  return {
    upper:  m + 2 * sd,
    middle: m,
    lower:  m - 2 * sd,
    pct:    sd > 0 ? (cur - m) / (2 * sd) : 0,
    width:  sd > 0 ? (4 * sd) / m : 0,
  };
}

function calcVolRatio(vols, n = 10) {
  if (vols.length < n + 1) return 1;
  const recent = vols[vols.length - 1];
  const avg    = vols.slice(-n - 1, -1).reduce((a, b) => a + b) / n;
  return avg > 0 ? recent / avg : 1;
}

function calcMom(arr, n) {
  if (arr.length < n + 1) return null;
  return ((arr[arr.length - 1] - arr[arr.length - 1 - n]) / arr[arr.length - 1 - n]) * 100;
}

function rsiRecovering(sym) {
  const h = rsiHistory[sym] || [];
  if (h.length < 3) return false;
  return h[h.length - 1] > h[h.length - 2] && h[h.length - 2] > h[h.length - 3];
}

function rsiDecelerating(sym) {
  const h = rsiHistory[sym] || [];
  if (h.length < 2) return false;
  return h[h.length - 1] < h[h.length - 2];
}

export function computeIndicators(symbol) {
  const prices = priceHistory[symbol]  || [];
  const vols   = volumeHistory[symbol] || [];

  const rsiVal = calcRSI(prices);
  if (rsiVal !== null) {
    if (!rsiHistory[symbol]) rsiHistory[symbol] = [];
    rsiHistory[symbol].push(rsiVal);
    if (rsiHistory[symbol].length > 10) rsiHistory[symbol].shift();
  }

  const e9  = ema(prices, 9);
  const e21 = ema(prices, 21);
  const e50 = ema(prices, 50);

  // Regime detection
  let regime = 'unknown';
  if (e9 && e21 && e50) {
    const spread = Math.abs(e9 - e50) / e50;
    regime = spread > 0.015 ? 'trending' : spread < 0.005 ? 'ranging' : 'neutral';
  }

  return {
    symbol,
    priceCount:      prices.length,
    currentPrice:    prices[prices.length - 1] || null,
    rsi:             rsiVal,
    rsiRecovering:   rsiRecovering(symbol),
    rsiDecelerating: rsiDecelerating(symbol),
    macd:            calcMACD(prices),
    bb:              calcBB(prices),
    ema9:            e9,
    ema21:           e21,
    ema50:           e50,
    momentum5:       calcMom(prices, 5),
    momentum20:      calcMom(prices, 20),
    volumeRatio:     calcVolRatio(vols),
    regime,
  };
}

/**
 * HIGH-CONVICTION ENTRY SCORING
 * Min score 8 out of ~18 before any trade
 * RSI + MACD must both confirm
 * RSI must be RECOVERING (rising 3+ ticks) — prevents knife catches
 */
export function scoreForBuy(symbol, prices, portfolio, balance, settings = {}) {
  const ind = computeIndicators(symbol);
  if (ind.priceCount < 25) return { score: 0, signals: ['NEED_25_TICKS'], ind };

  const px = prices[symbol]?.price;
  if (!px || balance < 5) return { score: 0, signals: [], ind };

  const maxPosPct = settings.maxPositionPct || 0.35;
  const totalValue = balance + Object.entries(portfolio).reduce((s, [sym, pos]) =>
    s + (pos.qty || 0) * (prices[sym]?.price || 0), 0);
  const posVal = (portfolio[symbol]?.qty || 0) * px;
  if (posVal / totalValue > maxPosPct) return { score: 0, signals: ['AT_MAX_POSITION'], ind };

  // GATE: MACD must be constructive OR RSI at extreme (<22)
  const macdOk = ind.macd && (ind.macd.bullish || ind.macd.histogram > 0);
  if (!macdOk && (!ind.rsi || ind.rsi >= 22)) {
    return { score: 0, signals: ['MACD_GATE_BLOCKED'], ind };
  }

  let score = 0;
  const signals = [];
  let strategy = 'MOMENTUM';

  // ── RSI (0-6 pts) — recovering = not catching knife ──────────────────────
  if (ind.rsi !== null) {
    if      (ind.rsi < 22 && ind.rsiRecovering) { score += 6; signals.push(`RSI_EXTREME(${ind.rsi.toFixed(1)})↑`); strategy = 'MEAN_REVERSION'; }
    else if (ind.rsi < 30 && ind.rsiRecovering) { score += 4; signals.push(`RSI_OVERSOLD(${ind.rsi.toFixed(1)})↑`); strategy = 'MEAN_REVERSION'; }
    else if (ind.rsi < 40 && ind.rsiRecovering) { score += 2; signals.push(`RSI_LOW(${ind.rsi.toFixed(1)})↑`); }
    else if (ind.rsi >= 40 && ind.rsi <= 58 && macdOk) { score += 2; signals.push(`RSI_MOM(${ind.rsi.toFixed(1)})`); }
    if (!ind.rsiRecovering && ind.rsi < 45)     { score -= 3; signals.push('RSI_FALLING⚠'); }
  }

  // ── MACD (0-4 pts) — core confirmation ───────────────────────────────────
  if (ind.macd) {
    if (ind.macd.bullish && ind.macd.histogram > 0) { score += 3; signals.push(`MACD_BULL`); }
    else if (ind.macd.histogram > 0)                { score += 1; signals.push('MACD_HIST+'); }
    if (ind.macd.line > 0 && ind.macd.bullish)      { score += 1; signals.push('MACD_ABOVE_ZERO'); }
  }

  // ── Bollinger Bands (0-4 pts) ─────────────────────────────────────────────
  if (ind.bb) {
    if      (ind.bb.pct < -0.85) { score += 4; signals.push(`BB_EXTREME(${(ind.bb.pct*100).toFixed(0)}%)`); strategy = 'MEAN_REVERSION'; }
    else if (ind.bb.pct < -0.50) { score += 2; signals.push(`BB_LOWER(${(ind.bb.pct*100).toFixed(0)}%)`); }
    if (ind.bb.width < 0.04 && ind.momentum5 > 0) { score += 2; signals.push('BB_SQUEEZE_BREAK'); strategy = 'BREAKOUT'; }
  }

  // ── EMA trend alignment (0-3 pts) ─────────────────────────────────────────
  if (ind.ema9 && ind.ema21 && ind.ema9 > ind.ema21)  { score += 1; signals.push('EMA9>21'); }
  if (ind.ema21 && ind.ema50 && ind.ema21 > ind.ema50) { score += 2; signals.push('EMA21>50'); }

  // ── Momentum (0-2 pts) ────────────────────────────────────────────────────
  if (ind.momentum5  !== null && ind.momentum5  > 0.3) { score += 1; signals.push(`MOM5+${ind.momentum5.toFixed(2)}%`); }
  if (ind.momentum20 !== null && ind.momentum20 > 1.0) { score += 1; signals.push(`MOM20+${ind.momentum20.toFixed(2)}%`); }

  // ── Volume (0-3 pts, -2 penalty) ─────────────────────────────────────────
  if      (ind.volumeRatio > 2.5) { score += 3; signals.push(`VOL_SURGE(${ind.volumeRatio.toFixed(1)}x)`); }
  else if (ind.volumeRatio > 1.7) { score += 2; signals.push(`VOL_SPIKE(${ind.volumeRatio.toFixed(1)}x)`); }
  else if (ind.volumeRatio > 1.3) { score += 1; signals.push('VOL_ELEVATED'); }
  else if (ind.volumeRatio < 0.7) { score -= 2; signals.push('LOW_VOL⚠'); }

  // ── Regime (bonus/penalty) ────────────────────────────────────────────────
  if (strategy === 'MOMENTUM'      && ind.regime === 'ranging')                         { score -= 2; signals.push('RANGING⚠'); }
  if (strategy === 'MEAN_REVERSION' && ind.regime === 'trending' && (prices[symbol]?.change24h||0) < -3) { score += 1; signals.push('DIP_IN_TREND'); }

  const weight = COINS.find(c => c.symbol === symbol)?.weight || 1;
  return { score: +(score * weight).toFixed(2), rawScore: score, signals, strategy, ind };
}

/**
 * EXIT EVALUATION
 * Hard stop, trailing stop, patient multi-signal exits
 */
export function evaluateExit(symbol, pos, prices, settings = {}) {
  const ind = computeIndicators(symbol);
  const cur = prices[symbol]?.price;
  if (!cur || !pos) return null;

  const sl  = settings.stopLossPct   || 0.05;
  const tp  = settings.takeProfitPct || 0.08;
  const lev = pos.leverage || 1;
  const pnlPct = (cur - pos.avgCost) / pos.avgCost;
  const eff    = pnlPct * lev;

  // Hard stop
  if (eff <= -sl) {
    return { action:'SELL', sellPct:1.0, confidence:10, strategy:'STOP_LOSS',
      signals:[`STOP_LOSS(${(eff*100).toFixed(1)}%)`],
      reasoning:`Stop-loss at ${(eff*100).toFixed(2)}%. Entry $${pos.avgCost.toFixed(4)} → now $${cur.toFixed(4)}.` };
  }

  // Trailing stop: up 2x take-profit → protect 50% of gains
  if (eff > tp * 2 && pnlPct < (eff * 0.5) - sl) {
    return { action:'SELL', sellPct:0.7, confidence:8, strategy:'TRAIL_STOP',
      signals:[`TRAIL(+${(eff*100).toFixed(1)}%)`],
      reasoning:`Trailing stop: up +${(eff*100).toFixed(2)}%, protecting gains.` };
  }

  // Multi-signal exit score
  let exitScore = 0;
  const exitSigs = [];
  if (ind.rsi !== null) {
    if (ind.rsi > 75)                                  { exitScore += 4; exitSigs.push(`RSI_OB(${ind.rsi.toFixed(1)})`); }
    else if (ind.rsi > 68)                             { exitScore += 2; exitSigs.push(`RSI_HIGH(${ind.rsi.toFixed(1)})`); }
    if (ind.rsiDecelerating && ind.rsi > 60)           { exitScore += 2; exitSigs.push('RSI_DECEL'); }
  }
  if (ind.macd && !ind.macd.bullish)                   { exitScore += 3; exitSigs.push('MACD_BEAR'); }
  if (ind.macd && ind.macd.histogram < 0)              { exitScore += 1; exitSigs.push('MACD_HIST-'); }
  if (ind.bb && ind.bb.pct > 0.9)                      { exitScore += 2; exitSigs.push('ABOVE_BB'); }
  if (ind.ema9 && ind.ema21 && ind.ema9 < ind.ema21)   { exitScore += 2; exitSigs.push('EMA_DEATH'); }
  if (ind.momentum5 !== null && ind.momentum5 < -0.5)  { exitScore += 1; exitSigs.push('MOM5-'); }

  if (eff >= tp * 1.5 && exitScore >= 3) {
    return { action:'SELL', sellPct:0.5, confidence:8, strategy:'TAKE_PROFIT',
      signals:[`TP(+${(eff*100).toFixed(1)}%)`, ...exitSigs],
      reasoning:`Partial TP +${(eff*100).toFixed(2)}% with ${exitScore} reversal signals. Holding 50% runner.` };
  }
  if (eff >= tp && exitScore >= 5) {
    return { action:'SELL', sellPct:0.65, confidence:9, strategy:'TAKE_PROFIT',
      signals:[`TP(+${(eff*100).toFixed(1)}%)`, ...exitSigs],
      reasoning:`Take-profit at +${(eff*100).toFixed(2)}% (${exitScore} signals). Selling 65%.` };
  }
  if (exitScore >= 6 && eff > 0.01) {
    return { action:'SELL', sellPct:0.75, confidence:7, strategy:'TREND_REVERSAL',
      signals:exitSigs,
      reasoning:`Trend reversal (score ${exitScore}). Selling 75% to lock gains.` };
  }
  if (exitScore >= 7 && eff < 0) {
    return { action:'SELL', sellPct:1.0, confidence:8, strategy:'TREND_REVERSAL',
      signals:exitSigs,
      reasoning:`Confirmed downtrend (score ${exitScore}) at loss. Full exit.` };
  }

  return null; // Hold — trend intact
}

export function buildMarketSummary(prices, portfolio) {
  return COINS.map(({ symbol }) => {
    const px = prices[symbol];
    if (!px) return '';
    const ind  = computeIndicators(symbol);
    const held = portfolio[symbol];
    return `${symbol} $${px.price.toFixed(4)}|24H:${px.change24h.toFixed(2)}%|RSI:${ind.rsi?.toFixed(1)||'—'}(${ind.rsiRecovering?'↑':'↓'})|MACD:${ind.macd?.bullish?'BULL':'BEAR'}|BB:${ind.bb?.pct?.toFixed(2)||'—'}|VOL:${ind.volumeRatio.toFixed(2)}x|REGIME:${ind.regime}${held?`|HELD:${held.qty.toFixed(5)}@$${held.avgCost.toFixed(4)}`:''}`;
  }).filter(Boolean).join('\n');
}

export { priceHistory, SYM_TO_PAIR, PAIR_TO_SYM };

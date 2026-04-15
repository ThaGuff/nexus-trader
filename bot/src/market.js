/**
 * NEXUS TRADER · Market Data Module
 * Binance public API — no key, no signup, no CORS issues
 * Updates every 8 seconds, real-time prices
 */

import axios from 'axios';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

export const COINS = [
  { id: 'BTCUSDT',  symbol: 'BTC', name: 'Bitcoin'   },
  { id: 'ETHUSDT',  symbol: 'ETH', name: 'Ethereum'  },
  { id: 'SOLUSDT',  symbol: 'SOL', name: 'Solana'    },
  { id: 'ADAUSDT',  symbol: 'ADA', name: 'Cardano'   },
  { id: 'AVAXUSDT', symbol: 'AVAX',name: 'Avalanche' },
  { id: 'LINKUSDT', symbol: 'LINK',name: 'Chainlink' },
  { id: 'XRPUSDT',  symbol: 'XRP', name: 'XRP'       },
  { id: 'DOGEUSDT', symbol: 'DOGE',name: 'Dogecoin'  },
];

const PAIR_TO_SYM = Object.fromEntries(COINS.map(c => [c.id, c.symbol]));
const SYM_TO_PAIR = Object.fromEntries(COINS.map(c => [c.symbol, c.id]));

// In-memory price history — up to 100 ticks per coin
const priceHistory  = {};
const volumeHistory = {};

/** Fetch live prices from Binance — no API key needed */
export async function fetchPrices() {
  const symbols = JSON.stringify(COINS.map(c => c.id));
  const res = await axios.get(`${BINANCE_BASE}/ticker/24hr`, {
    params: { symbols },
    timeout: 10000,
  });

  const result = {};
  for (const ticker of res.data) {
    const sym = PAIR_TO_SYM[ticker.symbol];
    if (!sym) continue;

    const price     = parseFloat(ticker.lastPrice);
    const change24h = parseFloat(ticker.priceChangePercent);
    const volume24h = parseFloat(ticker.quoteVolume); // in USD
    const high24h   = parseFloat(ticker.highPrice);
    const low24h    = parseFloat(ticker.lowPrice);

    result[sym] = { price, change24h, volume24h, high24h, low24h };

    // Append to history
    if (!priceHistory[sym])  priceHistory[sym]  = [];
    if (!volumeHistory[sym]) volumeHistory[sym] = [];

    priceHistory[sym].push(price);
    if (priceHistory[sym].length  > 100) priceHistory[sym].shift();

    volumeHistory[sym].push(volume24h);
    if (volumeHistory[sym].length > 100) volumeHistory[sym].shift();
  }

  return result;
}

// ── Technical Indicators ───────────────────────────────────────────────────

function calcSMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const slice = prices.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains  += diff;
    else          losses += Math.abs(diff);
  }
  const avgGain = gains  / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcMACD(prices) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  const macd = ema12 - ema26;
  return { macd, signal: macd * 0.9, histogram: macd * 0.1 };
}

function calcBollingerBands(prices, period = 20) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const sma   = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, p) => s + Math.pow(p - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper:  sma + 2 * stdDev,
    middle: sma,
    lower:  sma - 2 * stdDev,
    width:  (4 * stdDev) / sma,
  };
}

function calcMomentum(prices, period = 10) {
  if (prices.length < period + 1) return null;
  const cur  = prices[prices.length - 1];
  const past = prices[prices.length - 1 - period];
  return ((cur - past) / past) * 100;
}

function calcVolumeRatio(volumes) {
  if (volumes.length < 5) return 1;
  const recent = volumes[volumes.length - 1];
  const avg    = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  return avg > 0 ? recent / avg : 1;
}

export function computeIndicators(symbol) {
  const prices  = priceHistory[symbol]  || [];
  const volumes = volumeHistory[symbol] || [];
  return {
    symbol,
    priceCount:   prices.length,
    currentPrice: prices[prices.length - 1] || null,
    rsi:          calcRSI(prices),
    macd:         calcMACD(prices),
    bb:           calcBollingerBands(prices),
    sma20:        calcSMA(prices, 20),
    ema9:         calcEMA(prices, 9),
    ema21:        calcEMA(prices, 21),
    momentum10:   calcMomentum(prices, 10),
    momentum5:    calcMomentum(prices, 5),
    volumeRatio:  calcVolumeRatio(volumes),
  };
}

export function buildMarketSummary(prices, portfolio, balance) {
  const lines = [];
  for (const { symbol } of COINS) {
    const px = prices[symbol];
    if (!px) continue;
    const ind  = computeIndicators(symbol);
    const held = portfolio[symbol];

    const rsiStr  = ind.rsi        ? `RSI:${ind.rsi.toFixed(1)}`                                          : 'RSI:—';
    const macdStr = ind.macd       ? `MACD:${ind.macd.macd >= 0 ? '+' : ''}${ind.macd.macd.toFixed(4)}`  : 'MACD:—';
    const bbStr   = ind.bb         ? `BB%:${(((px.price - ind.bb.lower) / (ind.bb.upper - ind.bb.lower)) * 100).toFixed(0)}` : 'BB%:—';
    const momStr  = ind.momentum10 !== null ? `MOM10:${ind.momentum10.toFixed(2)}%`                       : 'MOM10:—';
    const volStr  = `VOL_RATIO:${ind.volumeRatio.toFixed(2)}x`;
    const chgStr  = `24H:${px.change24h.toFixed(2)}%`;
    const heldStr = held ? ` | HELD:${held.qty.toFixed(6)}@avg$${held.avgCost.toFixed(4)}` : '';

    lines.push(`${symbol} $${px.price.toFixed(4)} | ${chgStr} | ${rsiStr} | ${macdStr} | ${bbStr} | ${momStr} | ${volStr}${heldStr}`);
  }
  return lines.join('\n');
}

export { priceHistory, SYM_TO_PAIR, PAIR_TO_SYM };

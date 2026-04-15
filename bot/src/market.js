/**
 * NEXUS TRADER · Market Data Module
 * Fetches live prices from CoinGecko and computes technical indicators
 * RSI, MACD, Bollinger Bands, Volume analysis, Momentum
 */

import axios from 'axios';

const GECKO_BASE = 'https://api.coingecko.com/api/v3';
const KEY = process.env.COINGECKO_API_KEY;

export const COINS = [
  { id: 'bitcoin',       symbol: 'BTC', name: 'Bitcoin'  },
  { id: 'ethereum',      symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana',        symbol: 'SOL', name: 'Solana'   },
  { id: 'cardano',       symbol: 'ADA', name: 'Cardano'  },
  { id: 'avalanche-2',   symbol: 'AVAX',name: 'Avalanche'},
  { id: 'chainlink',     symbol: 'LINK',name: 'Chainlink'},
  { id: 'ripple',        symbol: 'XRP', name: 'XRP'      },
  { id: 'dogecoin',      symbol: 'DOGE',name: 'Dogecoin' },
];

const ID_TO_SYM = Object.fromEntries(COINS.map(c => [c.id, c.symbol]));
const SYM_TO_ID = Object.fromEntries(COINS.map(c => [c.symbol, c.id]));

// In-memory price history: { BTC: [price, price, ...] } (up to 100 ticks)
const priceHistory = {};
const volumeHistory = {};

async function geckoGet(path, params = {}) {
  const keyParam = KEY ? { x_cg_demo_api_key: KEY } : {};
  const res = await axios.get(`${GECKO_BASE}${path}`, {
    params: { ...params, ...keyParam },
    timeout: 10000,
  });
  return res.data;
}

/** Fetch current prices + 24h stats for all coins */
export async function fetchPrices() {
  const ids = COINS.map(c => c.id).join(',');
  const data = await geckoGet('/simple/price', {
    ids,
    vs_currencies: 'usd',
    include_24hr_change: true,
    include_24hr_vol: true,
    include_market_cap: true,
  });

  const result = {};
  for (const [id, vals] of Object.entries(data)) {
    const sym = ID_TO_SYM[id];
    if (!sym) continue;
    result[sym] = {
      price: vals.usd,
      change24h: vals.usd_24h_change || 0,
      volume24h: vals.usd_24h_vol || 0,
      marketCap: vals.usd_market_cap || 0,
    };
    // Append to price history
    if (!priceHistory[sym]) priceHistory[sym] = [];
    priceHistory[sym].push(vals.usd);
    if (priceHistory[sym].length > 100) priceHistory[sym].shift();

    if (!volumeHistory[sym]) volumeHistory[sym] = [];
    volumeHistory[sym].push(vals.usd_24h_vol || 0);
    if (volumeHistory[sym].length > 100) volumeHistory[sym].shift();
  }
  return result;
}

/** Fetch OHLCV candles for a coin (last N days) */
export async function fetchCandles(coinId, days = 7) {
  try {
    const data = await geckoGet(`/coins/${coinId}/ohlc`, {
      vs_currency: 'usd',
      days,
    });
    // data: [[timestamp, open, high, low, close], ...]
    return data;
  } catch (e) {
    console.error(`[Market] Failed to fetch candles for ${coinId}:`, e.message);
    return [];
  }
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
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(prices) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;
  // Signal line needs history — simplified: return macd line vs zero
  return { macd: macdLine, signal: macdLine * 0.9, histogram: macdLine * 0.1 };
}

function calcBollingerBands(prices, period = 20) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: sma + 2 * stdDev,
    middle: sma,
    lower: sma - 2 * stdDev,
    width: (4 * stdDev) / sma,  // bandwidth %
  };
}

function calcMomentum(prices, period = 10) {
  if (prices.length < period + 1) return null;
  const current = prices[prices.length - 1];
  const past = prices[prices.length - 1 - period];
  return ((current - past) / past) * 100;
}

function calcVolumeRatio(volumes) {
  if (volumes.length < 5) return 1;
  const recent = volumes[volumes.length - 1];
  const avgVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  return avgVol > 0 ? recent / avgVol : 1;
}

/** Compute full indicator suite for a symbol */
export function computeIndicators(symbol) {
  const prices = priceHistory[symbol] || [];
  const volumes = volumeHistory[symbol] || [];

  return {
    symbol,
    priceCount: prices.length,
    currentPrice: prices[prices.length - 1] || null,
    rsi: calcRSI(prices),
    macd: calcMACD(prices),
    bb: calcBollingerBands(prices),
    sma20: calcSMA(prices, 20),
    ema9: calcEMA(prices, 9),
    ema21: calcEMA(prices, 21),
    momentum10: calcMomentum(prices),
    momentum5: calcMomentum(prices, 5),
    volumeRatio: calcVolumeRatio(volumes),
  };
}

/** Build a rich market summary string for the AI prompt */
export function buildMarketSummary(prices, portfolio, balance) {
  const lines = [];

  for (const { symbol } of COINS) {
    const px = prices[symbol];
    if (!px) continue;
    const ind = computeIndicators(symbol);
    const held = portfolio[symbol];

    const rsiStr  = ind.rsi   ? `RSI:${ind.rsi.toFixed(1)}`   : 'RSI:—';
    const macdStr = ind.macd  ? `MACD:${ind.macd.macd >= 0 ? '+' : ''}${ind.macd.macd.toFixed(4)}` : 'MACD:—';
    const bbStr   = ind.bb    ? `BB%:${(((px.price - ind.bb.lower) / (ind.bb.upper - ind.bb.lower)) * 100).toFixed(0)}` : 'BB%:—';
    const momStr  = ind.momentum10 !== null ? `MOM10:${ind.momentum10.toFixed(2)}%` : 'MOM10:—';
    const volStr  = `VOL_RATIO:${ind.volumeRatio.toFixed(2)}x`;
    const chgStr  = `24H:${px.change24h.toFixed(2)}%`;
    const heldStr = held ? ` | HELD:${held.qty.toFixed(6)}@avg$${held.avgCost.toFixed(4)}` : '';

    lines.push(`${symbol} $${px.price.toFixed(4)} | ${chgStr} | ${rsiStr} | ${macdStr} | ${bbStr} | ${momStr} | ${volStr}${heldStr}`);
  }

  return lines.join('\n');
}

export { priceHistory, SYM_TO_ID, ID_TO_SYM };

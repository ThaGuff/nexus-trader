/**
 * NEXUS TRADER · Market Data — Binance Public API
 * No key required, no signup, real-time prices
 */
import axios from 'axios';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

export const COINS = [
  { id: 'BTCUSDT',  symbol: 'BTC',  name: 'Bitcoin'   },
  { id: 'ETHUSDT',  symbol: 'ETH',  name: 'Ethereum'  },
  { id: 'SOLUSDT',  symbol: 'SOL',  name: 'Solana'    },
  { id: 'ADAUSDT',  symbol: 'ADA',  name: 'Cardano'   },
  { id: 'AVAXUSDT', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'LINKUSDT', symbol: 'LINK', name: 'Chainlink' },
  { id: 'XRPUSDT',  symbol: 'XRP',  name: 'XRP'       },
  { id: 'DOGEUSDT', symbol: 'DOGE', name: 'Dogecoin'  },
];

const PAIR_TO_SYM = Object.fromEntries(COINS.map(c => [c.id, c.symbol]));
const SYM_TO_PAIR = Object.fromEntries(COINS.map(c => [c.symbol, c.id]));
const priceHistory = {}, volumeHistory = {};

export async function fetchPrices() {
  const symbols = JSON.stringify(COINS.map(c => c.id));
  const res = await axios.get(`${BINANCE_BASE}/ticker/24hr`, { params: { symbols }, timeout: 10000 });
  const result = {};
  for (const t of res.data) {
    const sym = PAIR_TO_SYM[t.symbol];
    if (!sym) continue;
    const price = parseFloat(t.lastPrice);
    result[sym] = { price, change24h: parseFloat(t.priceChangePercent), volume24h: parseFloat(t.quoteVolume), high24h: parseFloat(t.highPrice), low24h: parseFloat(t.lowPrice) };
    if (!priceHistory[sym])  priceHistory[sym]  = [];
    if (!volumeHistory[sym]) volumeHistory[sym] = [];
    priceHistory[sym].push(price);
    if (priceHistory[sym].length  > 100) priceHistory[sym].shift();
    volumeHistory[sym].push(result[sym].volume24h);
    if (volumeHistory[sym].length > 100) volumeHistory[sym].shift();
  }
  return result;
}

function calcEMA(p, n) { if (p.length < n) return null; const k = 2/(n+1); let e = p.slice(0,n).reduce((a,b)=>a+b,0)/n; for (let i=n;i<p.length;i++) e=p[i]*k+e*(1-k); return e; }
function calcRSI(p, n=14) { if (p.length<n+1) return null; const s=p.slice(-(n+1)); let g=0,l=0; for(let i=1;i<s.length;i++){const d=s[i]-s[i-1];if(d>0)g+=d;else l+=Math.abs(d);} const ag=g/n,al=l/n; if(al===0)return 100; return 100-100/(1+ag/al); }
function calcBB(p, n=20) { if (p.length<n) return null; const s=p.slice(-n),m=s.reduce((a,b)=>a+b,0)/n,sd=Math.sqrt(s.reduce((a,b)=>a+Math.pow(b-m,2),0)/n); return {upper:m+2*sd,middle:m,lower:m-2*sd,width:(4*sd)/m}; }
function calcMom(p, n=10) { if (p.length<n+1) return null; return ((p[p.length-1]-p[p.length-1-n])/p[p.length-1-n])*100; }
function calcVolRatio(v) { if(v.length<5)return 1; const avg=v.slice(-5).reduce((a,b)=>a+b,0)/5; return avg>0?v[v.length-1]/avg:1; }

export function computeIndicators(symbol) {
  const p=priceHistory[symbol]||[], v=volumeHistory[symbol]||[];
  return { symbol, priceCount:p.length, currentPrice:p[p.length-1]||null, rsi:calcRSI(p), bb:calcBB(p), ema9:calcEMA(p,9), ema21:calcEMA(p,21), momentum10:calcMom(p,10), momentum5:calcMom(p,5), volumeRatio:calcVolRatio(v) };
}

export function buildMarketSummary(prices, portfolio) {
  return COINS.map(({symbol:sym})=>{
    const px=prices[sym]; if(!px) return '';
    const ind=computeIndicators(sym), held=portfolio[sym];
    const bbPct = ind.bb ? (((px.price-ind.bb.lower)/(ind.bb.upper-ind.bb.lower))*100).toFixed(0) : '—';
    return `${sym} $${px.price.toFixed(4)} | 24H:${px.change24h.toFixed(2)}% | RSI:${ind.rsi?.toFixed(1)||'—'} | BB%:${bbPct} | MOM10:${ind.momentum10?.toFixed(2)||'—'}% | VOL:${ind.volumeRatio.toFixed(2)}x${held?` | HELD:${held.qty.toFixed(6)}@$${held.avgCost.toFixed(4)}`:''}`;
  }).filter(Boolean).join('\n');
}

export { priceHistory, SYM_TO_PAIR, PAIR_TO_SYM };

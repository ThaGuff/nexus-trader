/**
 * NEXUS TRADER · AI Decision Engine v3
 * Powered by Google Gemini Flash (free tier)
 * Falls back to quantitative rules engine if no API key
 */

import axios from 'axios';
import { computeIndicators, COINS } from './market.js';

const GEMINI_KEY  = process.env.GEMINI_API_KEY || '';
const GEMINI_URL  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

const MAX_TRADE    = parseFloat(process.env.MAX_TRADE_USD    || '20');
const MAX_POS_PCT  = parseFloat(process.env.MAX_POSITION_PCT || '0.35');
const STOP_LOSS    = parseFloat(process.env.STOP_LOSS_PCT    || '0.05');
const TAKE_PROFIT  = parseFloat(process.env.TAKE_PROFIT_PCT  || '0.08');
const MAX_DRAWDOWN = parseFloat(process.env.MAX_DRAWDOWN_PCT || '0.20');

async function callGemini(prompt) {
  const res = await axios.post(GEMINI_URL, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature:     0.2,
      maxOutputTokens: 600,
      topP:            0.8,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }, { timeout: 15000 });

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  // Strip markdown code fences if present
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

export async function getAIDecision(marketSummary, prices, portfolio, balance, state) {
  const totalValue = calcTotalValue(prices, portfolio, balance);
  const drawdown   = state.peakValue > 0 ? (state.peakValue - totalValue) / state.peakValue : 0;
  const leverageEnabled = state.leverageEnabled ?? false;
  const maxLev          = state.maxLeverage ?? 5;

  const portfolioDetail = Object.entries(portfolio).map(([sym, pos]) => {
    const cur    = prices[sym]?.price || 0;
    const pnlPct = pos.avgCost > 0 ? ((cur - pos.avgCost) / pos.avgCost * 100).toFixed(2) : '0.00';
    const posVal = (pos.qty * cur).toFixed(2);
    const levStr = pos.leverage > 1 ? ` LEV:${pos.leverage}x` : '';
    return `  ${sym}: qty=${pos.qty.toFixed(6)} avgCost=$${pos.avgCost.toFixed(4)} now=$${cur.toFixed(4)} value=$${posVal} PnL=${pnlPct}%${levStr}`;
  }).join('\n') || '  (no positions)';

  const recentTrades = (state.trades || []).slice(0, 4).map(t =>
    `  ${t.type} ${t.coin || 'HOLD'} [${t.strategy}] conf:${t.confidence}/10`
  ).join('\n') || '  (none)';

  const prompt = `You are NEXUS, an elite autonomous crypto trading AI. Your job: grow this portfolio aggressively and intelligently using proven trading strategies.

PORTFOLIO:
Cash: $${balance.toFixed(2)} | Total: $${totalValue.toFixed(2)} | Started: $${state.startingBalance.toFixed(2)}
PnL: ${totalValue >= state.startingBalance ? '+' : ''}$${(totalValue - state.startingBalance).toFixed(2)} (${((totalValue/state.startingBalance-1)*100).toFixed(2)}%)
Drawdown: ${(drawdown*100).toFixed(2)}% | Peak: $${state.peakValue.toFixed(2)}
Leverage: ${leverageEnabled ? `ENABLED max ${maxLev}x` : 'DISABLED'}

POSITIONS:
${portfolioDetail}

RECENT DECISIONS:
${recentTrades}

LIVE MARKET DATA (Binance real-time):
RSI<30=oversold, RSI>70=overbought
BB%<15=near lower band, BB%>85=near upper
MOM10=10-tick momentum%, VOL=volume ratio
${marketSummary}

STRATEGIES TO USE:
1. MOMENTUM: RSI 40-60 + positive MOM10 + VOL>1.5 → BUY
2. MEAN_REVERSION: RSI<30 + near BB lower → BUY oversold bounce
3. BREAKOUT: BB%>85 + VOL>2x + positive momentum → BUY
4. EMA_CROSS: EMA9 above EMA21 → BUY, below → SELL
5. TAKE_PROFIT: position up >${(TAKE_PROFIT*100).toFixed(0)}% → SELL 60%
6. STOP_LOSS: position down >${(STOP_LOSS*100).toFixed(0)}% → SELL 100%
7. HIGH_RISK_REWARD: RSI<25 + VOL>2x + recovering → aggressive BUY $${MAX_TRADE}
${leverageEnabled ? `8. LEVERAGE: 3+ signals + confidence>=8 → use ${Math.min(maxLev,3)}-${maxLev}x perp` : ''}

HARD RULES:
- Max trade: $${MAX_TRADE} | Max position: ${(MAX_POS_PCT*100).toFixed(0)}% portfolio
- Stop loss: ${(STOP_LOSS*100).toFixed(0)}% | Take profit: ${(TAKE_PROFIT*100).toFixed(0)}%
- Min trade: $5 | Fee: 0.6% per side
- HOLD if no clear signal${drawdown > 0.15 ? '\n- WARNING: DRAWDOWN >15% — be conservative' : ''}

Analyze each coin. Pick the single best trade opportunity.
Respond ONLY with valid JSON, no markdown, no explanation outside JSON:

{"action":"BUY"|"SELL"|"HOLD","coin":"BTC"|"ETH"|"SOL"|"ADA"|"AVAX"|"LINK"|"XRP"|"DOGE"|null,"usdAmount":<5-${MAX_TRADE} for BUY>,"sellPct":<0.25-1.0 for SELL>,"isPerp":<true|false>,"leverage":<2-${maxLev} if isPerp>,"strategy":"MOMENTUM"|"MEAN_REVERSION"|"BREAKOUT"|"EMA_CROSS"|"TAKE_PROFIT"|"STOP_LOSS"|"HIGH_RISK_REWARD"|"HOLD","confidence":<1-10>,"signals":["signal1","signal2"],"reasoning":"<3-4 sentences citing specific indicator values and strategy logic>"}`;

  const dec = await callGemini(prompt);

  // Validate and clamp
  if (dec.usdAmount) dec.usdAmount = Math.min(dec.usdAmount, MAX_TRADE, balance);
  if (dec.sellPct)   dec.sellPct   = Math.max(0.1, Math.min(1, dec.sellPct));
  if (dec.leverage)  dec.leverage  = Math.max(2, Math.min(maxLev, dec.leverage));

  // Safety guards
  if (!leverageEnabled)             { dec.isPerp = false; dec.leverage = 1; }
  if (dec.isPerp && dec.confidence < 8) { dec.isPerp = false; dec.leverage = 1; }

  return dec;
}

/** Quantitative rules engine — zero API cost */
export function getRulesDecision(prices, portfolio, balance, state) {
  const totalValue      = calcTotalValue(prices, portfolio, balance);
  const drawdown        = state.peakValue > 0 ? (state.peakValue - totalValue) / state.peakValue : 0;
  const leverageEnabled = state.leverageEnabled ?? false;

  // Emergency liquidation
  if (drawdown >= MAX_DRAWDOWN) {
    const sym = Object.keys(portfolio)[0];
    if (sym) return { action:'SELL', coin:sym, sellPct:1.0, confidence:10, isPerp:false, leverage:1, strategy:'STOP_LOSS', signals:['MAX_DRAWDOWN_HIT'], reasoning:`Portfolio drawdown ${(drawdown*100).toFixed(1)}% hit ${(MAX_DRAWDOWN*100).toFixed(0)}% limit. Emergency exit of ${sym} to preserve capital.` };
  }

  // Stop-loss / take-profit on open positions
  for (const [sym, pos] of Object.entries(portfolio)) {
    const cur = prices[sym]?.price;
    if (!cur) continue;
    const pnlPct = (cur - pos.avgCost) / pos.avgCost;
    const effPnl = pnlPct * (pos.leverage || 1);
    if (effPnl <= -STOP_LOSS) return { action:'SELL', coin:sym, sellPct:1.0, confidence:10, isPerp:pos.isPerp||false, leverage:pos.leverage||1, strategy:'STOP_LOSS', signals:[`STOP_LOSS(${(effPnl*100).toFixed(1)}%)`], reasoning:`Stop-loss triggered on ${sym}. Down ${(effPnl*100).toFixed(2)}% from entry $${pos.avgCost.toFixed(4)}. Exiting full position.` };
    if (effPnl >=  TAKE_PROFIT) return { action:'SELL', coin:sym, sellPct:0.6, confidence:8, isPerp:pos.isPerp||false, leverage:pos.leverage||1, strategy:'TAKE_PROFIT', signals:[`TAKE_PROFIT(+${(effPnl*100).toFixed(1)}%)`], reasoning:`Take-profit on ${sym} at +${(effPnl*100).toFixed(2)}%. Selling 60% at $${cur.toFixed(4)} to lock gains, holding 40% for upside.` };
  }

  if (balance < 5) return { action:'HOLD', coin:null, confidence:5, strategy:'HOLD', signals:['LOW_CASH'], reasoning:'Cash below minimum trade size. Holding positions and waiting.' };

  // Score coins for best buy
  const candidates = [];
  for (const { symbol } of COINS) {
    const ind = computeIndicators(symbol);
    if (ind.priceCount < 8) continue;
    const px = prices[symbol]?.price;
    if (!px) continue;
    const posVal = (portfolio[symbol]?.qty || 0) * px;
    if (posVal / totalValue > MAX_POS_PCT) continue;

    let score = 0;
    const signals = [];
    let strategy = 'MOMENTUM';

    if (ind.rsi !== null) {
      if (ind.rsi < 28)      { score += 4; signals.push(`RSI_OVERSOLD(${ind.rsi.toFixed(1)})`); strategy = 'MEAN_REVERSION'; }
      else if (ind.rsi < 38) { score += 2; signals.push(`RSI_LOW(${ind.rsi.toFixed(1)})`); }
    }
    if (ind.momentum10 !== null && ind.momentum10 > 0.4) { score += 2; signals.push(`MOM10(+${ind.momentum10.toFixed(2)}%)`); }
    if (ind.momentum5  !== null && ind.momentum5  > 0.2) { score += 1; signals.push('MOM5_BULL'); }
    if (ind.bb && px) {
      const bbPct = (px - ind.bb.lower) / (ind.bb.upper - ind.bb.lower);
      if (bbPct < 0.15)      { score += 3; signals.push(`BB_LOWER(${(bbPct*100).toFixed(0)}%)`); strategy = 'MEAN_REVERSION'; }
      else if (bbPct > 0.85) { score += 1; signals.push('BB_BREAKOUT'); strategy = 'BREAKOUT'; }
    }
    if (ind.ema9 && ind.ema21 && ind.ema9 > ind.ema21) { score += 1; signals.push('EMA_BULL_CROSS'); strategy = 'EMA_CROSS'; }
    if (ind.volumeRatio > 2.0)      { score += 2; signals.push(`VOL_SPIKE(${ind.volumeRatio.toFixed(1)}x)`); }
    else if (ind.volumeRatio > 1.5) { score += 1; signals.push('VOL_ELEVATED'); }
    if ((prices[symbol]?.change24h || 0) > 3) { score += 1; signals.push('24H_BULL'); }
    if (ind.rsi !== null && ind.rsi < 25 && ind.volumeRatio > 2) { score += 2; signals.push('HIGH_RR'); strategy = 'HIGH_RISK_REWARD'; }

    if (score >= 4) candidates.push({ symbol, score, signals, strategy, ind });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best  = candidates[0];
    const spend = +Math.min(MAX_TRADE, balance * 0.28, balance - 2).toFixed(2);
    if (spend < 5) return { action:'HOLD', coin:null, confidence:4, strategy:'HOLD', signals:['LOW_CASH'], reasoning:'Good setup found but insufficient cash.' };
    const usePerp = leverageEnabled && best.score >= 7 && (state.drawdown || 0) < 10;
    const lev     = usePerp ? Math.min(3, state.maxLeverage || 5) : 1;
    return { action:'BUY', coin:best.symbol, usdAmount:spend, isPerp:usePerp, leverage:lev, confidence:Math.min(10,Math.round(best.score*1.1)), strategy:best.strategy, signals:best.signals, reasoning:`${best.strategy} on ${best.symbol} (score ${best.score}/10). RSI=${best.ind.rsi?.toFixed(1)||'—'} MOM10=${best.ind.momentum10?.toFixed(2)||'—'}% VOL=${best.ind.volumeRatio?.toFixed(2)||'—'}x. Entry $${spend}${lev>1?` ${lev}x leverage`:''}. Stop -${(STOP_LOSS*100).toFixed(0)}% target +${(TAKE_PROFIT*100).toFixed(0)}%.` };
  }

  return { action:'HOLD', coin:null, confidence:4, strategy:'HOLD', signals:['NO_SETUP'], reasoning:`Scanned ${COINS.length} pairs — no coins scored 4+ this cycle. Market unclear or insufficient price history. Preserving capital.` };
}

export function calcTotalValue(prices, portfolio, balance) {
  let val = balance;
  for (const [sym, { qty }] of Object.entries(portfolio)) val += qty * (prices[sym]?.price || 0);
  return val;
}

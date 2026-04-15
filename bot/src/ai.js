/**
 * NEXUS TRADER · AI Decision Engine
 * Claude-powered trading brain with multi-signal analysis
 * Falls back to quantitative rules engine if API unavailable
 */

import Anthropic from '@anthropic-ai/sdk';
import { computeIndicators, COINS } from './market.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TRADE    = parseFloat(process.env.MAX_TRADE_USD    || '20');
const MAX_POS_PCT  = parseFloat(process.env.MAX_POSITION_PCT || '0.35');
const STOP_LOSS    = parseFloat(process.env.STOP_LOSS_PCT    || '0.05');
const TAKE_PROFIT  = parseFloat(process.env.TAKE_PROFIT_PCT  || '0.08');
const MAX_DRAWDOWN = parseFloat(process.env.MAX_DRAWDOWN_PCT || '0.20');
const FEE          = 0.006; // 0.6% Coinbase taker fee

/** Claude AI decision with full market context */
export async function getAIDecision(marketSummary, prices, portfolio, balance, state) {
  const totalValue = calcTotalValue(prices, portfolio, balance);
  const drawdown = state.peakValue > 0 ? (state.peakValue - totalValue) / state.peakValue : 0;

  const portfolioDetail = Object.entries(portfolio).map(([sym, pos]) => {
    const cur = prices[sym]?.price || 0;
    const pnlPct = ((cur - pos.avgCost) / pos.avgCost * 100).toFixed(2);
    const posValue = (pos.qty * cur).toFixed(2);
    return `  ${sym}: qty=${pos.qty.toFixed(6)} avgCost=$${pos.avgCost.toFixed(4)} current=$${cur.toFixed(4)} posValue=$${posValue} PnL=${pnlPct}%`;
  }).join('\n') || '  (no positions)';

  const prompt = `You are NEXUS, an elite autonomous crypto trading AI modeled after the best quantitative hedge fund managers (Renaissance Technologies, Two Sigma). You have one job: grow this portfolio aggressively but intelligently.

═══════════════════════════════════════════════
PORTFOLIO STATUS
═══════════════════════════════════════════════
Cash Available:    $${balance.toFixed(4)}
Total Value:       $${totalValue.toFixed(4)}
Starting Capital:  $${state.startingBalance.toFixed(2)}
All-time PnL:      ${totalValue >= state.startingBalance ? '+' : ''}$${(totalValue - state.startingBalance).toFixed(4)} (${((totalValue/state.startingBalance - 1)*100).toFixed(2)}%)
Peak Value:        $${state.peakValue.toFixed(4)}
Current Drawdown:  ${(drawdown * 100).toFixed(2)}%
Total Fees Paid:   $${state.totalFeesUSD.toFixed(4)}
Trade Count:       ${state.trades.length}
Mode:              ${state.mode}

OPEN POSITIONS:
${portfolioDetail}

═══════════════════════════════════════════════
LIVE MARKET DATA (CoinGecko, real prices)
RSI<30=oversold/buy, RSI>70=overbought/sell
BB%<20=near lower band, BB%>80=near upper band
VOL_RATIO>1.5=elevated volume (confirms moves)
MOM10=10-tick price momentum %
═══════════════════════════════════════════════
${marketSummary}

═══════════════════════════════════════════════
RISK RULES (hard limits — never violate)
═══════════════════════════════════════════════
- Max single trade: $${MAX_TRADE}
- Max position size: ${(MAX_POS_PCT * 100).toFixed(0)}% of total portfolio value
- Stop-loss trigger: ${(STOP_LOSS * 100).toFixed(0)}% below entry
- Take-profit target: ${(TAKE_PROFIT * 100).toFixed(0)}% above entry
- Max portfolio drawdown: ${(MAX_DRAWDOWN * 100).toFixed(0)}% — if hit, go to cash
- Fee per trade: 0.6% — factor into all decisions
- Minimum trade: $5

═══════════════════════════════════════════════
DECISION FRAMEWORK
═══════════════════════════════════════════════
STRONG BUY signals: RSI<35 + upward momentum + volume spike + price near lower BB
STRONG SELL signals: RSI>68 + negative momentum + position up >6%
STOP LOSS: Any position down >${(STOP_LOSS*100).toFixed(0)}% → immediate full exit
TAKE PROFIT: Any position up >${(TAKE_PROFIT*100).toFixed(0)}% → take 60% off
HOLD: No clear signal, or insufficient price history (<15 ticks)
${drawdown > 0.15 ? '\n⚠️ WARNING: DRAWDOWN >15% — CAPITAL PRESERVATION MODE. Only take highest-confidence buys.' : ''}

Think step by step about each coin. Then respond ONLY with valid JSON (no markdown, no explanation):

{
  "action": "BUY" | "SELL" | "HOLD",
  "coin": "BTC"|"ETH"|"SOL"|"ADA"|"AVAX"|"LINK"|"XRP"|"DOGE"|null,
  "usdAmount": <number 5-${MAX_TRADE}, only for BUY>,
  "sellPct": <0.25-1.0, fraction of position to sell, only for SELL>,
  "confidence": <1-10>,
  "signals": ["signal1", "signal2"],
  "reasoning": "<3-4 sentences citing specific indicator values and price action>"
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0]?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  const decision = JSON.parse(clean);

  // Validate and clamp
  if (decision.usdAmount) decision.usdAmount = Math.min(decision.usdAmount, MAX_TRADE, balance);
  if (decision.sellPct)   decision.sellPct   = Math.max(0.1, Math.min(1, decision.sellPct));

  return decision;
}

/** Quantitative rules-based engine (fallback / no API key) */
export function getRulesDecision(prices, portfolio, balance, state) {
  const totalValue = calcTotalValue(prices, portfolio, balance);
  const drawdown = state.peakValue > 0 ? (state.peakValue - totalValue) / state.peakValue : 0;

  // ── Hard stop: max drawdown breached → liquidate everything ───────────────
  if (drawdown >= MAX_DRAWDOWN) {
    const firstHeld = Object.keys(portfolio)[0];
    if (firstHeld) {
      return {
        action: 'SELL', coin: firstHeld, sellPct: 1.0, confidence: 10,
        signals: ['MAX_DRAWDOWN_BREACHED'],
        reasoning: `Portfolio drawdown ${(drawdown*100).toFixed(1)}% exceeds ${(MAX_DRAWDOWN*100).toFixed(0)}% limit. Emergency liquidation to preserve capital.`,
      };
    }
  }

  // ── Check stop-losses and take-profits on open positions ──────────────────
  for (const [sym, pos] of Object.entries(portfolio)) {
    const cur = prices[sym]?.price;
    if (!cur) continue;
    const pnlPct = (cur - pos.avgCost) / pos.avgCost;

    if (pnlPct <= -STOP_LOSS) {
      return {
        action: 'SELL', coin: sym, sellPct: 1.0, confidence: 9,
        signals: ['STOP_LOSS_HIT'],
        reasoning: `Stop-loss triggered on ${sym}. Position down ${(pnlPct*100).toFixed(2)}% from entry at $${pos.avgCost.toFixed(4)}. Exiting full position to limit losses.`,
      };
    }
    if (pnlPct >= TAKE_PROFIT) {
      return {
        action: 'SELL', coin: sym, sellPct: 0.6, confidence: 8,
        signals: ['TAKE_PROFIT_HIT'],
        reasoning: `Take-profit at ${(pnlPct*100).toFixed(2)}% gain on ${sym}. Selling 60% of position at $${cur.toFixed(4)}, keeping 40% for continued upside.`,
      };
    }
  }

  // ── Scan for buy opportunities ────────────────────────────────────────────
  if (balance < 5) {
    return { action: 'HOLD', coin: null, confidence: 5, signals: ['LOW_CASH'], reasoning: 'Insufficient cash for minimum trade. Holding all positions.' };
  }

  const candidates = [];

  for (const { symbol } of COINS) {
    const ind = computeIndicators(symbol);
    if (ind.priceCount < 10) continue; // need history

    const px = prices[symbol]?.price;
    if (!px) continue;

    // Check concentration limit
    const posValue = (portfolio[symbol]?.qty || 0) * px;
    if (posValue / totalValue > MAX_POS_PCT) continue;

    let score = 0;
    const signals = [];

    // RSI signals
    if (ind.rsi !== null) {
      if (ind.rsi < 30) { score += 3; signals.push(`RSI_OVERSOLD(${ind.rsi.toFixed(1)})`); }
      else if (ind.rsi < 40) { score += 1; signals.push(`RSI_LOW(${ind.rsi.toFixed(1)})`); }
    }

    // Momentum
    if (ind.momentum10 !== null) {
      if (ind.momentum10 > 0.5) { score += 2; signals.push(`MOM10_POS(${ind.momentum10.toFixed(2)}%)`); }
      if (ind.momentum5 !== null && ind.momentum5 > 0.2) { score += 1; signals.push(`MOM5_POS`); }
    }

    // Bollinger Band — near lower band
    if (ind.bb && px) {
      const bbPct = (px - ind.bb.lower) / (ind.bb.upper - ind.bb.lower);
      if (bbPct < 0.2) { score += 2; signals.push(`NEAR_BB_LOWER(${(bbPct*100).toFixed(0)}%)`); }
    }

    // EMA crossover signal
    if (ind.ema9 && ind.ema21 && ind.ema9 > ind.ema21) {
      score += 1; signals.push('EMA9_ABOVE_EMA21');
    }

    // Volume confirmation
    if (ind.volumeRatio > 1.5) { score += 1; signals.push(`VOL_SPIKE(${ind.volumeRatio.toFixed(1)}x)`); }

    // 24h momentum
    if (prices[symbol]?.change24h > 2) { score += 1; signals.push('24H_POSITIVE'); }

    if (score >= 4) {
      candidates.push({ symbol, score, signals, ind });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const spend = +Math.min(MAX_TRADE, balance * 0.25, balance - 2).toFixed(2);

    return {
      action: 'BUY',
      coin: best.symbol,
      usdAmount: spend,
      confidence: Math.min(10, Math.round(best.score * 1.2)),
      signals: best.signals,
      reasoning: `${best.symbol} scores ${best.score}/10 across ${best.signals.length} signals. RSI=${best.ind.rsi?.toFixed(1) || '—'}, Momentum=${best.ind.momentum10?.toFixed(2) || '—'}%. Entering $${spend} position with current confirmation.`,
    };
  }

  return {
    action: 'HOLD', coin: null, confidence: 4,
    signals: ['NO_SETUP'],
    reasoning: 'No coins meet minimum score threshold (4+). Market conditions unclear or insufficient price history. Preserving capital.',
  };
}

export function calcTotalValue(prices, portfolio, balance) {
  let val = balance;
  for (const [sym, { qty }] of Object.entries(portfolio)) {
    val += qty * (prices[sym]?.price || 0);
  }
  return val;
}

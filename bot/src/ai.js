/**
 * NEXUS TRADER · AI Decision Engine v2
 * Claude Opus — multi-strategy, leverage-aware, high conviction
 * Strategies: momentum, mean reversion, breakout, RSI divergence,
 *             EMA crossover, BB squeeze, volume surge, perp leverage
 */

import Anthropic from '@anthropic-ai/sdk';
import { computeIndicators, COINS } from './market.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TRADE    = parseFloat(process.env.MAX_TRADE_USD    || '20');
const MAX_POS_PCT  = parseFloat(process.env.MAX_POSITION_PCT || '0.35');
const STOP_LOSS    = parseFloat(process.env.STOP_LOSS_PCT    || '0.05');
const TAKE_PROFIT  = parseFloat(process.env.TAKE_PROFIT_PCT  || '0.08');
const MAX_DRAWDOWN = parseFloat(process.env.MAX_DRAWDOWN_PCT || '0.20');
const LEVERAGE_ON  = process.env.LEVERAGE_ENABLED === 'true';
const MAX_LEVERAGE = parseInt(process.env.MAX_LEVERAGE || '5');

export async function getAIDecision(marketSummary, prices, portfolio, balance, state) {
  const totalValue = calcTotalValue(prices, portfolio, balance);
  const drawdown   = state.peakValue > 0 ? (state.peakValue - totalValue) / state.peakValue : 0;
  const leverageEnabled = state.leverageEnabled ?? LEVERAGE_ON;
  const maxLev    = state.maxLeverage ?? MAX_LEVERAGE;

  const portfolioDetail = Object.entries(portfolio).map(([sym, pos]) => {
    const cur    = prices[sym]?.price || 0;
    const pnlPct = pos.avgCost > 0 ? ((cur - pos.avgCost) / pos.avgCost * 100).toFixed(2) : '0.00';
    const posVal = (pos.qty * cur).toFixed(2);
    const levStr = pos.leverage ? ` LEVERAGE:${pos.leverage}x PERP:${pos.isPerp ? 'YES' : 'NO'}` : '';
    return `  ${sym}: qty=${pos.qty.toFixed(6)} avgCost=$${pos.avgCost.toFixed(4)} now=$${cur.toFixed(4)} value=$${posVal} PnL=${pnlPct}%${levStr}`;
  }).join('\n') || '  (no positions)';

  const recentTrades = (state.trades || []).slice(0, 5).map(t =>
    `  ${t.type} ${t.coin || 'HOLD'} conf:${t.confidence}/10 — ${t.reasoning?.slice(0, 80)}`
  ).join('\n') || '  (none yet)';

  const prompt = `You are NEXUS, an elite autonomous crypto trading AI. You combine the best of Renaissance Technologies (quant signals), Paul Tudor Jones (macro momentum), and Cathie Wood (high-conviction asymmetric bets). Your mandate: grow this portfolio aggressively and intelligently.

═══════════════════════════════════════════════
PORTFOLIO STATUS
═══════════════════════════════════════════════
Cash:           $${balance.toFixed(4)}
Total Value:    $${totalValue.toFixed(4)}
Started:        $${state.startingBalance.toFixed(2)}
All-time PnL:   ${totalValue >= state.startingBalance ? '+' : ''}$${(totalValue - state.startingBalance).toFixed(4)} (${((totalValue/state.startingBalance-1)*100).toFixed(2)}%)
Peak Value:     $${state.peakValue.toFixed(4)}
Drawdown:       ${(drawdown*100).toFixed(2)}%
Fees Paid:      $${(state.totalFeesUSD||0).toFixed(4)}
Cycles Run:     ${state.cycleCount}
Leverage Mode:  ${leverageEnabled ? `ENABLED (max ${maxLev}x)` : 'DISABLED'}

OPEN POSITIONS:
${portfolioDetail}

RECENT DECISIONS:
${recentTrades}

═══════════════════════════════════════════════
LIVE MARKET DATA (Binance, real-time)
RSI: <30=oversold(buy) >70=overbought(sell)
BB%: <15=near lower band >85=near upper band
MOM10: 10-tick momentum % (positive=bullish)
VOL: volume ratio vs 5-tick avg (>1.5=spike)
═══════════════════════════════════════════════
${marketSummary}

═══════════════════════════════════════════════
TRADING STRATEGIES — use all that apply
═══════════════════════════════════════════════
1. MOMENTUM: RSI 40-60 + rising MOM10 + VOL>1.5 → BUY trending coin
2. MEAN REVERSION: RSI<28 + near BB lower + MOM recovering → BUY oversold
3. BREAKOUT: BB% crossing 80 + VOL spike >2x → BUY breakout with tight stop
4. EMA CROSS: EMA9 crosses above EMA21 → BUY; crosses below → SELL
5. RSI DIVERGENCE: Price making new low but RSI higher → bullish divergence BUY
6. TAKE PROFIT: Position up >${(TAKE_PROFIT*100).toFixed(0)}% → sell 60%, hold 40% for runners
7. STOP LOSS: Position down >${(STOP_LOSS*100).toFixed(0)}% → full exit, no exceptions
8. HIGH RISK/REWARD: If RSI<25 + VOL>2x + MOM recovering → aggressive full $${MAX_TRADE} entry
${leverageEnabled ? `9. LEVERAGE PERP: If 3+ strong signals align on a coin → consider perp position with ${Math.min(maxLev,3)}x-${maxLev}x leverage. Only use leverage when confidence >= 8/10. Leveraged perps amplify gains AND losses — only in strong trending markets.` : ''}

RISK RULES (hard limits):
- Max single spot trade: $${MAX_TRADE}
- Max position: ${(MAX_POS_PCT*100).toFixed(0)}% of portfolio
- Max drawdown: ${(MAX_DRAWDOWN*100).toFixed(0)}% → emergency liquidate all
- Min trade: $5, fee: 0.6% per side
- HOLD is valid — never force a bad trade${drawdown > 0.15 ? '\n⚠️ DRAWDOWN WARNING >15% — CAPITAL PRESERVATION MODE ACTIVE' : ''}

Analyze all coins. Pick the single best opportunity. Think step by step.
Respond ONLY with valid JSON — no markdown, no text outside JSON:

{
  "action": "BUY" | "SELL" | "HOLD",
  "coin": "BTC"|"ETH"|"SOL"|"ADA"|"AVAX"|"LINK"|"XRP"|"DOGE"|null,
  "usdAmount": <5-${MAX_TRADE}, only for BUY>,
  "sellPct": <0.25-1.0, only for SELL>,
  "isPerp": <true|false — leverage perpetual trade>,
  "leverage": <2-${maxLev}, only if isPerp:true>,
  "strategy": "MOMENTUM"|"MEAN_REVERSION"|"BREAKOUT"|"EMA_CROSS"|"TAKE_PROFIT"|"STOP_LOSS"|"HIGH_RISK_REWARD"|"HOLD",
  "confidence": <1-10>,
  "signals": ["signal1", "signal2", "signal3"],
  "reasoning": "<4-5 sentences: name the strategy, cite specific indicator values, explain entry/exit logic, state the risk>"
}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });

  const text  = response.content[0]?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  const dec   = JSON.parse(clean);

  // Clamp values
  if (dec.usdAmount) dec.usdAmount = Math.min(dec.usdAmount, MAX_TRADE, balance);
  if (dec.sellPct)   dec.sellPct   = Math.max(0.1, Math.min(1, dec.sellPct));
  if (dec.leverage)  dec.leverage  = Math.max(2, Math.min(maxLev, dec.leverage));

  // Safety: block leverage if disabled
  if (!leverageEnabled && dec.isPerp) {
    dec.isPerp  = false;
    dec.leverage = 1;
  }

  // Safety: block leverage on low confidence
  if (dec.isPerp && dec.confidence < 8) {
    dec.isPerp  = false;
    dec.leverage = 1;
  }

  return dec;
}

/** Quantitative rules engine — runs when no Claude API key */
export function getRulesDecision(prices, portfolio, balance, state) {
  const totalValue       = calcTotalValue(prices, portfolio, balance);
  const drawdown         = state.peakValue > 0 ? (state.peakValue - totalValue) / state.peakValue : 0;
  const leverageEnabled  = state.leverageEnabled ?? LEVERAGE_ON;

  // Hard stop: max drawdown
  if (drawdown >= MAX_DRAWDOWN) {
    const sym = Object.keys(portfolio)[0];
    if (sym) return {
      action: 'SELL', coin: sym, sellPct: 1.0, confidence: 10,
      strategy: 'STOP_LOSS', isPerp: false, leverage: 1,
      signals: ['MAX_DRAWDOWN_HIT'],
      reasoning: `Portfolio drawdown ${(drawdown*100).toFixed(1)}% hit ${(MAX_DRAWDOWN*100).toFixed(0)}% limit. Emergency liquidation of ${sym} to preserve capital. All positions will be closed.`,
    };
  }

  // Check stop-loss / take-profit on open positions
  for (const [sym, pos] of Object.entries(portfolio)) {
    const cur   = prices[sym]?.price;
    if (!cur) continue;
    const pnlPct = (cur - pos.avgCost) / pos.avgCost;
    const lev    = pos.leverage || 1;
    const effPnl = pnlPct * lev;

    if (effPnl <= -STOP_LOSS) return {
      action: 'SELL', coin: sym, sellPct: 1.0, confidence: 10,
      strategy: 'STOP_LOSS', isPerp: pos.isPerp || false, leverage: lev,
      signals: [`STOP_LOSS_HIT(${(effPnl*100).toFixed(1)}%)`],
      reasoning: `Stop-loss triggered on ${sym}. Position down ${(effPnl*100).toFixed(2)}% (${lev}x leveraged). Entry was $${pos.avgCost.toFixed(4)}, now $${cur.toFixed(4)}. Exiting full position to cut losses.`,
    };

    if (effPnl >= TAKE_PROFIT) return {
      action: 'SELL', coin: sym, sellPct: 0.6, confidence: 8,
      strategy: 'TAKE_PROFIT', isPerp: pos.isPerp || false, leverage: lev,
      signals: [`TAKE_PROFIT_HIT(+${(effPnl*100).toFixed(1)}%)`],
      reasoning: `Take-profit triggered on ${sym}. Position up ${(effPnl*100).toFixed(2)}% (${lev}x). Selling 60% at $${cur.toFixed(4)} to lock gains. Holding 40% for continued upside.`,
    };
  }

  if (balance < 5) return {
    action: 'HOLD', coin: null, confidence: 5, strategy: 'HOLD',
    signals: ['LOW_CASH'], reasoning: 'Insufficient cash for minimum $5 trade. Holding all positions and waiting for capital to free up.',
  };

  // Score each coin for best buy opportunity
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

    // Mean reversion
    if (ind.rsi !== null && ind.rsi < 28) { score += 4; signals.push(`RSI_OVERSOLD(${ind.rsi.toFixed(1)})`); strategy = 'MEAN_REVERSION'; }
    else if (ind.rsi !== null && ind.rsi < 38) { score += 2; signals.push(`RSI_LOW(${ind.rsi.toFixed(1)})`); }

    // Momentum
    if (ind.momentum10 !== null && ind.momentum10 > 0.4) { score += 2; signals.push(`MOM10_BULL(${ind.momentum10.toFixed(2)}%)`); }
    if (ind.momentum5  !== null && ind.momentum5  > 0.2) { score += 1; signals.push('MOM5_BULL'); }

    // Bollinger Bands
    if (ind.bb && px) {
      const bbPct = (px - ind.bb.lower) / (ind.bb.upper - ind.bb.lower);
      if (bbPct < 0.15) { score += 3; signals.push(`BB_LOWER(${(bbPct*100).toFixed(0)}%)`); strategy = 'MEAN_REVERSION'; }
      else if (bbPct > 0.85) { score += 1; signals.push('BB_UPPER_BREAK'); strategy = 'BREAKOUT'; }
    }

    // EMA cross
    if (ind.ema9 && ind.ema21 && ind.ema9 > ind.ema21) { score += 1; signals.push('EMA9_ABOVE_21'); strategy = 'EMA_CROSS'; }

    // Volume spike
    if (ind.volumeRatio > 2.0) { score += 2; signals.push(`VOL_SPIKE(${ind.volumeRatio.toFixed(1)}x)`); }
    else if (ind.volumeRatio > 1.5) { score += 1; signals.push('VOL_ELEVATED'); }

    // 24h momentum
    if ((prices[symbol]?.change24h || 0) > 3) { score += 1; signals.push('24H_BULL'); }

    // High risk/reward — oversold + volume
    if (ind.rsi !== null && ind.rsi < 25 && ind.volumeRatio > 2) {
      score += 2; signals.push('HIGH_RR_SETUP'); strategy = 'HIGH_RISK_REWARD';
    }

    if (score >= 4) candidates.push({ symbol, score, signals, strategy, ind });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best  = candidates[0];
    const spend = +Math.min(MAX_TRADE, balance * 0.28, balance - 2).toFixed(2);
    if (spend < 5) return { action: 'HOLD', coin: null, confidence: 4, strategy: 'HOLD', signals: ['LOW_CASH'], reasoning: 'Good setup found but insufficient cash for minimum trade.' };

    // Consider leverage on very high confidence setups
    const usePerp = leverageEnabled && best.score >= 7 && drawdown < 0.1;
    const lev     = usePerp ? Math.min(3, MAX_LEVERAGE) : 1;

    return {
      action: 'BUY', coin: best.symbol, usdAmount: spend,
      isPerp: usePerp, leverage: lev,
      confidence: Math.min(10, Math.round(best.score * 1.1)),
      strategy: best.strategy, signals: best.signals,
      reasoning: `${best.strategy} setup on ${best.symbol} (score ${best.score}/10). RSI=${best.ind.rsi?.toFixed(1)||'—'}, MOM10=${best.ind.momentum10?.toFixed(2)||'—'}%, VOL=${best.ind.volumeRatio?.toFixed(2)||'—'}x. Entering $${spend}${usePerp ? ` with ${lev}x leverage` : ''}. Stop at -${(STOP_LOSS*100).toFixed(0)}%, target +${(TAKE_PROFIT*100).toFixed(0)}%.`,
    };
  }

  return {
    action: 'HOLD', coin: null, confidence: 4, strategy: 'HOLD',
    signals: ['NO_SETUP'],
    reasoning: `No coins met minimum threshold (score 4+) this cycle. Scanned ${COINS.length} pairs. Market conditions unclear or insufficient price history. Capital preserved, watching for next opportunity.`,
  };
}

export function calcTotalValue(prices, portfolio, balance) {
  let val = balance;
  for (const [sym, { qty, leverage = 1 }] of Object.entries(portfolio)) {
    val += qty * (prices[sym]?.price || 0);
  }
  return val;
}

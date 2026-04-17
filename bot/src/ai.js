/**
 * NEXUS TRADER · AI Decision Engine v5
 * Uses scoreForBuy + evaluateExit from market.js
 * Gemini Flash for final confirmation on top setups
 */

import axios from 'axios';
import { computeIndicators, scoreForBuy, evaluateExit, COINS } from './market.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

const MAX_TRADE    = parseFloat(process.env.MAX_TRADE_USD    || '20');
const STOP_LOSS    = parseFloat(process.env.STOP_LOSS_PCT    || '0.05');
const TAKE_PROFIT  = parseFloat(process.env.TAKE_PROFIT_PCT  || '0.08');
const MAX_DRAWDOWN = parseFloat(process.env.MAX_DRAWDOWN_PCT || '0.20');
const FEE          = 0.006;
const MIN_SCORE    = 8; // minimum score out of ~18 to consider a trade

async function callGemini(prompt) {
  if (!GEMINI_KEY) return null;
  try {
    const res = await axios.post(GEMINI_URL, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 400, topP: 0.8 },
    }, { timeout: 12000 });
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error('[Gemini]', e.message);
    return null;
  }
}

export async function getAIDecision(marketSummary, prices, portfolio, balance, state) {
  const totalValue = calcTotalValue(prices, portfolio, balance);
  const drawdown   = state.peakValue > 0 ? (state.peakValue - totalValue) / state.peakValue : 0;

  // ── Step 1: Check exits first ──────────────────────────────────────────────
  for (const [sym, pos] of Object.entries(portfolio)) {
    const exit = evaluateExit(sym, pos, prices, STOP_LOSS, TAKE_PROFIT);
    if (exit) return { ...exit, coin: sym };
  }

  // ── Step 2: Emergency drawdown liquidation ─────────────────────────────────
  if (drawdown >= MAX_DRAWDOWN && Object.keys(portfolio).length > 0) {
    const sym = Object.keys(portfolio)[0];
    return { action: 'SELL', coin: sym, sellPct: 1.0, confidence: 10,
      strategy: 'STOP_LOSS', signals: ['MAX_DRAWDOWN'],
      reasoning: `Max drawdown ${(drawdown*100).toFixed(1)}% hit. Emergency exit.` };
  }

  // ── Step 3: Score all coins for buy opportunity ────────────────────────────
  if (balance < 5) {
    return { action: 'HOLD', coin: null, confidence: 5, strategy: 'HOLD',
      signals: ['LOW_CASH'], reasoning: 'Cash below $5 minimum trade size. Holding.' };
  }

  const candidates = [];
  for (const { symbol } of COINS) {
    const { score, signals, strategy, ind } = scoreForBuy(symbol, prices, portfolio, balance);
    if (score >= MIN_SCORE) candidates.push({ symbol, score, signals, strategy, ind });
  }
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { action: 'HOLD', coin: null, confidence: 4, strategy: 'HOLD',
      signals: ['NO_SETUP'],
      reasoning: `Scanned ${COINS.length} pairs — none scored ${MIN_SCORE}+. Market unclear or RSI still falling. Preserving capital.` };
  }

  const best = candidates[0];

  // ── Step 4: Gemini confirmation for high-score setups ─────────────────────
  if (GEMINI_KEY && best.score >= 11) {
    const prompt = `You are a professional crypto trading AI. Confirm if this is a good entry.

PROPOSED: BUY ${best.symbol} | Score: ${best.score}/18 | Strategy: ${best.strategy}
Signals: ${best.signals.join(', ')}

MARKET DATA:
${marketSummary}

Reply ONLY with JSON:
{"confirm":true|false,"confidence":<1-10>,"reasoning":"<2 sentences>"}`;

    const ai = await callGemini(prompt);
    if (ai && ai.confirm === false) {
      return { action: 'HOLD', coin: null, confidence: 3, strategy: 'HOLD',
        signals: ['AI_REJECTED'],
        reasoning: `AI rejected ${best.symbol} entry: ${ai.reasoning}` };
    }
  }

  // ── Step 5: Size position with Kelly-style sizing ─────────────────────────
  const kelly    = Math.max(0.1, Math.min(0.25, (best.score / 18) * 0.3));
  const spend    = +Math.min(kelly * balance, MAX_TRADE, balance - 2).toFixed(2);

  return {
    action:     'BUY',
    coin:       best.symbol,
    usdAmount:  Math.max(5, spend),
    isPerp:     false,
    leverage:   1,
    strategy:   best.strategy,
    confidence: Math.min(10, Math.round(best.score * 0.65)),
    signals:    best.signals,
    reasoning:  `${best.strategy} on ${best.symbol} (score ${best.score}/18). RSI=${best.ind.rsi?.toFixed(1)||'—'}(${best.ind.rsiRecovering?'recovering':'caution'}), MACD=${best.ind.macd?.bullish?'bullish':'neutral'}, VOL=${best.ind.volumeRatio?.toFixed(2)||'—'}x. Kelly size $${spend}.`,
  };
}

// Rules fallback — same logic, no AI call
export function getRulesDecision(prices, portfolio, balance, state) {
  const totalValue = calcTotalValue(prices, portfolio, balance);
  const drawdown   = state.peakValue > 0 ? (state.peakValue - totalValue) / state.peakValue : 0;

  for (const [sym, pos] of Object.entries(portfolio)) {
    const exit = evaluateExit(sym, pos, prices, STOP_LOSS, TAKE_PROFIT);
    if (exit) return { ...exit, coin: sym };
  }

  if (drawdown >= MAX_DRAWDOWN && Object.keys(portfolio).length > 0) {
    const sym = Object.keys(portfolio)[0];
    return { action: 'SELL', coin: sym, sellPct: 1.0, confidence: 10,
      strategy: 'STOP_LOSS', signals: ['MAX_DRAWDOWN'], reasoning: 'Emergency liquidation.' };
  }

  if (balance < 5) return { action: 'HOLD', coin: null, confidence: 5, strategy: 'HOLD', signals: ['LOW_CASH'], reasoning: 'Insufficient cash.' };

  const candidates = [];
  for (const { symbol } of COINS) {
    const { score, signals, strategy, ind } = scoreForBuy(symbol, prices, portfolio, balance);
    if (score >= MIN_SCORE) candidates.push({ symbol, score, signals, strategy, ind });
  }
  candidates.sort((a, b) => b.score - a.score);

  if (!candidates.length) return { action: 'HOLD', coin: null, confidence: 4, strategy: 'HOLD', signals: ['NO_SETUP'], reasoning: `No coins scored ${MIN_SCORE}+. Waiting for better setup.` };

  const best  = candidates[0];
  const spend = +Math.min((best.score / 18) * 0.25 * balance, MAX_TRADE, balance - 2).toFixed(2);
  return {
    action: 'BUY', coin: best.symbol, usdAmount: Math.max(5, spend),
    isPerp: false, leverage: 1, strategy: best.strategy,
    confidence: Math.min(10, Math.round(best.score * 0.65)),
    signals: best.signals,
    reasoning: `${best.strategy} on ${best.symbol} (score ${best.score}/18). ${best.signals.slice(0, 3).join(', ')}.`,
  };
}

export function calcTotalValue(prices, portfolio, balance) {
  let v = balance;
  for (const [sym, { qty }] of Object.entries(portfolio)) v += qty * (prices[sym]?.price || 0);
  return v;
}

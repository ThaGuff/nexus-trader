/**
 * NEXUS TRADER · Trade Executor
 * Handles both PAPER (simulated) and LIVE (Coinbase Advanced Trade) execution
 */

import axios from 'axios';
import crypto from 'crypto';

const FEE = 0.006; // 0.6% taker fee
const MODE = process.env.TRADING_MODE || 'PAPER';

// ── Coinbase Advanced Trade API (JWT auth) ────────────────────────────────────
function getCoinbaseHeaders(method, path, body = '') {
  const apiKey    = process.env.COINBASE_API_KEY || '';
  const apiSecret = process.env.COINBASE_API_SECRET || '';

  if (!apiKey || !apiSecret) return {};

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message   = timestamp + method.toUpperCase() + path + body;
  const sig       = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');

  return {
    'CB-ACCESS-KEY':       apiKey,
    'CB-ACCESS-SIGN':      sig,
    'CB-ACCESS-TIMESTAMP': timestamp,
    'Content-Type':        'application/json',
  };
}

async function coinbaseOrder(side, productId, quoteSize) {
  const path = '/api/v3/brokerage/orders';
  const body = JSON.stringify({
    client_order_id: `nexus-${Date.now()}`,
    product_id: productId,
    side: side.toUpperCase(),
    order_configuration: {
      market_market_ioc: { quote_size: quoteSize.toFixed(2) },
    },
  });

  const res = await axios.post(`https://api.coinbase.com${path}`, body, {
    headers: getCoinbaseHeaders('POST', path, body),
  });
  return res.data;
}

/** Execute a BUY — returns { qty, price, fee, gross, net } */
export async function executeBuy(coin, usdAmount, currentPrice) {
  const gross = usdAmount;
  const fee   = gross * FEE;
  const net   = gross - fee;
  const qty   = net / currentPrice;

  if (MODE === 'LIVE') {
    try {
      const productId = `${coin}-USD`;
      await coinbaseOrder('BUY', productId, gross);
      console.log(`[Executor] LIVE BUY ${coin} $${gross.toFixed(2)}`);
    } catch (e) {
      console.error(`[Executor] Coinbase BUY failed: ${e.message} — falling back to paper`);
    }
  }

  return { qty, price: currentPrice, fee, gross, net };
}

/** Execute a SELL — returns { proceeds, fee, gross } */
export async function executeSell(coin, qty, sellPct, currentPrice) {
  const sellQty    = qty * Math.min(sellPct, 1);
  const gross      = sellQty * currentPrice;
  const fee        = gross * FEE;
  const netProceeds = gross - fee;

  if (MODE === 'LIVE') {
    try {
      const productId = `${coin}-USD`;
      await coinbaseOrder('SELL', productId, gross);
      console.log(`[Executor] LIVE SELL ${coin} $${gross.toFixed(2)}`);
    } catch (e) {
      console.error(`[Executor] Coinbase SELL failed: ${e.message} — falling back to paper`);
    }
  }

  return { sellQty, price: currentPrice, fee, gross, netProceeds };
}

export { FEE, MODE };

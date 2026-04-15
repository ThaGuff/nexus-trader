/**
 * NEXUS TRADER · Notifications
 * Discord webhook for trade alerts
 */

import axios from 'axios';

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

export async function notify(trade, totalValue) {
  if (!WEBHOOK) return;

  const isProfit = trade.pnl === undefined ? null : trade.pnl >= 0;
  const emoji = trade.type === 'BUY' ? '🟢' : isProfit ? '🔵' : '🔴';
  const pnlStr = trade.pnl !== undefined ? ` | PnL: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(3)}` : '';

  const content = `${emoji} **NEXUS BOT** · ${trade.type} ${trade.coin}
💵 Amount: $${trade.gross?.toFixed(2)} | Fee: $${trade.fee?.toFixed(3)}${pnlStr}
📊 Portfolio Value: $${totalValue.toFixed(2)}
🧠 ${trade.reasoning?.slice(0, 120)}...`;

  try {
    await axios.post(WEBHOOK, { content });
  } catch (e) {
    console.error('[Notify] Discord webhook failed:', e.message);
  }
}

export async function notifyStart(mode, balance) {
  if (!WEBHOOK) return;
  try {
    await axios.post(WEBHOOK, {
      content: `🚀 **NEXUS TRADER STARTED**\nMode: ${mode} | Starting Balance: $${balance.toFixed(2)}\nBot is now running 24/7.`,
    });
  } catch {}
}

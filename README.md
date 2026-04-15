# NEXUS TRADER
## Autonomous Crypto Trading Engine · Railway Deployment

An end-to-end autonomous crypto trading bot with:
- **Claude Opus AI** decision engine using multi-signal technical analysis
- **Real-time dashboard** with WebSocket live updates
- **Paper + Live trading** modes (Coinbase Advanced Trade API)
- **Railway deployment** ready — one push to go live

---

## Architecture

```
nexus-trader/
├── bot/                    # Node.js trading engine
│   └── src/
│       ├── index.js        # Entry point
│       ├── bot.js          # Main trading loop orchestrator
│       ├── ai.js           # Claude AI + rules-based decision engine
│       ├── market.js       # CoinGecko price feeds + technical indicators
│       ├── executor.js     # Paper + Coinbase live trade execution
│       ├── server.js       # Express HTTP + WebSocket server
│       ├── state.js        # Persistent state management
│       └── notify.js       # Discord webhook notifications
├── dashboard/              # React + Vite frontend
│   └── src/
│       ├── App.jsx         # Full trading dashboard UI
│       ├── main.jsx        # React entry
│       └── useTraderSocket.js  # WebSocket hook
├── railway.toml            # Railway deployment config
├── nixpacks.toml           # Build config
├── Dockerfile              # Docker fallback
└── .env.example            # Environment variables template
```

---

## Quick Start (Local)

```bash
# 1. Clone and enter
git clone <your-repo>
cd nexus-trader

# 2. Set up environment
cp .env.example .env
# Edit .env with your keys (see below)

# 3. Install all deps
cd dashboard && npm install && cd ..
cd bot && npm install && cd ..

# 4. Build dashboard
cd dashboard && npm run build && cd ..

# 5. Start bot
node bot/src/index.js

# Dashboard: http://localhost:3000
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `COINGECKO_API_KEY` | ✅ Yes | Free key from coingecko.com/en/api |
| `ANTHROPIC_API_KEY` | ✅ Yes | From console.anthropic.com |
| `TRADING_MODE` | ✅ Yes | `PAPER` (safe) or `LIVE` |
| `STARTING_BALANCE` | ✅ Yes | Starting capital in USD (e.g. `100`) |
| `COINBASE_API_KEY` | LIVE only | From coinbase.com/settings/api |
| `COINBASE_API_SECRET` | LIVE only | EC private key from Coinbase |
| `DASHBOARD_SECRET` | ✅ Yes | Random string for API auth |
| `PORT` | Optional | Default: 3000 |
| `CYCLE_INTERVAL_SECONDS` | Optional | Default: 60 |
| `MAX_TRADE_USD` | Optional | Default: 20 |
| `STOP_LOSS_PCT` | Optional | Default: 0.05 (5%) |
| `TAKE_PROFIT_PCT` | Optional | Default: 0.08 (8%) |
| `MAX_DRAWDOWN_PCT` | Optional | Default: 0.20 (20%) |
| `DISCORD_WEBHOOK_URL` | Optional | Trade alerts to Discord |

---

## Railway Deployment (Step by Step)

### Step 1 — Get your API keys

**CoinGecko (free, required for prices):**
1. Go to [coingecko.com/en/api](https://coingecko.com/en/api)
2. Create Free Account → Developer Dashboard → Add New Key
3. Key starts with `CG-`

**Anthropic (required for AI decisions):**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. API Keys → Create Key
3. Key starts with `sk-ant-`

**Coinbase Advanced Trade (LIVE mode only):**
1. Go to [coinbase.com/settings/api](https://coinbase.com/settings/api)
2. Create new API key → Advanced Trade
3. Permissions: View + Trade
4. Save both the API Key (path format) and Secret (EC private key)

### Step 2 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial NEXUS TRADER deployment"
git remote add origin https://github.com/YOUR_USERNAME/nexus-trader.git
git push -u origin main
```

### Step 3 — Deploy on Railway

1. Go to [railway.app](https://railway.app) → New Project
2. Click **Deploy from GitHub repo**
3. Select your `nexus-trader` repo
4. Railway auto-detects `railway.toml` and builds

### Step 4 — Set Environment Variables

In Railway dashboard → your service → **Variables** tab, add:

```
COINGECKO_API_KEY=CG-your-key
ANTHROPIC_API_KEY=sk-ant-your-key
TRADING_MODE=PAPER
STARTING_BALANCE=100
MAX_TRADE_USD=20
DASHBOARD_SECRET=some-random-string-here
STOP_LOSS_PCT=0.05
TAKE_PROFIT_PCT=0.08
MAX_DRAWDOWN_PCT=0.20
CYCLE_INTERVAL_SECONDS=60
PORT=3000
```

### Step 5 — Add Volume for State Persistence

In Railway → your service → **Volumes** tab:
- Mount path: `/app/data`

This ensures trade history and portfolio state survive restarts.

### Step 6 — Enable Public Domain

Railway → Settings → **Generate Domain**
Your dashboard will be live at `https://your-service.up.railway.app`

---

## Going LIVE (Real Money)

⚠️ **Run in PAPER mode for at least 2 weeks before going live.**

When ready:
1. Change `TRADING_MODE=PAPER` → `TRADING_MODE=LIVE`
2. Add `COINBASE_API_KEY` and `COINBASE_API_SECRET`
3. Start with a small amount ($25–50) to verify execution
4. Monitor closely for first few hours

---

## Trading Strategy

The bot runs a multi-signal analysis on every cycle:

**Buy Signals (scored 1–10):**
- RSI < 30 (oversold) → +3 points
- RSI < 40 → +1 point
- 10-tick momentum positive → +2 points
- Price near lower Bollinger Band → +2 points
- EMA9 above EMA21 (golden cross) → +1 point
- Volume spike > 1.5x average → +1 point
- 24h change positive → +1 point

**Auto-Sell Triggers:**
- Position down 5% → stop-loss (full exit)
- Position up 8% → take-profit (60% exit, hold 40%)
- Portfolio drawdown > 20% → emergency liquidation

**Position Limits:**
- Max 35% of portfolio in one coin
- Max $20 per single trade
- Minimum $5 to trade

---

## Risk Disclaimer

This is a paper trading system by default. When switched to LIVE mode, real money is at risk. Crypto is highly volatile. Past performance in paper mode does not guarantee live performance. Never invest more than you can afford to lose entirely. This software is provided as-is with no warranty.

---

## Dashboard Features

- **Overview** — equity curve, real-time P&L, win rate, drawdown, activity feed
- **Trades** — full trade history with signals, reasoning, fees, P&L per trade
- **Positions** — open positions with live unrealized P&L
- **Market** — live prices for all tracked coins with 24h stats


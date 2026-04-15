import { useState, useEffect, useRef } from 'react';
import { useTraderSocket } from './useTraderSocket.js';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#060810', card: '#0b0f1c', border: '#141e30',
  green: '#10e87e', red: '#f03d5e', amber: '#f5a020', blue: '#3a8ef5',
  text: '#b8d0e8', sub: '#364d65', dim: '#0e1626',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fUSD = (n) => {
  if (n == null || isNaN(n)) return '$—';
  if (Math.abs(n) >= 1e6) return `$${(n/1e6).toFixed(3)}M`;
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (Math.abs(n) >= 1)   return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
};
const fPct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const fTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
};
const fAge = (iso) => {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff/60)}m ago`;
  return `${Math.round(diff/3600)}h ago`;
};

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, large }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px' }}>
      <div style={{ color: C.sub, fontSize: 9, letterSpacing: '0.15em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: large ? 28 : 22, fontWeight: 800, color: color || C.text, fontFamily: 'Sora, sans-serif', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ color: C.sub, fontSize: 10, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function Tag({ color, children, small }) {
  return (
    <span style={{
      background: color + '1c', color, border: `1px solid ${color}33`,
      padding: small ? '1px 6px' : '3px 10px', borderRadius: 3,
      fontSize: small ? 9 : 10, fontWeight: 700, letterSpacing: '0.06em',
    }}>{children}</span>
  );
}

function SectionHead({ children, right }) {
  return (
    <div style={{ padding: '8px 16px', fontSize: 9, color: C.sub, letterSpacing: '0.15em', fontWeight: 700, borderBottom: `1px solid ${C.border}`, background: C.dim, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{children}</span>
      {right && <span style={{ color: C.sub }}>{right}</span>}
    </div>
  );
}

function Sparkline({ data, color, height = 32 }) {
  if (!data || data.length < 2) return <div style={{ height, width: 80 }} />;
  return (
    <ResponsiveContainer width={80} height={height}>
      <LineChart data={data.map((v, i) => ({ i, v }))}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const COIN_COLORS = { BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff', ADA: '#0d1e4a', AVAX: '#e84142', LINK: '#2a5ada', XRP: '#00aae4', DOGE: '#c2a633' };

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { connected, state, prices, lastUpdated } = useTraderSocket();
  const [equityCurve, setEquityCurve] = useState([]);
  const [activeTab, setActiveTab]     = useState('overview');
  const logRef = useRef(null);

  // Build equity curve from trade history
  useEffect(() => {
    if (!state?.trades) return;
    const curve = [];
    let val = state.startingBalance || 100;
    const sells = [...state.trades].reverse().filter(t => t.type === 'SELL' && t.pnl !== undefined);
    sells.forEach((t, i) => { val += t.pnl; curve.push({ i: i + 1, value: +val.toFixed(4), ts: t.ts }); });
    if (curve.length === 0) curve.push({ i: 0, value: state.startingBalance || 100 });
    setEquityCurve(curve);
  }, [state?.trades?.length]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state?.trades?.length]);

  if (!state) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: C.green, fontSize: 24, fontFamily: 'Sora', fontWeight: 800 }}>NEXUS TRADER</div>
        <div style={{ color: connected ? C.amber : C.red, fontSize: 12 }}>
          {connected ? 'Connected — waiting for data...' : 'Connecting to bot...'}
        </div>
        <div style={{ width: 200, height: 2, background: C.border, borderRadius: 1, overflow: 'hidden' }}>
          <div style={{ width: '60%', height: '100%', background: C.green, animation: 'slide 1.5s infinite' }} />
        </div>
        <style>{`@keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(250%)} }`}</style>
      </div>
    );
  }

  const totalValue = state.totalValue || state.balance;
  const pnl        = state.pnl || 0;
  const pnlPct     = state.pnlPct || 0;
  const drawdown   = state.drawdown || 0;
  const sells      = (state.trades || []).filter(t => t.type === 'SELL');
  const wins       = sells.filter(t => t.pnl > 0).length;
  const winRate    = sells.length > 0 ? (wins / sells.length * 100).toFixed(0) : '—';
  const totalPnl   = sells.reduce((s, t) => s + (t.pnl || 0), 0);

  const positionCoins = Object.keys(state.portfolio || {});

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ color: C.green, fontSize: 16, fontWeight: 800, fontFamily: 'Sora', letterSpacing: '0.05em' }}>NEXUS TRADER</div>
            <div style={{ color: C.sub, fontSize: 9, letterSpacing: '0.12em' }}>AUTONOMOUS CRYPTO ENGINE</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: C.dim, borderRadius: 4, border: `1px solid ${C.border}` }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? C.green : C.red, boxShadow: connected ? `0 0 8px ${C.green}` : 'none', animation: connected && state.status === 'cycling' ? 'pulse 1s infinite' : 'none' }} />
            <span style={{ color: connected ? C.green : C.red, fontSize: 10, fontWeight: 700 }}>{connected ? state.status?.toUpperCase() : 'DISCONNECTED'}</span>
          </div>
          <div style={{ color: C.sub, fontSize: 9 }}>
            MODE: <span style={{ color: state.mode === 'LIVE' ? C.amber : C.blue }}>{state.mode}</span>
          </div>
        </div>
        <div style={{ display: 'flex', align: 'center', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: C.sub, fontSize: 9 }}>PORTFOLIO VALUE</div>
            <div style={{ color: pnl >= 0 ? C.green : C.red, fontSize: 22, fontWeight: 800, fontFamily: 'Sora' }}>{fUSD(totalValue)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: C.sub, fontSize: 9 }}>ALL-TIME P&L</div>
            <div style={{ color: pnl >= 0 ? C.green : C.red, fontSize: 16, fontWeight: 700 }}>{pnl >= 0 ? '+' : ''}{fUSD(pnl)} <span style={{ fontSize: 11 }}>({fPct(pnlPct)})</span></div>
          </div>
          <div style={{ color: C.sub, fontSize: 9, textAlign: 'right' }}>
            <div>Last update</div>
            <div style={{ color: C.text, fontSize: 11 }}>{fAge(lastUpdated)}</div>
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 24px', display: 'flex', gap: 0 }}>
        {['overview', 'trades', 'positions', 'market'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            background: 'transparent', border: 'none', padding: '10px 18px',
            color: activeTab === tab ? C.green : C.sub, fontFamily: 'inherit',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer',
            borderBottom: activeTab === tab ? `2px solid ${C.green}` : '2px solid transparent',
          }}>{tab.toUpperCase()}</button>
        ))}
      </div>

      <div style={{ padding: '20px 24px' }}>

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
              <StatCard label="TOTAL VALUE" value={fUSD(totalValue)} sub={`started $${state.startingBalance?.toFixed(2)}`} color={pnl >= 0 ? C.green : C.red} large />
              <StatCard label="CASH" value={fUSD(state.balance)} sub={`${totalValue > 0 ? ((state.balance/totalValue)*100).toFixed(0) : 0}% liquid`} />
              <StatCard label="REALIZED P&L" value={`${totalPnl >= 0 ? '+' : ''}${fUSD(totalPnl)}`} sub={`${sells.length} closed trades`} color={totalPnl >= 0 ? C.green : C.red} />
              <StatCard label="WIN RATE" value={`${winRate}%`} sub={`${wins}W / ${sells.length - wins}L`} color={parseInt(winRate) >= 50 ? C.green : C.red} />
              <StatCard label="DRAWDOWN" value={fPct(-drawdown)} sub={`peak ${fUSD(state.peakValue)}`} color={drawdown > 15 ? C.red : drawdown > 8 ? C.amber : C.green} />
              <StatCard label="FEES PAID" value={fUSD(state.totalFeesUSD)} sub={`${state.cycleCount} cycles run`} />
            </div>

            {/* Equity curve + last decision */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <SectionHead>EQUITY CURVE</SectionHead>
                <div style={{ padding: '16px', height: 200 }}>
                  {equityCurve.length < 2
                    ? <div style={{ color: C.sub, fontSize: 11, textAlign: 'center', paddingTop: 60 }}>Equity curve builds after first sell trades complete.</div>
                    : <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={equityCurve}>
                          <defs>
                            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor={C.green} stopOpacity={0.2} />
                              <stop offset="95%" stopColor={C.green} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="i" hide />
                          <YAxis domain={['auto', 'auto']} hide />
                          <Tooltip
                            contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 10 }}
                            formatter={(v) => [fUSD(v), 'Portfolio Value']}
                          />
                          <ReferenceLine y={state.startingBalance} stroke={C.sub} strokeDasharray="3 3" />
                          <Area type="monotone" dataKey="value" stroke={C.green} strokeWidth={2} fill="url(#pnlGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                  }
                </div>
              </div>

              {/* Last Decision */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <SectionHead>LAST DECISION</SectionHead>
                {(() => {
                  const last = (state.trades || [])[0];
                  if (!last) return <div style={{ padding: '20px', color: C.sub, fontSize: 11 }}>No decisions yet.</div>;
                  const ac = last.type === 'BUY' ? C.green : last.type === 'SELL' ? (last.pnl >= 0 ? C.blue : C.red) : C.amber;
                  return (
                    <div style={{ padding: '14px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                        <Tag color={ac}>{last.type}</Tag>
                        {last.coin && <span style={{ color: COIN_COLORS[last.coin] || C.text, fontWeight: 700, fontSize: 16 }}>{last.coin}</span>}
                        <span style={{ marginLeft: 'auto', color: C.sub, fontSize: 9 }}>{fAge(last.ts)}</span>
                      </div>
                      {last.type !== 'HOLD' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                          {[
                            ['Price', fUSD(last.price)],
                            ['Amount', fUSD(last.gross)],
                            ['Fee', fUSD(last.fee)],
                            last.pnl !== undefined ? ['PnL', `${last.pnl >= 0 ? '+' : ''}${fUSD(last.pnl)}`] : ['Qty', last.qty?.toFixed(6)],
                          ].map(([k, v]) => (
                            <div key={k} style={{ background: C.dim, padding: '6px 8px', borderRadius: 4 }}>
                              <div style={{ color: C.sub, fontSize: 8 }}>{k}</div>
                              <div style={{ color: C.text, fontSize: 11, fontWeight: 600 }}>{v}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                        {(last.signals || []).map((s, i) => <Tag key={i} color={C.blue} small>{s}</Tag>)}
                      </div>
                      <div style={{ color: '#7090b0', fontSize: 10, lineHeight: 1.8, borderLeft: `2px solid ${C.border}`, paddingLeft: 8 }}>
                        {last.reasoning}
                      </div>
                      <div style={{ marginTop: 8, color: C.sub, fontSize: 9 }}>
                        CONF: <span style={{ color: (last.confidence||0) >= 7 ? C.green : (last.confidence||0) >= 5 ? C.amber : C.red }}>{last.confidence}/10</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Recent activity feed */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <SectionHead right={`${(state.trades||[]).length} total`}>ACTIVITY FEED</SectionHead>
              <div ref={logRef} style={{ maxHeight: 260, overflowY: 'auto' }}>
                {(state.trades || []).slice(0, 30).map((t, i) => (
                  <div key={i} style={{ padding: '8px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: i % 2 === 0 ? 'transparent' : '#09101a' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <Tag color={t.type === 'BUY' ? C.green : t.type === 'SELL' ? (t.pnl >= 0 ? C.blue : C.red) : C.amber} small>{t.type}</Tag>
                      {t.coin && <span style={{ color: COIN_COLORS[t.coin] || C.text, fontWeight: 700, fontSize: 12 }}>{t.coin}</span>}
                      <span style={{ color: C.sub, fontSize: 10, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.reasoning?.slice(0, 60)}...</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      {t.type !== 'HOLD' && <span style={{ color: C.text, fontSize: 11 }}>{fUSD(t.gross)}</span>}
                      {t.pnl !== undefined && <span style={{ color: t.pnl >= 0 ? C.green : C.red, fontSize: 11 }}>{t.pnl >= 0 ? '+' : ''}{fUSD(t.pnl)}</span>}
                      <span style={{ color: C.sub, fontSize: 9 }}>{fTime(t.ts)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TRADES TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'trades' && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <SectionHead right={`${(state.trades||[]).length} records`}>FULL TRADE HISTORY</SectionHead>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: C.dim }}>
                    {['TIME', 'TYPE', 'COIN', 'PRICE', 'AMOUNT', 'QTY', 'FEE', 'P&L', 'CONF', 'SIGNALS'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', color: C.sub, fontWeight: 700, fontSize: 9, letterSpacing: '0.1em', textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(state.trades || []).map((t, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? 'transparent' : '#090f1a' }}>
                      <td style={{ padding: '8px 12px', color: C.sub, fontSize: 9 }}>{fTime(t.ts)}</td>
                      <td style={{ padding: '8px 12px' }}><Tag color={t.type === 'BUY' ? C.green : t.type === 'SELL' ? C.blue : C.amber} small>{t.type}</Tag></td>
                      <td style={{ padding: '8px 12px', color: COIN_COLORS[t.coin] || C.text, fontWeight: 700 }}>{t.coin || '—'}</td>
                      <td style={{ padding: '8px 12px', color: C.text }}>{fUSD(t.price)}</td>
                      <td style={{ padding: '8px 12px', color: C.text }}>{fUSD(t.gross)}</td>
                      <td style={{ padding: '8px 12px', color: C.sub }}>{t.qty?.toFixed(6) || '—'}</td>
                      <td style={{ padding: '8px 12px', color: C.sub }}>{fUSD(t.fee)}</td>
                      <td style={{ padding: '8px 12px', color: t.pnl == null ? C.sub : t.pnl >= 0 ? C.green : C.red }}>{t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}${fUSD(t.pnl)}` : '—'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ color: (t.confidence||0) >= 7 ? C.green : (t.confidence||0) >= 5 ? C.amber : C.red }}>{t.confidence || '—'}/10</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {(t.signals || []).slice(0, 2).map((s, j) => <Tag key={j} color={C.blue} small>{s}</Tag>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── POSITIONS TAB ────────────────────────────────────────────────── */}
        {activeTab === 'positions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {positionCoins.length === 0
              ? <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '40px', color: C.sub, textAlign: 'center' }}>No open positions. Bot is holding cash.</div>
              : positionCoins.map(sym => {
                  const pos  = state.portfolio[sym];
                  const px   = prices[sym]?.price;
                  const posVal = px ? pos.qty * px : 0;
                  const pnl  = px ? (px - pos.avgCost) * pos.qty : 0;
                  const pnlP = pos.avgCost > 0 ? ((px || 0) - pos.avgCost) / pos.avgCost * 100 : 0;
                  const color = pnl >= 0 ? C.green : C.red;
                  return (
                    <div key={sym} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '20px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 16, alignItems: 'center' }}>
                      <div>
                        <div style={{ color: COIN_COLORS[sym] || C.text, fontWeight: 800, fontSize: 22, fontFamily: 'Sora' }}>{sym}</div>
                        <div style={{ color: C.sub, fontSize: 10 }}>Entered {fAge(pos.entryTime)}</div>
                      </div>
                      {[
                        ['Quantity', pos.qty.toFixed(6)],
                        ['Avg Cost', fUSD(pos.avgCost)],
                        ['Current', fUSD(px)],
                        ['Value', fUSD(posVal)],
                        ['PnL', `${pnl >= 0 ? '+' : ''}${fUSD(pnl)} (${fPct(pnlP)})`],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <div style={{ color: C.sub, fontSize: 9, letterSpacing: '0.1em' }}>{k}</div>
                          <div style={{ color: k === 'PnL' ? color : C.text, fontSize: 13, fontWeight: 600 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  );
                })
            }
          </div>
        )}

        {/* ── MARKET TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'market' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {Object.entries(prices).map(([sym, data]) => {
              if (!data) return null;
              const held = state.portfolio?.[sym];
              const coinColor = COIN_COLORS[sym] || C.text;
              const change = data.change24h || 0;
              return (
                <div key={sym} style={{ background: C.card, border: `1px solid ${held ? coinColor + '44' : C.border}`, borderRadius: 8, padding: '16px', position: 'relative' }}>
                  {held && <div style={{ position: 'absolute', top: 10, right: 10 }}><Tag color={coinColor} small>HELD</Tag></div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ color: coinColor, fontWeight: 800, fontSize: 20, fontFamily: 'Sora' }}>{sym}</div>
                      <div style={{ color: C.sub, fontSize: 9 }}>{data.marketCap ? `MCap: ${fUSD(data.marketCap)}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>{fUSD(data.price)}</div>
                      <div style={{ color: change >= 0 ? C.green : C.red, fontSize: 11 }}>{fPct(change)} 24h</div>
                    </div>
                  </div>
                  <div style={{ color: C.sub, fontSize: 9 }}>24H VOL: {fUSD(data.volume24h)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        button:hover { opacity: 0.8; }
      `}</style>
    </div>
  );
}

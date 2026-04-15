import { useState, useEffect, useRef, useCallback } from 'react';
import { useTraderSocket } from './useTraderSocket.js';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar } from 'recharts';

const C = {
  bg: '#05070f', card: '#090d1a', border: '#111c2e',
  green: '#0ff078', red: '#f0365a', amber: '#f5a020', blue: '#2f8ef5',
  purple: '#a855f7', cyan: '#06b6d4',
  text: '#b0cce0', sub: '#2d4460', dim: '#07101c',
};

const COIN_COLORS = { BTC:'#f7931a',ETH:'#627eea',SOL:'#9945ff',ADA:'#3cc8c8',AVAX:'#e84142',LINK:'#2a5ada',XRP:'#00aae4',DOGE:'#c2a633' };
const STRATEGY_COLORS = { MOMENTUM:C.blue,MEAN_REVERSION:C.cyan,BREAKOUT:C.amber,EMA_CROSS:C.purple,HIGH_RISK_REWARD:C.red,TAKE_PROFIT:C.green,STOP_LOSS:C.red,HOLD:'#445566' };

const fUSD = (n) => {
  if (n==null||isNaN(n)) return '$—';
  const abs = Math.abs(n);
  if (abs>=1e6)  return `$${(n/1e6).toFixed(3)}M`;
  if (abs>=1000) return `$${n.toLocaleString('en-US',{maximumFractionDigits:2})}`;
  if (abs>=1)    return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
};
const fPct  = (n) => n==null?'—':`${n>=0?'+':''}${n.toFixed(2)}%`;
const fTime = (iso) => !iso?'—':new Date(iso).toLocaleTimeString('en-US',{hour12:false});
const fAge  = (iso) => {
  if (!iso) return '—';
  const d=(Date.now()-new Date(iso))/1000;
  if (d<60)   return `${Math.round(d)}s ago`;
  if (d<3600) return `${Math.round(d/60)}m ago`;
  return `${Math.round(d/3600)}h ago`;
};

const SECRET = 'nexus-secret-2024'; // match DASHBOARD_SECRET env var

async function apiControl(action, extra={}) {
  try {
    const res = await fetch('/api/control', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action, secret: SECRET, ...extra }),
    });
    return res.json();
  } catch(e) { console.error('Control error:', e); }
}

function Tag({ color, children, small }) {
  return <span style={{ background:color+'1e',color,border:`1px solid ${color}30`, padding:small?'1px 5px':'3px 9px',borderRadius:3,fontSize:small?8:10,fontWeight:700,letterSpacing:'0.06em' }}>{children}</span>;
}
function SectionHead({ children, right }) {
  return <div style={{ padding:'7px 14px',fontSize:9,color:C.sub,letterSpacing:'0.15em',fontWeight:700,borderBottom:`1px solid ${C.border}`,background:C.dim,display:'flex',justifyContent:'space-between',alignItems:'center' }}><span>{children}</span>{right&&<span>{right}</span>}</div>;
}
function Btn({ onClick, color, children, disabled, small, active }) {
  return <button onClick={onClick} disabled={disabled} style={{ background:active?color+'22':'transparent',color:active?color:C.sub,border:`1px solid ${active?color:C.sub}44`,padding:small?'4px 10px':'6px 14px',borderRadius:4,cursor:disabled?'not-allowed':'pointer',fontFamily:'inherit',fontSize:small?9:10,fontWeight:700,letterSpacing:'0.07em',opacity:disabled?0.4:1,transition:'all 0.15s' }}>{children}</button>;
}
function StatCard({ label, value, sub, color, pulse }) {
  return (
    <div style={{ background:C.card,border:`1px solid ${pulse?color+'55':C.border}`,borderRadius:8,padding:'14px 18px',boxShadow:pulse?`0 0 12px ${color}22`:'' }}>
      <div style={{ color:C.sub,fontSize:9,letterSpacing:'0.15em',marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:22,fontWeight:800,color:color||C.text,fontFamily:'Sora,sans-serif',lineHeight:1.1 }}>{value}</div>
      {sub&&<div style={{ color:C.sub,fontSize:10,marginTop:4 }}>{sub}</div>}
    </div>
  );
}

export default function App() {
  const { connected, state, prices, botLog, lastUpdated } = useTraderSocket();
  const [tab, setTab]               = useState('overview');
  const [equityCurve, setEquity]    = useState([]);
  const [leverageOpen, setLevOpen]  = useState(false);
  const [maxLev, setMaxLev]         = useState(5);
  const [actionPending, setAction]  = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    if (!state?.trades) return;
    let val = state.startingBalance || 100;
    const curve = [{ i:0, value:val }];
    [...state.trades].reverse().forEach((t,i) => {
      if (t.type==='SELL' && t.pnl!=null) { val+=t.pnl; curve.push({ i:i+1, value:+val.toFixed(4), ts:t.ts }); }
    });
    setEquity(curve);
  }, [state?.trades?.length]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [botLog?.length]);

  const control = useCallback(async (action, extra={}) => {
    setAction(true);
    await apiControl(action, extra);
    setTimeout(() => setAction(false), 1000);
  }, []);

  if (!state) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:16,background:C.bg }}>
      <div style={{ color:C.green,fontSize:28,fontFamily:'Sora',fontWeight:800,letterSpacing:'0.08em' }}>NEXUS</div>
      <div style={{ color:connected?C.amber:C.red,fontSize:11 }}>{connected?'Waiting for bot data...':'Connecting...'}</div>
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}`}</style>
      <div style={{ width:160,height:2,background:C.border,borderRadius:1,overflow:'hidden' }}><div style={{ width:'50%',height:'100%',background:C.green,animation:'slide 1.4s infinite' }}/></div>
    </div>
  );

  const totalValue = state.totalValue || state.balance || 0;
  const pnl        = state.pnl || 0;
  const pnlPct     = state.pnlPct || 0;
  const drawdown   = state.drawdown || 0;
  const isRunning  = ['running','cycling'].includes(state.status);
  const sells      = (state.trades||[]).filter(t=>t.type==='SELL');
  const wins       = sells.filter(t=>t.pnl>0).length;
  const winRate    = sells.length>0?(wins/sells.length*100).toFixed(0)+'%':'—';
  const totalPnl   = sells.reduce((s,t)=>s+(t.pnl||0),0);
  const leveraged  = (state.trades||[]).filter(t=>t.leverage>1).length;

  const logLevelColor = { INFO:C.sub,SYSTEM:C.blue,CYCLE:'#445577',AI:C.purple,RULES:C.cyan,MARKET:'#334455',POSITION:C.amber,SIGNAL:C.green,REASONING:C.text,TRADE:C.green,PROFIT:C.green,LOSS:C.red,HOLD:'#445566',WARN:C.amber,ERROR:C.red };

  return (
    <div style={{ minHeight:'100vh',background:C.bg,fontFamily:"'IBM Plex Mono',monospace" }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{ background:C.card,borderBottom:`1px solid ${C.border}`,padding:'10px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:100 }}>
        <div style={{ display:'flex',alignItems:'center',gap:14 }}>
          <div>
            <div style={{ color:C.green,fontSize:17,fontWeight:800,fontFamily:'Sora',letterSpacing:'0.06em' }}>NEXUS TRADER</div>
            <div style={{ color:C.sub,fontSize:8,letterSpacing:'0.14em' }}>AUTONOMOUS CRYPTO ENGINE</div>
          </div>
          {/* Status pill */}
          <div style={{ display:'flex',alignItems:'center',gap:6,padding:'4px 10px',background:C.dim,borderRadius:4,border:`1px solid ${C.border}` }}>
            <div style={{ width:7,height:7,borderRadius:'50%',background:isRunning?C.green:state.status==='error'?C.red:C.sub,boxShadow:isRunning?`0 0 8px ${C.green}`:'',animation:state.status==='cycling'?'pulse 1s infinite':'' }}/>
            <span style={{ color:isRunning?C.green:C.sub,fontSize:10,fontWeight:700 }}>{connected?(state.status||'idle').toUpperCase():'OFFLINE'}</span>
          </div>
          <div style={{ color:C.sub,fontSize:9 }}>MODE: <span style={{ color:state.mode==='LIVE'?C.amber:C.blue }}>{state.mode}</span></div>
          {state.leverageEnabled && <Tag color={C.purple}>⚡ LEVERAGE {state.maxLeverage}x</Tag>}
        </div>

        {/* Controls */}
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <span style={{ color:C.sub,fontSize:9 }}>{fAge(lastUpdated)}</span>
          <Btn onClick={()=>control('run_once')} color={C.blue} small disabled={actionPending}>▷ RUN ONCE</Btn>
          {isRunning
            ? <Btn onClick={()=>control('stop')}  color={C.red}   small active>◼ STOP BOT</Btn>
            : <Btn onClick={()=>control('start')} color={C.green} small active>▶ START BOT</Btn>
          }
          <Btn onClick={()=>control('reset')} color={C.sub} small>↺ RESET</Btn>
          <Btn onClick={()=>setLevOpen(!leverageOpen)} color={C.purple} small active={state.leverageEnabled}>⚡ LEVERAGE</Btn>
        </div>
      </div>

      {/* ── LEVERAGE PANEL ─────────────────────────────────────────────────── */}
      {leverageOpen && (
        <div style={{ background:'#0a0e1e',borderBottom:`1px solid ${C.purple}44`,padding:'14px 20px',display:'flex',alignItems:'center',gap:20 }}>
          <div style={{ color:C.purple,fontSize:11,fontWeight:700 }}>⚡ LEVERAGE / PERPETUALS</div>
          <div style={{ display:'flex',gap:8 }}>
            <Btn onClick={()=>control('leverage',{value:true,maxLeverage:maxLev})} color={C.green} small active={state.leverageEnabled}>ENABLE</Btn>
            <Btn onClick={()=>control('leverage',{value:false})} color={C.red} small active={!state.leverageEnabled}>DISABLE</Btn>
          </div>
          <div style={{ display:'flex',alignItems:'center',gap:8 }}>
            <span style={{ color:C.sub,fontSize:10 }}>Max Leverage:</span>
            {[2,3,5,10].map(l=>(
              <Btn key={l} onClick={()=>{setMaxLev(l);control('leverage',{value:state.leverageEnabled,maxLeverage:l});}} color={C.purple} small active={state.maxLeverage===l}>{l}x</Btn>
            ))}
          </div>
          <div style={{ color:C.sub,fontSize:9,maxWidth:400 }}>
            ⚠️ Leverage amplifies both gains AND losses. Bot only uses leverage when confidence ≥ 8/10. Perp positions use Binance perpetuals simulation.
          </div>
        </div>
      )}

      {/* ── STATS BAR ──────────────────────────────────────────────────────── */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(7,1fr)',borderBottom:`1px solid ${C.border}` }}>
        {[
          { label:'PORTFOLIO VALUE', value:fUSD(totalValue), sub:`started ${fUSD(state.startingBalance)}`, color:pnl>=0?C.green:C.red, pulse:pnl>0 },
          { label:'CASH',            value:fUSD(state.balance), sub:`${totalValue>0?((state.balance/totalValue)*100).toFixed(0):0}% liquid` },
          { label:'ALL-TIME P&L',    value:`${pnl>=0?'+':''}${fUSD(pnl)}`, sub:fPct(pnlPct), color:pnl>=0?C.green:C.red },
          { label:'REALIZED P&L',    value:`${totalPnl>=0?'+':''}${fUSD(totalPnl)}`, sub:`${sells.length} closed`, color:totalPnl>=0?C.green:C.red },
          { label:'WIN RATE',        value:winRate, sub:`${wins}W / ${sells.length-wins}L`, color:parseInt(winRate)>=50?C.green:C.red },
          { label:'DRAWDOWN',        value:fPct(-drawdown), sub:`peak ${fUSD(state.peakValue)}`, color:drawdown>15?C.red:drawdown>8?C.amber:C.green },
          { label:'FEES / CYCLES',   value:fUSD(state.totalFeesUSD), sub:`${state.cycleCount} cycles · ${leveraged} leveraged` },
        ].map((s,i)=>(
          <div key={i} style={{ background:C.card,padding:'11px 16px',borderRight:`1px solid ${C.border}` }}>
            <div style={{ color:C.sub,fontSize:8,letterSpacing:'0.14em',marginBottom:4 }}>{s.label}</div>
            <div style={{ fontSize:18,fontWeight:800,color:s.color||C.text,fontFamily:'Sora' }}>{s.value}</div>
            <div style={{ fontSize:9,color:C.sub,marginTop:3 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── TABS ───────────────────────────────────────────────────────────── */}
      <div style={{ background:C.card,borderBottom:`1px solid ${C.border}`,padding:'0 20px',display:'flex',gap:0 }}>
        {['overview','live log','trades','positions','market','analytics'].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ background:'transparent',border:'none',padding:'9px 16px',color:tab===t?C.green:C.sub,fontFamily:'inherit',fontSize:9,fontWeight:700,letterSpacing:'0.12em',cursor:'pointer',borderBottom:tab===t?`2px solid ${C.green}`:'2px solid transparent',textTransform:'uppercase' }}>{t}</button>
        ))}
      </div>

      <div style={{ padding:'16px 20px' }}>

        {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
        {tab==='overview' && (
          <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
            <div style={{ display:'grid',gridTemplateColumns:'2fr 1fr',gap:14 }}>

              {/* Equity curve */}
              <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden' }}>
                <SectionHead right={`${equityCurve.length} data points`}>EQUITY CURVE</SectionHead>
                <div style={{ padding:'14px',height:220 }}>
                  {equityCurve.length<2
                    ? <div style={{ color:C.sub,fontSize:11,textAlign:'center',paddingTop:70 }}>Equity curve builds after first completed trades.</div>
                    : <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={equityCurve}>
                          <defs>
                            <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor={pnl>=0?C.green:C.red} stopOpacity={0.25}/>
                              <stop offset="95%" stopColor={pnl>=0?C.green:C.red} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="i" hide/>
                          <YAxis domain={['auto','auto']} hide/>
                          <Tooltip contentStyle={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:4,fontSize:10 }} formatter={v=>[fUSD(v),'Value']}/>
                          <ReferenceLine y={state.startingBalance} stroke={C.sub} strokeDasharray="3 3"/>
                          <Area type="monotone" dataKey="value" stroke={pnl>=0?C.green:C.red} strokeWidth={2} fill="url(#grad)"/>
                        </AreaChart>
                      </ResponsiveContainer>
                  }
                </div>
              </div>

              {/* Last decision */}
              <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden' }}>
                <SectionHead>LAST DECISION</SectionHead>
                {(()=>{
                  const t=(state.trades||[])[0];
                  if (!t) return <div style={{ padding:'20px',color:C.sub,fontSize:11 }}>No decisions yet. Start the bot.</div>;
                  const ac=t.type==='BUY'?C.green:t.type==='SELL'?(t.pnl>=0?C.blue:C.red):C.amber;
                  const stratColor=STRATEGY_COLORS[t.strategy]||C.sub;
                  return (
                    <div style={{ padding:'12px 14px' }}>
                      <div style={{ display:'flex',gap:7,alignItems:'center',marginBottom:8,flexWrap:'wrap' }}>
                        <Tag color={ac}>{t.type}</Tag>
                        {t.coin&&<span style={{ color:COIN_COLORS[t.coin]||C.text,fontWeight:800,fontSize:16 }}>{t.coin}</span>}
                        {t.strategy&&<Tag color={stratColor} small>{t.strategy}</Tag>}
                        {t.leverage>1&&<Tag color={C.purple} small>{t.leverage}x LEV</Tag>}
                        <span style={{ marginLeft:'auto',color:C.sub,fontSize:9 }}>{fAge(t.ts)}</span>
                      </div>
                      {t.type!=='HOLD'&&(
                        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8 }}>
                          {[['Price',fUSD(t.price)],['Amount',fUSD(t.gross)],['Fee',fUSD(t.fee)],t.pnl!=null?['PnL',`${t.pnl>=0?'+':''}${fUSD(t.pnl)}`]:['Qty',t.qty?.toFixed(6)]].map(([k,v])=>(
                            <div key={k} style={{ background:C.dim,padding:'5px 8px',borderRadius:4 }}>
                              <div style={{ color:C.sub,fontSize:8 }}>{k}</div>
                              <div style={{ color:k==='PnL'?(t.pnl>=0?C.green:C.red):C.text,fontSize:11,fontWeight:600 }}>{v}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display:'flex',gap:3,flexWrap:'wrap',marginBottom:7 }}>
                        {(t.signals||[]).map((s,i)=><Tag key={i} color={C.cyan} small>{s}</Tag>)}
                      </div>
                      <div style={{ color:C.sub,fontSize:9,marginBottom:6 }}>
                        CONF: <span style={{ color:(t.confidence||0)>=7?C.green:(t.confidence||0)>=5?C.amber:C.red }}>{t.confidence||'—'}/10</span>
                      </div>
                      <div style={{ color:'#607090',fontSize:10,lineHeight:1.8,borderLeft:`2px solid ${C.border}`,paddingLeft:8 }}>
                        {t.reasoning}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Activity feed */}
            <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden' }}>
              <SectionHead right={`${(state.trades||[]).length} total decisions`}>DECISION FEED</SectionHead>
              <div style={{ maxHeight:280,overflowY:'auto' }}>
                {(state.trades||[]).slice(0,40).map((t,i)=>{
                  const ac=t.type==='BUY'?C.green:t.type==='SELL'?(t.pnl>=0?C.blue:C.red):C.amber;
                  const sc=STRATEGY_COLORS[t.strategy]||C.sub;
                  return (
                    <div key={i} style={{ padding:'7px 14px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',background:i%2===0?'transparent':'#07101c' }}>
                      <div style={{ display:'flex',gap:7,alignItems:'center',flex:1,minWidth:0 }}>
                        <Tag color={ac} small>{t.type}</Tag>
                        {t.coin&&<span style={{ color:COIN_COLORS[t.coin]||C.text,fontWeight:700,fontSize:11,minWidth:32 }}>{t.coin}</span>}
                        {t.strategy&&<Tag color={sc} small>{t.strategy}</Tag>}
                        {t.leverage>1&&<Tag color={C.purple} small>{t.leverage}x</Tag>}
                        <span style={{ color:C.sub,fontSize:9,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:320 }}>{t.reasoning?.slice(0,80)}…</span>
                      </div>
                      <div style={{ display:'flex',gap:10,alignItems:'center',flexShrink:0 }}>
                        {t.type!=='HOLD'&&<span style={{ color:C.text,fontSize:10 }}>{fUSD(t.gross)}</span>}
                        {t.pnl!=null&&<span style={{ color:t.pnl>=0?C.green:C.red,fontSize:10 }}>{t.pnl>=0?'+':''}{fUSD(t.pnl)}</span>}
                        <span style={{ color:C.sub,fontSize:8,minWidth:50,textAlign:'right' }}>{fTime(t.ts)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── LIVE LOG ─────────────────────────────────────────────────────── */}
        {tab==='live log' && (
          <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden' }}>
            <SectionHead right={`${(botLog||[]).length} entries`}>BOT REASONING LOG · REAL-TIME</SectionHead>
            <div ref={logRef} style={{ height:'calc(100vh - 280px)',overflowY:'auto',padding:'4px 0',background:'#04060e' }}>
              {(!botLog||botLog.length===0)&&<div style={{ padding:'20px',color:C.sub,fontSize:11 }}>Log will appear when bot starts running.</div>}
              {(botLog||[]).map((entry,i)=>{
                const lc=logLevelColor[entry.level]||C.sub;
                const isBig=['TRADE','PROFIT','LOSS','REASONING','CYCLE'].includes(entry.level);
                return (
                  <div key={i} style={{ padding:isBig?'6px 14px':'3px 14px',borderBottom:isBig?`1px solid ${C.border}`:'none',background:isBig?'#060b16':'transparent' }}>
                    <span style={{ color:'#1a2d42',fontSize:9,marginRight:8,flexShrink:0 }}>{fTime(entry.ts)}</span>
                    <span style={{ color:lc,fontSize:9,fontWeight:700,marginRight:6,minWidth:60,display:'inline-block' }}>[{entry.level}]</span>
                    <span style={{ color:isBig?C.text:C.sub,fontSize:isBig?11:9,lineHeight:1.7 }}>{entry.msg}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TRADES ───────────────────────────────────────────────────────── */}
        {tab==='trades' && (
          <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden' }}>
            <SectionHead right={`${(state.trades||[]).length} records`}>FULL TRADE HISTORY</SectionHead>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%',borderCollapse:'collapse',fontSize:10 }}>
                <thead>
                  <tr style={{ background:C.dim }}>
                    {['TIME','TYPE','COIN','STRATEGY','PRICE','AMOUNT','FEE','P&L','LEV','CONF','SIGNALS'].map(h=>(
                      <th key={h} style={{ padding:'8px 12px',color:C.sub,fontWeight:700,fontSize:8,letterSpacing:'0.1em',textAlign:'left',borderBottom:`1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(state.trades||[]).map((t,i)=>(
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}`,background:i%2===0?'transparent':'#07101c' }}>
                      <td style={{ padding:'7px 12px',color:C.sub,fontSize:8 }}>{fTime(t.ts)}</td>
                      <td style={{ padding:'7px 12px' }}><Tag color={t.type==='BUY'?C.green:t.type==='SELL'?C.blue:C.amber} small>{t.type}</Tag></td>
                      <td style={{ padding:'7px 12px',color:COIN_COLORS[t.coin]||C.text,fontWeight:700 }}>{t.coin||'—'}</td>
                      <td style={{ padding:'7px 12px' }}>{t.strategy&&<Tag color={STRATEGY_COLORS[t.strategy]||C.sub} small>{t.strategy}</Tag>}</td>
                      <td style={{ padding:'7px 12px',color:C.text }}>{fUSD(t.price)}</td>
                      <td style={{ padding:'7px 12px',color:C.text }}>{fUSD(t.gross)}</td>
                      <td style={{ padding:'7px 12px',color:C.sub }}>{fUSD(t.fee)}</td>
                      <td style={{ padding:'7px 12px',color:t.pnl==null?C.sub:t.pnl>=0?C.green:C.red }}>{t.pnl!=null?`${t.pnl>=0?'+':''}${fUSD(t.pnl)}`:'—'}</td>
                      <td style={{ padding:'7px 12px' }}>{t.leverage>1?<Tag color={C.purple} small>{t.leverage}x</Tag>:'—'}</td>
                      <td style={{ padding:'7px 12px' }}><span style={{ color:(t.confidence||0)>=7?C.green:(t.confidence||0)>=5?C.amber:C.red }}>{t.confidence||'—'}/10</span></td>
                      <td style={{ padding:'7px 12px' }}><div style={{ display:'flex',gap:3,flexWrap:'wrap' }}>{(t.signals||[]).slice(0,2).map((s,j)=><Tag key={j} color={C.cyan} small>{s}</Tag>)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── POSITIONS ────────────────────────────────────────────────────── */}
        {tab==='positions' && (
          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {Object.keys(state.portfolio||{}).length===0
              ? <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'40px',color:C.sub,textAlign:'center' }}>No open positions. Bot is in cash.</div>
              : Object.entries(state.portfolio||{}).map(([sym,pos])=>{
                  const px=prices[sym]?.price,posVal=px?pos.qty*px:0;
                  const pnl=px?(px-pos.avgCost)*pos.qty:0,pnlP=pos.avgCost>0?((px||0)-pos.avgCost)/pos.avgCost*100:0;
                  const lev=pos.leverage||1, effPnl=pnl*lev, effPnlP=pnlP*lev;
                  const col=pnl>=0?C.green:C.red;
                  return (
                    <div key={sym} style={{ background:C.card,border:`1px solid ${pnl>=0?C.green+'33':C.red+'33'}`,borderRadius:8,padding:'18px 20px' }}>
                      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14 }}>
                        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                          <span style={{ color:COIN_COLORS[sym]||C.text,fontWeight:800,fontSize:26,fontFamily:'Sora' }}>{sym}</span>
                          {pos.isPerp&&<Tag color={C.purple}>PERP</Tag>}
                          {lev>1&&<Tag color={C.purple}>{lev}x LEVERAGE</Tag>}
                          <span style={{ color:C.sub,fontSize:9 }}>entered {fAge(pos.entryTime)}</span>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ color:C.text,fontSize:22,fontWeight:700 }}>{fUSD(posVal)}</div>
                          <div style={{ color:col,fontSize:13 }}>{effPnl>=0?'+':''}{fUSD(effPnl)} ({fPct(effPnlP)}){lev>1?` (${lev}x)`:''}</div>
                        </div>
                      </div>
                      <div style={{ display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10 }}>
                        {[['Quantity',pos.qty.toFixed(6)],['Avg Cost',fUSD(pos.avgCost)],['Current',fUSD(px)],['Raw PnL',`${pnl>=0?'+':''}${fUSD(pnl)}`],['Eff PnL',`${effPnl>=0?'+':''}${fUSD(effPnl)}`]].map(([k,v])=>(
                          <div key={k} style={{ background:C.dim,padding:'8px 12px',borderRadius:5 }}>
                            <div style={{ color:C.sub,fontSize:8 }}>{k}</div>
                            <div style={{ color:k.includes('PnL')?(pnl>=0?C.green:C.red):C.text,fontSize:12,fontWeight:600,marginTop:2 }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
            }
          </div>
        )}

        {/* ── MARKET ───────────────────────────────────────────────────────── */}
        {tab==='market' && (
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:12 }}>
            {Object.entries(prices).map(([sym,data])=>{
              if (!data) return null;
              const held=state.portfolio?.[sym],cc=COIN_COLORS[sym]||C.text,chg=data.change24h||0;
              return (
                <div key={sym} style={{ background:C.card,border:`1px solid ${held?cc+'44':C.border}`,borderRadius:8,padding:'16px' }}>
                  {held&&<div style={{ float:'right' }}><Tag color={cc} small>HELD</Tag></div>}
                  <div style={{ color:cc,fontWeight:800,fontSize:22,fontFamily:'Sora' }}>{sym}</div>
                  <div style={{ color:C.text,fontSize:20,fontWeight:700,margin:'6px 0' }}>{fUSD(data.price)}</div>
                  <div style={{ color:chg>=0?C.green:C.red,fontSize:12,marginBottom:8 }}>{fPct(chg)} 24h</div>
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:6 }}>
                    {[['24H HIGH',fUSD(data.high24h)],['24H LOW',fUSD(data.low24h)],['24H VOL',fUSD(data.volume24h)],['STATUS',held?'IN PORTFOLIO':'WATCHING']].map(([k,v])=>(
                      <div key={k} style={{ background:C.dim,padding:'5px 8px',borderRadius:4 }}>
                        <div style={{ color:C.sub,fontSize:8 }}>{k}</div>
                        <div style={{ color:k==='STATUS'?(held?C.green:C.sub):C.text,fontSize:10,fontWeight:600,marginTop:2 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── ANALYTICS ────────────────────────────────────────────────────── */}
        {tab==='analytics' && (
          <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
            {/* Strategy breakdown */}
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }}>
              <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden' }}>
                <SectionHead>STRATEGY BREAKDOWN</SectionHead>
                <div style={{ padding:'14px' }}>
                  {(()=>{
                    const strats={};
                    (state.trades||[]).forEach(t=>{ if(t.strategy&&t.type!=='HOLD') strats[t.strategy]=(strats[t.strategy]||0)+1; });
                    const total=Object.values(strats).reduce((a,b)=>a+b,0)||1;
                    return Object.entries(strats).sort((a,b)=>b[1]-a[1]).map(([s,count])=>(
                      <div key={s} style={{ marginBottom:10 }}>
                        <div style={{ display:'flex',justifyContent:'space-between',marginBottom:3 }}>
                          <Tag color={STRATEGY_COLORS[s]||C.sub} small>{s}</Tag>
                          <span style={{ color:C.text,fontSize:10 }}>{count} trades ({((count/total)*100).toFixed(0)}%)</span>
                        </div>
                        <div style={{ height:4,background:C.border,borderRadius:2 }}>
                          <div style={{ height:'100%',width:`${(count/total)*100}%`,background:STRATEGY_COLORS[s]||C.sub,borderRadius:2 }}/>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden' }}>
                <SectionHead>COIN PERFORMANCE</SectionHead>
                <div style={{ padding:'14px' }}>
                  {(()=>{
                    const coinPnl={};
                    (state.trades||[]).filter(t=>t.type==='SELL'&&t.pnl!=null).forEach(t=>{ coinPnl[t.coin]=(coinPnl[t.coin]||0)+t.pnl; });
                    return Object.entries(coinPnl).sort((a,b)=>b[1]-a[1]).map(([coin,p])=>(
                      <div key={coin} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:`1px solid ${C.border}` }}>
                        <span style={{ color:COIN_COLORS[coin]||C.text,fontWeight:700,fontSize:12 }}>{coin}</span>
                        <span style={{ color:p>=0?C.green:C.red,fontSize:12 }}>{p>=0?'+':''}{fUSD(p)}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>

            {/* P&L bar chart */}
            <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden' }}>
              <SectionHead>TRADE P&L HISTORY</SectionHead>
              <div style={{ padding:'14px',height:200 }}>
                {(()=>{
                  const data=(state.trades||[]).filter(t=>t.type==='SELL'&&t.pnl!=null).slice(0,30).reverse().map((t,i)=>({ i:i+1,pnl:+t.pnl.toFixed(4),coin:t.coin }));
                  if (data.length===0) return <div style={{ color:C.sub,textAlign:'center',paddingTop:60,fontSize:11 }}>No closed trades yet.</div>;
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data}>
                        <XAxis dataKey="i" hide/>
                        <YAxis hide/>
                        <Tooltip contentStyle={{ background:C.card,border:`1px solid ${C.border}`,fontSize:10 }} formatter={v=>[fUSD(v),'P&L']}/>
                        <ReferenceLine y={0} stroke={C.sub}/>
                        <Bar dataKey="pnl" fill={C.green} radius={[2,2,0,0]}
                          label={false}
                          /* color bars by value */
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=Sora:wght@400;600;800&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.border}}
        button:hover{opacity:0.85!important}
      `}</style>
    </div>
  );
}

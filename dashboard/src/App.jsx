import { useState, useEffect, useRef, useCallback } from 'react';
import { useTraderSocket } from './useTraderSocket.js';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar } from 'recharts';

// ── Tokens ───────────────────────────────────────────────────────────────────
const C = {
  bg: '#030508', card: '#07090f', card2: '#0a0d16',
  border: '#ffffff0d', border2: '#ffffff16',
  green: '#00e5a0', red: '#ef4444', amber: '#f59e0b',
  blue: '#3b82f6', purple: '#a78bfa', cyan: '#22d3ee',
  text: '#e2e8f0', muted: '#64748b', subtle: '#1e293b',
};
const COIN_COLORS = { BTC:'#f7931a',ETH:'#627eea',SOL:'#9945ff',XRP:'#00aae4',AVAX:'#e84142',LINK:'#2a5ada',ADA:'#3cc8c8',DOGE:'#c2a633' };
const STRAT_C = { MOMENTUM:C.blue,MEAN_REVERSION:C.cyan,BREAKOUT:C.amber,EMA_CROSS:C.purple,TAKE_PROFIT:C.green,STOP_LOSS:C.red,TRAIL_STOP:C.amber,TREND_REVERSAL:C.amber,HOLD:C.muted };
const LOG_C = { CYCLE:'#334155',MARKET:'#1e293b',AI:C.purple,RULES:C.cyan,SIGNAL:C.green,REASONING:C.text,TRADE:C.green,PROFIT:C.green,LOSS:C.red,POSITION:C.amber,HOLD:C.muted,WARN:C.amber,ERROR:C.red,SYSTEM:C.blue,INFO:C.muted };

// ── Helpers ───────────────────────────────────────────────────────────────────
const fUSD = n => { if(n==null||isNaN(n))return'$—'; const a=Math.abs(n); if(a>=1e6)return`$${(n/1e6).toFixed(2)}M`; if(a>=1000)return`$${n.toLocaleString('en-US',{maximumFractionDigits:2})}`; if(a>=1)return`$${n.toFixed(2)}`; return`$${n.toFixed(4)}`; };
const fPct  = n => n==null?'—':`${n>=0?'+':''}${n.toFixed(2)}%`;
const fTime = iso => !iso?'—':new Date(iso).toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fAge  = iso => { if(!iso)return'—'; const d=(Date.now()-new Date(iso))/1000; if(d<60)return`${Math.round(d)}s ago`; if(d<3600)return`${Math.round(d/60)}m ago`; return`${Math.round(d/3600)}h ago`; };

function useIsMobile() {
  const [m,setM] = useState(window.innerWidth<768);
  useEffect(()=>{ const h=()=>setM(window.innerWidth<768); window.addEventListener('resize',h); return()=>window.removeEventListener('resize',h); },[]);
  return m;
}

// ── Components ────────────────────────────────────────────────────────────────
function Badge({color,children,sm}){ return <span style={{background:color+'1a',color,border:`1px solid ${color}28`,padding:sm?'2px 6px':'3px 10px',borderRadius:5,fontSize:sm?9:11,fontWeight:700,letterSpacing:'0.04em',display:'inline-block'}}>{children}</span>; }
function Btn({onClick,children,variant='ghost',color,size='md',disabled}){ const bg=variant==='solid'?(color||C.green):'transparent'; const fg=variant==='solid'?'#000':(color||C.muted); const bd=variant==='outline'?`1px solid ${color||C.border2}`:`1px solid ${C.border}`; const pad=size==='sm'?'5px 12px':size==='lg'?'12px 24px':'7px 15px'; return <button onClick={onClick} disabled={disabled} style={{background:bg,color:fg,border:bd,padding:pad,borderRadius:7,cursor:disabled?'not-allowed':'pointer',fontFamily:'inherit',fontSize:size==='sm'?11:13,fontWeight:700,opacity:disabled?0.4:1,transition:'all 0.15s',whiteSpace:'nowrap'}}>{children}</button>; }
function Stat({label,value,sub,color,glow}){ return <div style={{background:C.card,border:`1px solid ${glow?color+'30':C.border}`,borderRadius:10,padding:'13px 16px',boxShadow:glow?`0 0 18px ${color}12`:'none',minWidth:0}}><div style={{color:C.muted,fontSize:9,fontWeight:600,letterSpacing:'0.08em',marginBottom:5,textTransform:'uppercase'}}>{label}</div><div style={{fontSize:20,fontWeight:800,color:color||C.text,fontFamily:"'JetBrains Mono',monospace",lineHeight:1}}>{value}</div>{sub&&<div style={{color:C.muted,fontSize:10,marginTop:4}}>{sub}</div>}</div>; }
function Section({title,right,children}){ return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}><div style={{padding:'9px 14px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',background:'#050710'}}><span style={{color:C.muted,fontSize:9,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase'}}>{title}</span>{right&&<span style={{color:C.muted,fontSize:9}}>{right}</span>}</div>{children}</div>; }

// ── Settings Panel ────────────────────────────────────────────────────────────
function SettingsPanel({state,onClose,onSave}){
  const SECRET = import.meta.env.VITE_DASHBOARD_SECRET || 'nexus-secret-2024';
  const [form,setForm] = useState({
    maxTradeUSD:    20,
    stopLossPct:    5,
    takeProfitPct:  8,
    maxDrawdownPct: 20,
    cycleSeconds:   60,
    leverageEnabled:false,
    maxLeverage:    3,
  });
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const inp={background:'#030508',border:`1px solid ${C.border2}`,borderRadius:7,padding:'9px 12px',color:C.text,fontFamily:"'JetBrains Mono',monospace",fontSize:13,width:'100%',outline:'none',boxSizing:'border-box'};

  async function save(){
    setSaving(true);setErr('');
    try{
      const res = await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        action:'settings',secret:SECRET,
        maxTradeUSD:Number(form.maxTradeUSD),
        stopLossPct:Number(form.stopLossPct)/100,
        takeProfitPct:Number(form.takeProfitPct)/100,
        maxDrawdownPct:Number(form.maxDrawdownPct)/100,
        leverageEnabled:form.leverageEnabled,
        maxLeverage:Number(form.maxLeverage),
      })});
      const d=await res.json();
      if(!d.ok)throw new Error(d.error||'Save failed');
      onSave&&onSave();
      onClose();
    }catch(e){setErr(e.message);}
    setSaving(false);
  }

  return(
    <div style={{position:'fixed',inset:0,background:'#000000cc',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:C.card2,border:`1px solid ${C.border2}`,borderRadius:14,padding:28,width:'100%',maxWidth:460,maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:22}}><span style={{color:C.text,fontSize:17,fontWeight:800}}>Bot Settings</span><button onClick={onClose} style={{color:C.muted,background:'none',border:'none',cursor:'pointer',fontSize:22,lineHeight:1}}>×</button></div>
        {err&&<div style={{color:C.red,fontSize:12,marginBottom:14,padding:'9px 12px',background:'#ef444415',borderRadius:7}}>{err}</div>}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
          {[['Max Trade ($)','maxTradeUSD',5,10000],['Stop Loss (%)','stopLossPct',0.5,50],['Take Profit (%)','takeProfitPct',1,100],['Max Drawdown (%)','maxDrawdownPct',5,50]].map(([l,k,mn,mx])=>(
            <div key={k}><div style={{color:C.muted,fontSize:10,fontWeight:600,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.08em'}}>{l}</div><input type="number" min={mn} max={mx} step="0.5" value={form[k]} onChange={e=>set(k,e.target.value)} style={inp}/></div>
          ))}
        </div>
        <div style={{marginBottom:14}}>
          <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer',padding:'10px',background:'#ffffff05',borderRadius:8}}>
            <input type="checkbox" checked={form.leverageEnabled} onChange={e=>set('leverageEnabled',e.target.checked)} style={{accentColor:C.purple,width:16,height:16}}/>
            <span style={{color:C.muted,fontSize:13}}>Enable leverage/perpetuals (requires confidence ≥ 8/10)</span>
          </label>
        </div>
        <div style={{background:'#f59e0b0a',border:'1px solid #f59e0b20',borderRadius:8,padding:'10px 12px',marginBottom:20}}>
          <p style={{color:'#d97706',fontSize:11,lineHeight:1.6}}>⚠ Settings take effect next cycle. Stop/start bot for immediate effect.</p>
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={save} disabled={saving} style={{flex:1,background:C.green,color:'#000',border:'none',borderRadius:8,padding:'11px',fontWeight:800,fontSize:14,cursor:'pointer'}}>{saving?'Saving...':'Save Settings'}</button>
          <Btn onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const {connected,state,prices,botLog,lastUpdated} = useTraderSocket();
  const isMobile = useIsMobile();
  const [tab,setTab] = useState('overview');
  const [showSettings,setShowSettings] = useState(false);
  const [equityCurve,setEquity] = useState([]);
  const [pending,setPending] = useState(false);
  const logRef = useRef(null);
  const SECRET = import.meta.env.VITE_DASHBOARD_SECRET || 'nexus-secret-2024';

  useEffect(()=>{
    if(!state?.trades)return;
    let val=state.startingBalance||100;
    const curve=[{i:0,value:val}];
    [...state.trades].reverse().forEach((t,i)=>{if(t.type==='SELL'&&t.pnl!=null){val+=t.pnl;curve.push({i:i+1,value:+val.toFixed(4)});}});
    setEquity(curve);
  },[state?.trades?.length]);

  useEffect(()=>{ if(logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight; },[botLog?.length]);

  async function control(action){
    setPending(true);
    try{ await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,secret:SECRET})}); }
    catch{}
    setTimeout(()=>setPending(false),1500);
  }

  if(!state) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:C.bg,flexDirection:'column',gap:16}}>
      <div style={{color:C.green,fontSize:22,fontWeight:800,fontFamily:'JetBrains Mono',letterSpacing:'-0.02em'}}>NEXUS</div>
      <div style={{color:connected?C.amber:C.red,fontSize:12}}>{connected?'Connecting to bot...':'Offline — check Railway deployment'}</div>
      <div style={{width:160,height:2,background:C.border,borderRadius:1,overflow:'hidden'}}><div style={{width:'60%',height:'100%',background:C.green,animation:'slide 1.4s infinite'}}/></div>
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}`}</style>
    </div>
  );

  const bs=state, portfolio=bs.portfolio||{}, trades=bs.trades||[];
  let totalValue=bs.balance||0;
  for(const[s,p]of Object.entries(portfolio))totalValue+=(p.qty||0)*(prices[s]?.price||0);
  const pnl=totalValue-(bs.startingBalance||100);
  const pnlPct=(pnl/(bs.startingBalance||100))*100;
  const drawdown=bs.peakValue>0?((bs.peakValue-totalValue)/bs.peakValue*100):0;
  const sells=trades.filter(t=>t.type==='SELL');
  const wins=sells.filter(t=>t.pnl>0).length;
  const winRate=sells.length>0?`${((wins/sells.length)*100).toFixed(0)}%`:'—';
  const isRunning=['running','cycling'].includes(bs.status);
  const TABS=isMobile?['overview','log','trades','market']:['overview','live log','trades','positions','market','analytics'];

  return(
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        button{cursor:pointer;font-family:inherit}
        input,select{font-family:'JetBrains Mono',monospace}
      `}</style>

      {showSettings&&<SettingsPanel state={state} onClose={()=>setShowSettings(false)}/>}

      {/* Risk bar */}
      <div style={{background:'#ef444408',borderBottom:'1px solid #ef444418',padding:'5px 16px',textAlign:'center'}}>
        <span style={{color:'#ef444480',fontSize:10}}>⚠ Crypto trading involves substantial risk of loss. NEXUS is not a financial adviser. All trades may result in losses. Never invest more than you can afford to lose.</span>
      </div>

      {/* Header */}
      <header style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:isMobile?'11px 16px':'11px 22px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,position:'sticky',top:0,zIndex:50}}>
        <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:7}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:isRunning?C.green:C.muted,boxShadow:isRunning?`0 0 7px ${C.green}`:'none',animation:isRunning?'pulse 1.5s infinite':'none'}}/>
            <span style={{color:C.green,fontWeight:800,fontSize:16,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'-0.02em'}}>NEXUS</span>
          </div>
          {!isMobile&&<><span style={{color:C.muted,fontSize:10,padding:'3px 8px',background:'#ffffff06',border:`1px solid ${C.border}`,borderRadius:5,fontFamily:'JetBrains Mono'}}>{(bs.status||'idle').toUpperCase()}</span><span style={{color:C.muted,fontSize:11}}>MODE: <span style={{color:bs.mode==='LIVE'?C.amber:C.blue}}>{bs.mode||'PAPER'}</span></span></>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          {!isMobile&&<div style={{textAlign:'right',marginRight:6}}><div style={{color:pnl>=0?C.green:C.red,fontSize:17,fontWeight:800,fontFamily:"'JetBrains Mono',monospace"}}>{fUSD(totalValue)}</div><div style={{color:pnl>=0?C.green:C.red,fontSize:10}}>{pnl>=0?'+':''}{fUSD(pnl)} ({fPct(pnlPct)})</div></div>}
          {isRunning?<Btn onClick={()=>control('stop')} variant="outline" color={C.red} size="sm" disabled={pending}>◼ Stop</Btn>:<Btn onClick={()=>control('start')} variant="solid" color={C.green} size="sm" disabled={pending}>▶ Start</Btn>}
          <Btn onClick={()=>control('run_once')} size="sm" disabled={pending}>▷{!isMobile&&' Run'}</Btn>
          <Btn onClick={()=>setShowSettings(true)} size="sm">⚙{!isMobile&&' Settings'}</Btn>
          {!isMobile&&<Btn onClick={()=>control('reset')} size="sm" color={C.muted}>↺ Reset</Btn>}
        </div>
      </header>

      {/* Mobile value strip */}
      {isMobile&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,padding:'10px 14px',borderBottom:`1px solid ${C.border}`}}>
          {[{l:'VALUE',v:fUSD(totalValue),c:pnl>=0?C.green:C.red},{l:'P&L',v:`${pnl>=0?'+':''}${fUSD(pnl)}`,c:pnl>=0?C.green:C.red},{l:'WIN RATE',v:winRate,c:C.text}].map(s=>(
            <div key={s.l} style={{background:C.card,borderRadius:8,padding:'9px 10px',textAlign:'center'}}><div style={{color:C.muted,fontSize:8,fontWeight:600,marginBottom:2}}>{s.l}</div><div style={{color:s.c,fontSize:13,fontWeight:800,fontFamily:"'JetBrains Mono',monospace"}}>{s.v}</div></div>
          ))}
        </div>
      )}

      {/* Desktop stats row */}
      {!isMobile&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,background:C.border}}>
          {[
            {label:'PORTFOLIO',value:fUSD(totalValue),sub:`started ${fUSD(bs.startingBalance)}`,color:pnl>=0?C.green:C.red,glow:pnl>0},
            {label:'CASH',value:fUSD(bs.balance),sub:`${totalValue>0?((bs.balance/totalValue)*100).toFixed(0):0}% liquid`},
            {label:'ALL-TIME P&L',value:`${pnl>=0?'+':''}${fUSD(pnl)}`,sub:fPct(pnlPct),color:pnl>=0?C.green:C.red},
            {label:'WIN RATE',value:winRate,sub:`${wins}W / ${sells.length-wins}L`,color:parseInt(winRate)>=50?C.green:C.red},
            {label:'DRAWDOWN',value:fPct(-drawdown),sub:`peak ${fUSD(bs.peakValue)}`,color:drawdown>15?C.red:drawdown>8?C.amber:C.green},
            {label:'FEES PAID',value:fUSD(bs.totalFeesUSD),sub:`${bs.cycleCount||0} cycles run`},
            {label:'OPEN POS',value:Object.keys(portfolio).length,sub:`${trades.length} total trades`},
          ].map((s,i)=>(
            <div key={i} style={{background:C.card,padding:'11px 14px'}}>
              <div style={{color:C.muted,fontSize:8,fontWeight:600,letterSpacing:'0.08em',marginBottom:3,textTransform:'uppercase'}}>{s.label}</div>
              <div style={{fontSize:17,fontWeight:800,color:s.color||C.text,fontFamily:"'JetBrains Mono',monospace"}}>{s.value}</div>
              <div style={{color:C.muted,fontSize:9,marginTop:2}}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:`0 ${isMobile?'14px':'22px'}`,display:'flex',overflowX:'auto',gap:0}}>
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{background:'transparent',border:'none',padding:isMobile?'9px 11px':'9px 15px',color:tab===t?C.green:C.muted,fontFamily:'inherit',fontSize:isMobile?10:11,fontWeight:700,cursor:'pointer',borderBottom:tab===t?`2px solid ${C.green}`:'2px solid transparent',whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'0.06em',transition:'color 0.15s'}}>{t}</button>)}
      </div>

      <div style={{padding:isMobile?'12px 14px':'18px 22px'}}>

        {/* OVERVIEW */}
        {tab==='overview'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'2fr 1fr',gap:14}}>
              <Section title="Equity Curve" right={`${equityCurve.length} data points`}>
                <div style={{padding:14,height:200}}>
                  {equityCurve.length<2
                    ?<div style={{color:C.muted,textAlign:'center',paddingTop:60,fontSize:13}}>Equity curve builds after first sell trades.</div>
                    :<ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={equityCurve}>
                        <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={pnl>=0?C.green:C.red} stopOpacity={0.2}/><stop offset="95%" stopColor={pnl>=0?C.green:C.red} stopOpacity={0}/></linearGradient></defs>
                        <XAxis dataKey="i" hide/><YAxis domain={['auto','auto']} hide/>
                        <Tooltip contentStyle={{background:C.card2,border:`1px solid ${C.border2}`,borderRadius:8,fontSize:11,color:C.text}} formatter={v=>[fUSD(v),'Value']}/>
                        <ReferenceLine y={bs.startingBalance} stroke={C.subtle} strokeDasharray="4 4"/>
                        <Area type="monotone" dataKey="value" stroke={pnl>=0?C.green:C.red} strokeWidth={2} fill="url(#eg)"/>
                      </AreaChart>
                    </ResponsiveContainer>}
                </div>
              </Section>

              <Section title="Last Decision">
                {(()=>{
                  const t=trades[0];
                  if(!t)return<div style={{padding:'24px 16px',color:C.muted,fontSize:13}}>Start bot to see decisions.</div>;
                  const ac=t.type==='BUY'?C.green:t.type==='SELL'?(t.pnl>=0?C.blue:C.red):C.muted;
                  return(
                    <div style={{padding:'13px 15px'}}>
                      <div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
                        <Badge color={ac}>{t.type}</Badge>
                        {t.coin&&<span style={{color:COIN_COLORS[t.coin]||C.text,fontWeight:800,fontSize:18,fontFamily:'JetBrains Mono'}}>{t.coin}</span>}
                        {t.strategy&&<Badge color={STRAT_C[t.strategy]||C.muted} sm>{t.strategy}</Badge>}
                        <span style={{color:C.muted,fontSize:9,marginLeft:'auto'}}>{fAge(t.ts)}</span>
                      </div>
                      {t.type!=='HOLD'&&(
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:10}}>
                          {[['Price',fUSD(t.price)],['Amount',fUSD(t.gross)],['Fee',fUSD(t.fee)],t.pnl!=null?['P&L',`${t.pnl>=0?'+':''}${fUSD(t.pnl)}`]:['Qty',t.qty?.toFixed(5)]].map(([k,v])=>(
                            <div key={k} style={{background:'#ffffff05',padding:'7px 9px',borderRadius:7}}><div style={{color:C.muted,fontSize:8,marginBottom:2}}>{k}</div><div style={{color:k==='P&L'?(t.pnl>=0?C.green:C.red):C.text,fontSize:12,fontWeight:700,fontFamily:'JetBrains Mono'}}>{v}</div></div>
                          ))}
                        </div>
                      )}
                      <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:8}}>{(t.signals||[]).slice(0,3).map((s,i)=><Badge key={i} color={C.cyan} sm>{s}</Badge>)}</div>
                      <div style={{color:'#475569',fontSize:11,lineHeight:1.8,borderLeft:`2px solid ${C.subtle}`,paddingLeft:10}}>{t.reasoning}</div>
                      <div style={{marginTop:6,color:C.muted,fontSize:9}}>CONFIDENCE: <span style={{color:(t.confidence||0)>=7?C.green:(t.confidence||0)>=5?C.amber:C.red}}>{t.confidence||'—'}/10</span></div>
                    </div>
                  );
                })()}
              </Section>
            </div>

            <Section title="Decision Feed" right={`${trades.length} total`}>
              <div style={{maxHeight:300,overflowY:'auto'}}>
                {trades.slice(0,50).map((t,i)=>{
                  const ac=t.type==='BUY'?C.green:t.type==='SELL'?(t.pnl>=0?C.blue:C.red):C.muted;
                  return(
                    <div key={i} style={{padding:isMobile?'9px 12px':'7px 14px',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,background:i%2?'#ffffff01':'transparent'}}>
                      <div style={{display:'flex',gap:7,alignItems:'center',flex:1,minWidth:0}}>
                        <Badge color={ac} sm>{t.type}</Badge>
                        {t.coin&&<span style={{color:COIN_COLORS[t.coin]||C.text,fontWeight:700,fontSize:12,fontFamily:'JetBrains Mono',minWidth:32}}>{t.coin}</span>}
                        {!isMobile&&t.strategy&&<Badge color={STRAT_C[t.strategy]||C.muted} sm>{t.strategy}</Badge>}
                        {!isMobile&&<span style={{color:C.muted,fontSize:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.reasoning?.slice(0,70)}…</span>}
                      </div>
                      <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
                        {t.type!=='HOLD'&&<span style={{color:C.muted,fontSize:11,fontFamily:'JetBrains Mono'}}>{fUSD(t.gross)}</span>}
                        {t.pnl!=null&&<span style={{color:t.pnl>=0?C.green:C.red,fontSize:11,fontFamily:'JetBrains Mono'}}>{t.pnl>=0?'+':''}{fUSD(t.pnl)}</span>}
                        <span style={{color:'#334155',fontSize:9}}>{fTime(t.ts)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          </div>
        )}

        {/* LIVE LOG */}
        {(tab==='live log'||tab==='log')&&(
          <Section title="Bot Reasoning Log · Real-Time" right={`${(botLog||[]).length} entries`}>
            <div ref={logRef} style={{height:isMobile?'calc(100vh - 280px)':'calc(100vh - 320px)',overflowY:'auto',background:'#020307',fontFamily:"'JetBrains Mono',monospace",padding:'4px 0'}}>
              {(!botLog||botLog.length===0)&&<div style={{padding:'20px',color:C.muted,fontSize:12}}>Log appears when bot starts.</div>}
              {(botLog||[]).map((e,i)=>{
                const lc=LOG_C[e.level]||C.muted;
                const big=['TRADE','PROFIT','LOSS','REASONING','CYCLE'].includes(e.level);
                return(
                  <div key={i} style={{padding:big?'6px 14px':'3px 14px',borderBottom:big?`1px solid ${C.border}`:'none',background:big?'#050a18':'transparent',display:'flex',gap:10,alignItems:'flex-start'}}>
                    <span style={{color:'#1e293b',fontSize:9,flexShrink:0,paddingTop:1,minWidth:56}}>{fTime(e.ts)}</span>
                    <span style={{color:lc,fontSize:9,fontWeight:700,minWidth:64,flexShrink:0}}>[{e.level}]</span>
                    <span style={{color:big?C.text:'#475569',fontSize:big?11:10,lineHeight:1.6}}>{e.msg}</span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* TRADES */}
        {tab==='trades'&&(
          <Section title="Trade History" right={`${trades.length} records`}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                <thead><tr style={{background:'#050710'}}>
                  {(isMobile?['TIME','TYPE','COIN','P&L']:['TIME','TYPE','COIN','STRATEGY','PRICE','AMOUNT','FEE','P&L','CONF','SIGNALS']).map(h=>(
                    <th key={h} style={{padding:'8px 11px',color:C.muted,fontWeight:700,fontSize:8,letterSpacing:'0.08em',textAlign:'left',borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {trades.map((t,i)=>(
                    <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2?'#ffffff01':'transparent'}}>
                      <td style={{padding:'7px 11px',color:C.muted,fontSize:9,fontFamily:'JetBrains Mono',whiteSpace:'nowrap'}}>{fTime(t.ts)}</td>
                      <td style={{padding:'7px 11px'}}><Badge color={t.type==='BUY'?C.green:t.type==='SELL'?C.blue:C.muted} sm>{t.type}</Badge></td>
                      <td style={{padding:'7px 11px',color:COIN_COLORS[t.coin]||C.text,fontWeight:700,fontFamily:'JetBrains Mono'}}>{t.coin||'—'}</td>
                      {!isMobile&&<td style={{padding:'7px 11px'}}>{t.strategy&&<Badge color={STRAT_C[t.strategy]||C.muted} sm>{t.strategy}</Badge>}</td>}
                      {!isMobile&&<td style={{padding:'7px 11px',color:C.text,fontFamily:'JetBrains Mono'}}>{fUSD(t.price)}</td>}
                      {!isMobile&&<td style={{padding:'7px 11px',color:C.text,fontFamily:'JetBrains Mono'}}>{fUSD(t.gross)}</td>}
                      {!isMobile&&<td style={{padding:'7px 11px',color:C.muted,fontFamily:'JetBrains Mono'}}>{fUSD(t.fee)}</td>}
                      <td style={{padding:'7px 11px',color:t.pnl==null?C.muted:t.pnl>=0?C.green:C.red,fontFamily:'JetBrains Mono'}}>{t.pnl!=null?`${t.pnl>=0?'+':''}${fUSD(t.pnl)}`:'—'}</td>
                      {!isMobile&&<td style={{padding:'7px 11px',fontFamily:'JetBrains Mono'}}><span style={{color:(t.confidence||0)>=7?C.green:(t.confidence||0)>=5?C.amber:C.red}}>{t.confidence||'—'}/10</span></td>}
                      {!isMobile&&<td style={{padding:'7px 11px'}}><div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{(t.signals||[]).slice(0,2).map((s,j)=><Badge key={j} color={C.cyan} sm>{s}</Badge>)}</div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* POSITIONS */}
        {tab==='positions'&&!isMobile&&(
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {Object.keys(portfolio).length===0
              ?<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'48px',color:C.muted,textAlign:'center',fontSize:14}}>No open positions. Bot waiting for high-conviction setup (score 8+/18).</div>
              :Object.entries(portfolio).map(([sym,pos])=>{
                const px=prices[sym]?.price,posVal=px?pos.qty*px:0;
                const pnl=px?(px-pos.avgCost)*pos.qty:0,pnlP=pos.avgCost>0?((px||0)-pos.avgCost)/pos.avgCost*100:0;
                return(
                  <div key={sym} style={{background:C.card,border:`1px solid ${pnl>=0?C.green+'28':C.red+'28'}`,borderRadius:10,padding:'18px 22px',display:'grid',gridTemplateColumns:'auto 1fr 1fr 1fr 1fr 1fr',gap:14,alignItems:'center'}}>
                    <div style={{width:40,height:40,borderRadius:10,background:(COIN_COLORS[sym]||C.text)+'18',display:'flex',alignItems:'center',justifyContent:'center',color:COIN_COLORS[sym]||C.text,fontWeight:800,fontSize:10,fontFamily:'JetBrains Mono'}}>{sym.slice(0,3)}</div>
                    <div><div style={{color:COIN_COLORS[sym]||C.text,fontWeight:800,fontSize:20,fontFamily:'JetBrains Mono'}}>{sym}</div><div style={{color:C.muted,fontSize:11}}>since {fAge(pos.entryTime)}</div></div>
                    {[['Quantity',pos.qty.toFixed(5)],['Avg Cost',fUSD(pos.avgCost)],['Current',fUSD(px)],['Value',fUSD(posVal)],['P&L',`${pnl>=0?'+':''}${fUSD(pnl)} (${fPct(pnlP)})`]].map(([k,v])=>(
                      <div key={k}><div style={{color:C.muted,fontSize:8,fontWeight:600,marginBottom:3,textTransform:'uppercase'}}>{k}</div><div style={{color:k==='P&L'?(pnl>=0?C.green:C.red):C.text,fontSize:13,fontWeight:700,fontFamily:'JetBrains Mono'}}>{v}</div></div>
                    ))}
                  </div>
                );
              })
            }
          </div>
        )}

        {/* MARKET */}
        {tab==='market'&&(
          <div style={{display:'grid',gridTemplateColumns:`repeat(${isMobile?2:4},1fr)`,gap:12}}>
            {Object.entries(prices).map(([sym,data])=>{
              if(!data)return null;
              const held=portfolio[sym],cc=COIN_COLORS[sym]||C.text,chg=data.change24h||0;
              return(
                <div key={sym} style={{background:C.card,border:`1px solid ${held?cc+'30':C.border}`,borderRadius:10,padding:isMobile?'13px':'17px'}}>
                  {held&&<div style={{float:'right'}}><Badge color={cc} sm>HELD</Badge></div>}
                  <div style={{color:cc,fontWeight:800,fontSize:17,fontFamily:'JetBrains Mono',marginBottom:3}}>{sym}</div>
                  <div style={{color:C.text,fontSize:isMobile?15:18,fontWeight:700,fontFamily:'JetBrains Mono',marginBottom:2}}>{fUSD(data.price)}</div>
                  <div style={{color:chg>=0?C.green:C.red,fontSize:12,marginBottom:isMobile?6:12}}>{fPct(chg)} 24h</div>
                  {!isMobile&&(
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
                      {[['HIGH',fUSD(data.high24h)],['LOW',fUSD(data.low24h)],['VOL',fUSD(data.volume24h)],['OPEN',fUSD(data.openPrice)]].map(([k,v])=>(
                        <div key={k} style={{background:'#ffffff04',padding:'5px 8px',borderRadius:5}}><div style={{color:C.muted,fontSize:8,fontWeight:600,marginBottom:1}}>{k}</div><div style={{color:C.muted,fontSize:10,fontFamily:'JetBrains Mono'}}>{v}</div></div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ANALYTICS */}
        {tab==='analytics'&&!isMobile&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
              <Section title="Strategy Breakdown">
                <div style={{padding:14}}>
                  {(()=>{const s={};trades.forEach(t=>{if(t.strategy&&t.type!=='HOLD')s[t.strategy]=(s[t.strategy]||0)+1;});const tot=Object.values(s).reduce((a,b)=>a+b,0)||1;
                    return Object.entries(s).sort((a,b)=>b[1]-a[1]).map(([st,n])=>(
                      <div key={st} style={{marginBottom:11}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><Badge color={STRAT_C[st]||C.muted} sm>{st}</Badge><span style={{color:C.muted,fontSize:10,fontFamily:'JetBrains Mono'}}>{n} ({((n/tot)*100).toFixed(0)}%)</span></div><div style={{height:3,background:'#ffffff08',borderRadius:2}}><div style={{height:'100%',width:`${(n/tot)*100}%`,background:STRAT_C[st]||C.muted,borderRadius:2,transition:'width 0.5s'}}/></div></div>
                    ));
                  })()}
                </div>
              </Section>
              <Section title="Coin P&L">
                <div style={{padding:14}}>
                  {(()=>{const cp={};trades.filter(t=>t.type==='SELL'&&t.pnl!=null).forEach(t=>{cp[t.coin]=(cp[t.coin]||0)+t.pnl;});
                    return Object.entries(cp).sort((a,b)=>b[1]-a[1]).map(([c,p])=>(
                      <div key={c} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}><span style={{color:COIN_COLORS[c]||C.text,fontWeight:700,fontSize:13,fontFamily:'JetBrains Mono'}}>{c}</span><span style={{color:p>=0?C.green:C.red,fontSize:13,fontFamily:'JetBrains Mono'}}>{p>=0?'+':''}{fUSD(p)}</span></div>
                    ));
                  })()}
                </div>
              </Section>
            </div>
            <Section title="Trade P&L History">
              <div style={{padding:14,height:200}}>
                {(()=>{const d=trades.filter(t=>t.type==='SELL'&&t.pnl!=null).slice(0,40).reverse().map((t,i)=>({i:i+1,pnl:+t.pnl.toFixed(4)}));
                  if(!d.length)return<div style={{color:C.muted,textAlign:'center',paddingTop:70,fontSize:13}}>No closed trades yet.</div>;
                  return<ResponsiveContainer width="100%" height="100%"><BarChart data={d}><XAxis dataKey="i" hide/><YAxis hide/><Tooltip contentStyle={{background:C.card2,border:`1px solid ${C.border2}`,borderRadius:8,fontSize:11}} formatter={v=>[fUSD(v),'P&L']}/><ReferenceLine y={0} stroke={C.subtle}/><Bar dataKey="pnl" radius={[3,3,0,0]} fill={C.green}/></BarChart></ResponsiveContainer>;
                })()}
              </div>
            </Section>
          </div>
        )}
      </div>

      <div style={{padding:'7px 22px',borderTop:`1px solid ${C.border}`,textAlign:'center',color:'#334155',fontSize:9}}>
        PAPER MODE · Crypto trading involves substantial risk · NEXUS is not a financial adviser · {fAge(lastUpdated)} last update
      </div>
    </div>
  );
}

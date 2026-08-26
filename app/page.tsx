"use client";

import { useMemo, useRef, useState } from "react";

type Intent = "explicit" | "implicit" | "unknown" | "negative";
type Persona = {
  id: number; name: string; age: number; city: string; job: string; archetype: string;
  topic: string; secondary: string; stage: string; preference: string; scenario: string;
  intent: Intent; readiness: number; energy: number; messages: number; episodes: number;
  discoverable: boolean; status: "chatting" | "ready" | "resting"; confidence: number;
  summary: string; memories: string[]; transcript: { from: "user" | "agent"; text: string }[];
};
type Match = { id: number; a: Persona; b: Persona; score: number; relation: string; resonance: string; value: string; status: "group" | "one-sided" | "research"; aYes: boolean; bYes: boolean; evidence: string[] };
type SimEvent = { id: number; time: string; type: string; user: string; message: string; tone: "blue" | "cream" | "green" | "gray" };
type Config = { population: number; rounds: number; messages: number; threshold: number; energyMax: number; surprise: number; seed: string };

const FIRST = ["林漪","陈默","周野","沈知夏","许冬青","宋词","姜禾","陆遥","苏霁","唐棠","顾言","简宁","方澈","叶舟","何夕","温岚","谢一","孟川","余声","白榆","秦牧","夏屿","江弥","陶然","闻溪"];
const CITIES = ["上海","北京","杭州","深圳","成都","广州","南京","苏州","厦门","武汉"];
const JOBS = ["独立设计师","AI 产品经理","纪录片导演","品牌策略师","创业者","建筑师","研究员","心理咨询师","程序员","自由撰稿人","策展人","咖啡店主"];
const TOPICS = ["AI 与亲密关系","城市生活","独立创作","女性成长","户外与自然","创业低谷","长期主义","设计研究","心理健康","社区营造","音乐现场","个人表达"];
const STAGES = ["正在启动新项目","职业转型期","刚搬到新城市","寻找长期合作者","重新建立生活节奏","探索副业可能","作品发布前夕","想扩大认知边界"];
const ARCHETYPES = ["安静的建造者","好奇的连接者","敏锐的观察者","温柔的冒险家","务实的理想主义者","慢热的行动派"];
const SCENARIOS = ["深夜复盘","通勤闲聊","项目卡住","周末散步","搬家后的第一周","一次创作低潮","庆祝小小进展","对未来感到模糊"];
const PREFS = ["peer · 同行者","ahead · 过来人","contrast · 不同世界","complement · 互补伙伴"];

function hash(text: string) { let h = 2166136261; for (let i=0;i<text.length;i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
function rng(seed: string) { let s = hash(seed) || 1; return () => ((s = Math.imul(1664525, s) + 1013904223 >>> 0) / 4294967296); }
function clamp(n:number,min=0,max=1){return Math.min(max,Math.max(min,n))}
function pct(n:number){return `${Math.round(n*100)}%`}

function buildSimulation(config: Config, customNames: string[] = []) {
  const r = rng(config.seed);
  const users: Persona[] = Array.from({length: config.population},(_,i)=>{
    const name = customNames[i] || `${FIRST[i%FIRST.length]}${i>=FIRST.length?`·${Math.floor(i/FIRST.length)+1}`:""}`;
    const messages = Math.max(2, Math.round(config.messages*(.35+r()*1.25)));
    const intentRoll = r();
    const intent:Intent = intentRoll<.25?"explicit":intentRoll<.56?"implicit":intentRoll<.84?"unknown":"negative";
    const readiness = clamp(.18 + (1-Math.exp(-messages/11))*.68 + (r()-.5)*.18);
    const energy = Math.min(config.energyMax, (1-Math.exp(-messages/8))*config.energyMax + (r()<.18?1:0));
    const topic = TOPICS[Math.floor(r()*TOPICS.length)];
    const secondary = TOPICS[Math.floor(r()*TOPICS.length)];
    const city = CITIES[Math.floor(r()*CITIES.length)];
    const job = JOBS[Math.floor(r()*JOBS.length)];
    const stage = STAGES[Math.floor(r()*STAGES.length)];
    const scenario = SCENARIOS[Math.floor(r()*SCENARIOS.length)];
    const discoverable = r()>.18;
    const ready = readiness>=config.threshold && discoverable && (intent==="explicit"||intent==="implicit");
    return {id:i+1,name,age:22+Math.floor(r()*18),city,job,archetype:ARCHETYPES[Math.floor(r()*ARCHETYPES.length)],topic,secondary,stage,preference:PREFS[Math.floor(r()*PREFS.length)],scenario,intent,readiness,energy,messages,episodes:Math.max(1,Math.round(messages/6)),discoverable,status:ready?"ready":messages>config.messages*.48?"chatting":"resting",confidence:clamp(readiness-.08+r()*.15),summary:`${job}，目前${stage}。反复提到「${topic}」，在关系里更看重真实、节奏感与共同成长。`,memories:[`最近：${stage}`,`稳定兴趣：${topic}、${secondary}`,`社交偏好：${PREFS[Math.floor(r()*PREFS.length)]}`],transcript:[{from:"agent",text:`今晚想从哪里聊起？我在。`},{from:"user",text:`最近${stage}，我一直在想${topic}这件事。`},{from:"agent",text:`听起来它不只是一个话题，也和你现在所处的阶段有关。最卡住你的是什么？`},{from:"user",text:`可能是身边很少有人真的理解。我不急着要答案，更想遇见能聊深一点的人。`} ]};
  });
  const candidates = users.filter(u=>u.status==="ready" && u.energy>=2);
  const matches: Match[]=[];
  const used = new Set<number>();
  for(let i=0;i<candidates.length;i++){
    const a=candidates[i]; if(used.has(a.id)) continue;
    let best:Persona|undefined; let bestScore=0;
    for(let j=i+1;j<candidates.length;j++){
      const b=candidates[j]; if(used.has(b.id)||a.id===b.id) continue;
      const topical = a.topic===b.topic?.25:(a.secondary===b.topic||a.topic===b.secondary?.16:.06);
      const geo = a.city===b.city?.14:.04;
      const complement = a.preference.includes("contrast")||b.preference.includes("contrast")?.12:.08;
      const score=clamp(.34+topical+geo+complement+(r()-.5)*config.surprise);
      if(score>bestScore){bestScore=score;best=b}
    }
    if(best&&bestScore>.5){
      used.add(a.id);used.add(best.id);
      const aYes=r()<bestScore*.9,bYes=r()<bestScore*.88;
      matches.push({id:matches.length+1,a,b:best,score:bestScore,relation:a.preference.split(" · ")[0],resonance:`都在「${a.topic===best.topic?a.topic:`${a.topic} × ${best.topic}`}」附近寻找更真实的同行感`,value:`${a.name}带来一线经验，${best.name}提供不同视角；两人对关系节奏的期待接近。`,status:aYes&&bYes?"group":aYes||bYes?"one-sided":"research",aYes,bYes,evidence:[`Active State：${a.stage}`,`Stable：${best.topic}`,`${a.city===best.city?"同城可线下":"跨城市适合低压线上连接"}`]});
    }
    if(matches.length>=Math.max(6,Math.round(config.population*.14)))break;
  }
  const events:SimEvent[]=[];let eid=1;
  users.slice(0,Math.min(users.length,26)).forEach((u,i)=>{
    const mm=String(8+Math.floor(i/3)).padStart(2,"0"),ss=String((i*17)%60).padStart(2,"0");
    events.push({id:eid++,time:`14:${mm}:${ss}`,type:i%4===0?"PROFILE_UPDATED":i%4===1?"SESSION_COMPACTED":i%4===2?"INTENT_JUDGED":"ENERGY_CHANGED",user:u.name,message:i%4===0?`Readiness ${pct(Math.max(0,u.readiness-.11))} → ${pct(u.readiness)}`:i%4===1?`${u.messages} 条对话压缩为 episode #${u.episodes}`:i%4===2?`Social Intent → ${u.intent}`:`Energy +${Math.min(1,u.energy).toFixed(1)} · 当前 ${u.energy.toFixed(1)}/${config.energyMax}`,tone:i%4===0?"blue":i%4===1?"cream":i%4===2?"green":"gray"});
  });
  matches.forEach((m,i)=>events.push({id:eid++,time:`15:${String(i+2).padStart(2,"0")}:12`,type:m.status==="group"?"GROUP_CREATED":"OPPORTUNITY_SCORED",user:`${m.a.name} ↔ ${m.b.name}`,message:m.status==="group"?`双方确认，四人群已建立 · score ${m.score.toFixed(2)}`:`关系机会完成双边研究 · score ${m.score.toFixed(2)}`,tone:m.status==="group"?"green":"blue"}));
  return {users,matches,events:events.reverse()};
}

const initialConfig:Config={population:100,rounds:6,messages:12,threshold:.58,energyMax:10,surprise:.24,seed:"VOUCH-042"};
const NAV=[['overview','◉','总览'],['run','✦','模拟运行'],['users','◎','用户宇宙'],['matches','⌁','匹配实验'],['logs','≡','事件日志']] as const;
const intentLabel:Record<Intent,string>={explicit:"Explicit",implicit:"Implicit",unknown:"Unknown",negative:"Negative"};

export default function Home(){
  const [tab,setTab]=useState<(typeof NAV)[number][0]>("overview");
  const [config,setConfig]=useState(initialConfig);
  const [customNames,setCustomNames]=useState<string[]>([]);
  const [data,setData]=useState(()=>buildSimulation(initialConfig));
  const [running,setRunning]=useState(false); const [progress,setProgress]=useState(100);
  const [selectedUser,setSelectedUser]=useState(0); const [selectedMatch,setSelectedMatch]=useState(0);
  const [query,setQuery]=useState(""); const [logFilter,setLogFilter]=useState("ALL");
  const fileRef=useRef<HTMLInputElement>(null);
  const ready=data.users.filter(u=>u.readiness>=config.threshold).length;
  const gated=data.users.filter(u=>u.readiness>=config.threshold&&(u.intent==="explicit"||u.intent==="implicit")&&u.discoverable).length;
  const groups=data.matches.filter(m=>m.status==="group").length;
  const active=data.users.filter(u=>u.status!=="resting").length;
  const mutual=data.matches.length?groups/data.matches.length:0;
  const phase=progress<24?"生成用户与场景":progress<49?"对话与 Memory compaction":progress<70?"Profile / Intent / Energy":progress<88?"Search Plan 与双边研究":"Sequential reveal 与建群";
  const run=()=>{setRunning(true);setProgress(0);let p=0;const t=setInterval(()=>{p+=3+Math.random()*6;if(p>=100){clearInterval(t);setData(buildSimulation(config,customNames));setProgress(100);setRunning(false)}else setProgress(Math.round(p))},90)};
  const filteredUsers=useMemo(()=>data.users.filter(u=>`${u.name}${u.city}${u.job}${u.topic}`.toLowerCase().includes(query.toLowerCase())),[data,query]);
  const u=data.users[selectedUser]||data.users[0]; const match=data.matches[selectedMatch]||data.matches[0];
  const update=<K extends keyof Config>(k:K,v:Config[K])=>setConfig(c=>({...c,[k]:v}));
  const exportRun=()=>{const blob=new Blob([JSON.stringify({config,summary:{ready,gated,matches:data.matches.length,groups},...data},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`vouch-sim-${config.seed}.json`;a.click();URL.revokeObjectURL(a.href)};
  const importPersonas=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;const text=await f.text();let names:string[]=[];try{const x=JSON.parse(text);if(Array.isArray(x))names=x.map((v:any)=>typeof v==="string"?v:String(v.name||v.id||"")).filter(Boolean)}catch{names=text.split(/\r?\n/).slice(1).map(x=>x.split(",")[0].trim()).filter(Boolean)}if(names.length){setCustomNames(names);update("population",Math.min(300,names.length));}}
  return <main>
    <aside className="rail"><div className="brand"><span>V</span><em>Vouch Lab</em><b>α</b></div><nav aria-label="主导航">{NAV.map(([id,icon,label])=><button key={id} className={`nav ${tab===id?'active':''}`} onClick={()=>setTab(id)}><i>{icon}</i><span>{label}</span>{id==="logs"&&<small>{data.events.length}</small>}</button>)}</nav><div className="rail-sep"/><button className="nav" onClick={exportRun}><i>⇩</i><span>导出本轮</span></button><div className="rail-foot"><i/> 模拟引擎在线<br/><small>策略版本 v0.2 · synthetic</small></div></aside>
    <section className="canvas">
      <header><div><p className="eyebrow">SOCIAL AGENT SIMULATOR · {config.seed}</p><h1>{tab==="overview"?"一百个小精灵，正在互相认识。":tab==="run"?"让一次关系实验可复现。":tab==="users"?"每个人，都在被慢慢理解。":tab==="matches"?"不是相似的人，而是值得认识的人。":"看见系统做出的每一个判断。"}</h1><p className="sub">{tab==="overview"?"观察 Memory → Profile → Energy → Matching 的每一步。":tab==="run"?"调整规则，重放对话与匹配链路。":tab==="users"?"检查 Memory、Profile Readiness、Intent 与授权状态。":tab==="matches"?"研究关系假设、双边价值和确认结果。":"全链路 trace：可筛选、可解释、可导出。"}</p></div><div className="header-actions"><button className="ghost" onClick={()=>fileRef.current?.click()}>↑ 导入人设</button><input ref={fileRef} hidden type="file" accept=".json,.csv" onChange={importPersonas}/><button className="run" onClick={()=>{setTab("run");setTimeout(run,0)}} disabled={running}>{running?"模拟中…":"▶ 新建模拟"}</button></div></header>
      {tab==="overview"&&<>
        <div className="stats"><article><label>模拟用户</label><strong>{data.users.length}</strong><em>{active} agents active</em></article><article><label>Profile Ready</label><strong>{ready}</strong><em>{pct(ready/data.users.length)} 画像达标</em></article><article><label>关系机会</label><strong>{data.matches.length}</strong><em>{gated} 通过 Social Gate</em></article><article><label>双向确认率</label><strong>{pct(mutual)}</strong><em>{groups} 个四人群</em></article></div>
        <div className="overview-grid"><article className="card universe"><CardHead title="用户宇宙" sub="人设、Agent 与当前状态" action="查看全部 →" onClick={()=>setTab("users")}/><div className="orbital">{data.users.slice(0,60).map((x,i)=><button aria-label={x.name} title={`${x.name} · ${x.status}`} onClick={()=>{setSelectedUser(x.id-1);setTab("users")}} key={x.id} className={x.status} style={{"--i":i,"--total":Math.min(60,data.users.length)} as React.CSSProperties}/>) }<div className="core">{active}<small>活跃中</small></div></div><div className="legend"><span><i className="blue"/>聊天中 {data.users.filter(x=>x.status==="chatting").length}</span><span><i className="cream"/>可匹配 {data.users.filter(x=>x.status==="ready").length}</span><span><i className="dim"/>休眠 {data.users.filter(x=>x.status==="resting").length}</span></div></article>
        <article className="card pipeline"><CardHead title="本轮漏斗" sub={`${config.seed} · 已完成`} badge="REPLAYABLE"/>{[["Profile Ready",ready,ready/data.users.length],["Intent Gate",gated,gated/Math.max(1,ready)],["机会生成",data.matches.length,data.matches.length/Math.max(1,gated)],["双边通过",groups,groups/Math.max(1,data.matches.length)],["四人群",groups,1]].map(([n,v,p])=><div className="funnel" key={n as string}><span>{n}</span><div><i style={{width:pct(p as number)}}/></div><strong>{v}</strong></div>)}<div className="gate-note"><b>ⓘ</b><span>Unknown ≠ Yes<br/><small>Intent 不充能，只决定是否进入社交引擎。</small></span></div></article></div>
        <div className="lower-grid"><article className="card compact"><CardHead title="正在发生" sub="最新系统事件" action="全部日志 →" onClick={()=>setTab("logs")}/><EventList events={data.events.slice(0,5)}/></article><article className="card compact"><CardHead title="最近的关系机会" sub="Sequential reveal · 非 Top-K" action="匹配实验 →" onClick={()=>setTab("matches")}/>{data.matches.slice(0,3).map((m,i)=><button className="match-row" key={m.id} onClick={()=>{setSelectedMatch(i);setTab("matches")}}><Avatars a={m.a.name} b={m.b.name}/><span><b>{m.a.name} × {m.b.name}</b><small>{m.relation} · {m.resonance}</small></span><strong>{Math.round(m.score*100)}</strong></button>)}</article></div>
      </>}
      {tab==="run"&&<div className="run-layout"><article className="card controls"><CardHead title="实验设置" sub="所有参数随结果一起导出" badge="M1 RULESET"/><label className="field"><span>实验种子 <small>相同参数可复现</small></span><input value={config.seed} onChange={e=>update("seed",e.target.value)}/></label><Slider label="模拟用户" value={config.population} min={20} max={300} step={10} suffix=" 人" onChange={v=>update("population",v)}/><Slider label="对话轮次" value={config.rounds} min={2} max={20} step={1} suffix=" 轮" onChange={v=>update("rounds",v)}/><Slider label="每人平均消息" value={config.messages} min={4} max={40} step={1} suffix=" 条" onChange={v=>update("messages",v)}/><Slider label="Readiness 阈值" value={config.threshold} min={.3} max={.9} step={.01} format={pct} onChange={v=>update("threshold",v)}/><Slider label="每日 Energy 上限" value={config.energyMax} min={3} max={20} step={1} suffix=" E" onChange={v=>update("energyMax",v)}/><Slider label="Surprise tolerance" value={config.surprise} min={0} max={.6} step={.01} format={pct} onChange={v=>update("surprise",v)}/><div className="mode"><span>推演模式</span><button className="selected">规则合成</button><button disabled>LLM 接入 · 后续</button></div><button className="start" disabled={running} onClick={run}>{running?`运行中 · ${progress}%`:`▶ 运行 ${config.population} 个 Agent`}</button></article>
      <div className="run-main"><article className="card simulation"><CardHead title="运行现场" sub={running?phase:"最近一次运行已完成"} badge={running?"LIVE":"DONE"}/><div className="progress"><i style={{width:`${progress}%`}}/></div><div className="flow">{[["01","Conversation","原始对话"],["02","Memory","Session compaction"],["03","Profile","稳定 / 动态画像"],["04","Social Gate","Intent × Energy"],["05","Matching","机会研究"],["06","Outcome","双向确认"]].map((x,i)=><div className={progress>i*18?"passed":""} key={x[0]}><small>{x[0]}</small><b>{x[1]}</b><span>{x[2]}</span></div>)}</div><div className="live-console"><div className="console-top"><span>LIVE TRACE</span><small>{phase}</small></div><EventList events={data.events.slice(0,7)}/></div></article><article className="card compact assumptions"><CardHead title="M1 模型假设" sub="来自产品策略 v0.2"/><ul><li><b>Memory</b><span>按 session / day 压缩，不逐句判断 novelty</span></li><li><b>Readiness</b><span>画像覆盖 + 用户确认 + 最低 context</span></li><li><b>Intent</b><span>Explicit / Implicit / Unknown / Negative</span></li><li><b>Energy</b><span>饱和增长 + E_max；与 Intent 解耦</span></li><li><b>UX</b><span>Sequential reveal；无 Top-K、无社交 Inbox</span></li></ul></article></div></div>}
      {tab==="users"&&<div className="split"><article className="card table-card"><div className="table-tools"><div className="search">⌕ <input placeholder="搜索名字、城市、职业、话题…" value={query} onChange={e=>setQuery(e.target.value)}/></div><span>{filteredUsers.length} / {data.users.length}</span></div><div className="person-table"><div className="tr head"><span>用户 / Agent</span><span>Social Intent</span><span>Readiness</span><span>Energy</span><span>状态</span></div>{filteredUsers.map(x=><button className={`tr ${u?.id===x.id?'selected':''}`} key={x.id} onClick={()=>setSelectedUser(x.id-1)}><span><Avatar name={x.name}/><b>{x.name}<small>{x.city} · {x.job}</small></b></span><span><i className={`intent ${x.intent}`}/>{intentLabel[x.intent]}</span><span><Meter value={x.readiness}/><small>{pct(x.readiness)}</small></span><span>{x.energy.toFixed(1)} / {config.energyMax}</span><span className={`status ${x.status}`}>{x.status==="ready"?"可匹配":x.status==="chatting"?"聊天中":"休眠"}</span></button>)}</div></article>{u&&<article className="card inspector"><div className="identity"><Avatar name={u.name} large/><div><h2>{u.name}</h2><p>{u.age} 岁 · {u.city} · {u.job}</p></div><span className={`status ${u.status}`}>{u.status==="ready"?"可匹配":u.status==="chatting"?"聊天中":"休眠"}</span></div><div className="inspect-metrics"><div><span>Readiness</span><b>{pct(u.readiness)}</b><Meter value={u.readiness}/></div><div><span>Energy</span><b>{u.energy.toFixed(1)}</b><Meter value={u.energy/config.energyMax}/></div><div><span>Evidence</span><b>{pct(u.confidence)}</b><Meter value={u.confidence}/></div></div><section className="profile-block"><label>AGENT 的当前理解</label><p>{u.summary}</p></section><section className="profile-block"><label>MEMORY / PROFILE</label>{u.memories.map((m,i)=><div className="memory" key={m}><i>{i===0?"◷":i===1?"◇":"⌁"}</i><span>{m}<small>{i===0?"Active State · 7 天过期":i===1?"Stable Profile · confidence 0.82":"Social Preference · user confirmed"}</small></span></div>)}</section><section className="profile-block"><label>最近一次对话 · {u.scenario}</label><div className="transcript">{u.transcript.map((m,i)=><p className={m.from} key={i}><b>{m.from==="agent"?"苔苔":"用户"}</b>{m.text}</p>)}</div></section><div className="permission"><span>Discoverable</span><b>{u.discoverable?"ON":"OFF"}</b><small>完整 Profile 不进入发现层</small></div></article>}</div>}
      {tab==="matches"&&<div className="match-layout"><article className="card match-list"><CardHead title="关系机会池" sub={`${data.matches.length} 个 latent opportunities`} badge="NO INBOX"/>{data.matches.map((m,i)=><button key={m.id} className={selectedMatch===i?"selected":""} onClick={()=>setSelectedMatch(i)}><Avatars a={m.a.name} b={m.b.name}/><span><b>{m.a.name} × {m.b.name}</b><small>{m.relation} · {m.a.city===m.b.city?"同城":"跨城"}</small></span><em className={m.status}>{m.status==="group"?"已建群":m.status==="one-sided"?"单边确认":"研究中"}</em><strong>{Math.round(m.score*100)}</strong></button>)}</article>{match&&<article className="card match-detail"><div className="match-hero"><Avatars a={match.a.name} b={match.b.name} large/><p className="eyebrow">SOCIAL OPPORTUNITY #{String(match.id).padStart(3,"0")}</p><h2>{match.a.name} <i>×</i> {match.b.name}</h2><p>{match.relation} relationship hypothesis</p><div className="score-ring" style={{"--score":`${match.score*360}deg`} as React.CSSProperties}><b>{Math.round(match.score*100)}</b><small>fit score</small></div></div><div className="research-grid"><section><label>RESONANCE · 共振</label><p>{match.resonance}</p></section><section><label>MUTUAL VALUE · 双边价值</label><p>{match.value}</p></section></div><section className="evidence"><label>可追溯证据</label>{match.evidence.map(x=><span key={x}>✓ {x}</span>)}</section><div className="consent"><div><Avatar name={match.a.name}/><span>{match.a.name}<small>Agent sequential reveal</small></span><b className={match.aYes?"yes":"wait"}>{match.aYes?"✓ 想认识":"等待"}</b></div><div><Avatar name={match.b.name}/><span>{match.b.name}<small>Inbound Judge</small></span><b className={match.bYes?"yes":"wait"}>{match.bYes?"✓ 想认识":"等待"}</b></div></div>{match.status==="group"?<div className="group-created"><b>✦ 四人小群已建立</b><span>{match.a.name} · Agent A · {match.b.name} · Agent B</span><button>查看模拟群聊 →</button></div>:<div className="waiting">不会暴露另一方的完整 Profile；只有双向确认后才建立四人群。</div>}</article>}</div>}
      {tab==="logs"&&<article className="card logs"><div className="log-head"><div><h2>事件日志</h2><p>{data.events.length} events · {config.seed}</p></div><div>{["ALL","MEMORY","PROFILE","INTENT","ENERGY","MATCH","GROUP"].map(f=><button className={logFilter===f?"active":""} onClick={()=>setLogFilter(f)} key={f}>{f}</button>)}</div><button className="ghost" onClick={exportRun}>⇩ 导出 JSON</button></div><div className="log-columns"><span>TIME</span><span>EVENT</span><span>ENTITY</span><span>DETAIL</span></div>{data.events.filter(e=>logFilter==="ALL"||e.type.includes(logFilter)).map(e=><div className="log-row" key={e.id}><time>{e.time}</time><span className={`event-chip ${e.tone}`}>{e.type}</span><b>{e.user}</b><p>{e.message}</p></div>)}</article>}
    </section>
  </main>
}

function CardHead({title,sub,action,onClick,badge}:{title:string;sub:string;action?:string;onClick?:()=>void;badge?:string}){return <div className="card-head"><div><h2>{title}</h2><p>{sub}</p></div>{action&&<button onClick={onClick}>{action}</button>}{badge&&<b className="live">{badge}</b>}</div>}
function Slider({label,value,min,max,step,suffix="",format,onChange}:{label:string;value:number;min:number;max:number;step:number;suffix?:string;format?:(v:number)=>string;onChange:(v:number)=>void}){return <label className="slider"><span>{label}<b>{format?format(value):value+suffix}</b></span><input type="range" value={value} min={min} max={max} step={step} onChange={e=>onChange(Number(e.target.value))}/></label>}
function Meter({value}:{value:number}){return <i className="meter"><i style={{width:pct(value)}}/></i>}
function Avatar({name,large=false}:{name:string;large?:boolean}){const colors=["#6398c6","#9b8064","#8076a6","#709583","#ae7882"];return <i className={`avatar ${large?"large":""}`} style={{background:colors[hash(name)%colors.length]}}>{name.slice(0,1)}</i>}
function Avatars({a,b,large=false}:{a:string;b:string;large?:boolean}){return <span className={`avatars ${large?"large":""}`}><Avatar name={a} large={large}/><Avatar name={b} large={large}/></span>}
function EventList({events}:{events:SimEvent[]}){return <div className="events">{events.map(e=><div key={e.id}><i className={e.tone}/><time>{e.time}</time><span><b>{e.user}</b><small>{e.message}</small></span></div>)}</div>}

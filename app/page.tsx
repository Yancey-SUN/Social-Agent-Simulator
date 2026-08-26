"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Intent = "explicit" | "implicit" | "unknown" | "negative";
type Persona = {
  id: number; name: string; age: number; city: string; job: string; archetype: string;
  topic: string; secondary: string; stage: string; preference: string; scenario: string;
  intent: Intent; readiness: number; energy: number; messages: number; episodes: number;
  discoverable: boolean; status: "chatting" | "ready" | "resting"; confidence: number;
  summary: string; memories: string[]; transcript: { from: "user" | "agent"; text: string }[];
};
type Match = { id: number; remoteId?: string; a: Persona; b: Persona; score: number; relation: string; resonance: string; value: string; status: "group" | "one-sided" | "research"; aYes: boolean; bYes: boolean; evidence: string[] };
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
const BAZI_PRIORS = ["甲木：认准后持续向上，也不太愿意示弱","乙木：柔软但有韧性，擅长绕开阻力","丙火：热度藏不住，也容易消耗自己","丁火：细腻照顾近处的人，容易反复权衡","戊土：习惯扛事，慢热但关系稳定","己土：很会共情，常先接住别人的情绪","庚金：判断快，直接是保护色","辛金：对美与边界敏感，宁缺毋滥","壬水：思路快，不喜欢被框死","癸水：观察细，不一定立即说出口"];

function hash(text: string) { let h = 2166136261; for (let i=0;i<text.length;i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
function rng(seed: string) { let s = hash(seed) || 1; return () => ((s = Math.imul(1664525, s) + 1013904223 >>> 0) / 4294967296); }
function clamp(n:number,min=0,max=1){return Math.min(max,Math.max(min,n))}
function pct(n:number){return `${Math.round(n*100)}%`}
async function runPool<T>(items:T[],limit:number,worker:(item:T)=>Promise<void>){let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++];await worker(item)}}))}

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

const initialConfig:Config={population:20,rounds:4,messages:8,threshold:.58,energyMax:10,surprise:.24,seed:"VOUCH-REAL-020"};
const NAV=[['overview','◉','总览'],['run','✦','模拟运行'],['users','◎','用户宇宙'],['matches','⌁','匹配实验'],['logs','≡','事件日志']] as const;
const intentLabel:Record<Intent,string>={explicit:"Explicit",implicit:"Implicit",unknown:"Unknown",negative:"Negative"};

export default function Home(){
  const [tab,setTab]=useState<(typeof NAV)[number][0]>("overview");
  const [config,setConfig]=useState(initialConfig);
  const [universeSize,setUniverseSize]=useState(100);
  const [customNames,setCustomNames]=useState<string[]>([]);
  const [data,setData]=useState(()=>buildSimulation({...initialConfig,population:100}));
  const [running,setRunning]=useState(false); const [progress,setProgress]=useState(100);
  const [selectedUser,setSelectedUser]=useState(0); const [selectedMatch,setSelectedMatch]=useState(0);
  const [query,setQuery]=useState(""); const [logFilter,setLogFilter]=useState("ALL");
  const fileRef=useRef<HTMLInputElement>(null);
  const abortRef=useRef<AbortController|null>(null);
  const [runMode,setRunMode]=useState<"real"|"synthetic">("real");
  const [providerReady,setProviderReady]=useState<boolean|null>(null);
  const [sessionKey,setSessionKey]=useState("");
  const [showKey,setShowKey]=useState(false);
  const [abEnabled,setAbEnabled]=useState(true);
  const [modelA,setModelA]=useState("deepseek-v4-flash"),[modelB,setModelB]=useState("deepseek-v4-flash");
  const [promptA,setPromptA]=useState("guardian-v1"),[promptB,setPromptB]=useState("guardian-v2");
  const [concurrency,setConcurrency]=useState(3);
  const [realEvents,setRealEvents]=useState<SimEvent[]>([]);
  const [realUsage,setRealUsage]=useState({input:0,output:0,micros:0,calls:0});
  const [runError,setRunError]=useState("");
  const [activeRunId,setActiveRunId]=useState("");
  useEffect(()=>{fetch("/api/simulate").then(r=>r.json()).then(x=>setProviderReady(Boolean(x.configured))).catch(()=>setProviderReady(false))},[]);
  const hasProvider=Boolean(providerReady||sessionKey.trim().length>10);
  const ready=data.users.filter(u=>u.readiness>=config.threshold).length;
  const gated=data.users.filter(u=>u.readiness>=config.threshold&&(u.intent==="explicit"||u.intent==="implicit")&&u.discoverable).length;
  const groups=data.matches.filter(m=>m.status==="group").length;
  const active=data.users.filter(u=>u.status!=="resting").length;
  const mutual=data.matches.length?groups/data.matches.length:0;
  const phase=progress<24?"生成用户与场景":progress<49?"对话与 Memory compaction":progress<70?"Profile / Intent / Energy":progress<88?"Search Plan 与双边研究":"Sequential reveal 与建群";
  const dryRun=()=>{setRunning(true);setProgress(0);let p=0;const t=setInterval(()=>{p+=3+Math.random()*6;if(p>=100){clearInterval(t);setData(buildSimulation({...config,population:universeSize},customNames));setProgress(100);setRunning(false)}else setProgress(Math.round(p))},90)};
  const filteredUsers=useMemo(()=>data.users.filter(u=>`${u.name}${u.city}${u.job}${u.topic}`.toLowerCase().includes(query.toLowerCase())),[data,query]);
  const u=data.users[selectedUser]||data.users[0]; const match=data.matches[selectedMatch]||data.matches[0];
  const update=<K extends keyof Config>(k:K,v:Config[K])=>setConfig(c=>({...c,[k]:v}));
  const exportRun=()=>{const blob=new Blob([JSON.stringify({config,summary:{ready,gated,matches:data.matches.length,groups},...data},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`vouch-sim-${config.seed}.json`;a.click();URL.revokeObjectURL(a.href)};
  const importPersonas=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;const text=await f.text();let names:string[]=[];try{const x=JSON.parse(text);if(Array.isArray(x))names=x.map((v:any)=>typeof v==="string"?v:String(v.name||v.id||"")).filter(Boolean)}catch{names=text.split(/\r?\n/).slice(1).map(x=>x.split(",")[0].trim()).filter(Boolean)}if(names.length){const size=Math.min(300,Math.max(20,names.length));setCustomNames(names);setUniverseSize(size);setData(buildSimulation({...config,population:size},names));update("population",Math.min(config.population,size));}}
  const api=async(payload:Record<string,unknown>,signal?:AbortSignal)=>{const headers:Record<string,string>={"Content-Type":"application/json"};if(sessionKey.trim())headers["X-DeepSeek-API-Key"]=sessionKey.trim();const res=await fetch("/api/simulate",{method:"POST",headers,body:JSON.stringify(payload),signal});const out=await res.json();if(!res.ok)throw new Error(out.error||`API ${res.status}`);return out};
  const resizeUniverse=(size:number)=>{setUniverseSize(size);setData(buildSimulation({...config,population:size},customNames));if(config.population>size)update("population",size)};
  const pushRealEvent=(type:string,user:string,message:string,tone:SimEvent["tone"]="blue")=>setRealEvents(prev=>[{id:Date.now()+Math.random(),time:new Date().toLocaleTimeString("zh-CN",{hour12:false}),type,user,message,tone},...prev].slice(0,80));
  const addUsage=(x:any)=>x?.usage&&setRealUsage(v=>({input:v.input+(x.usage.input||0),output:v.output+(x.usage.output||0),micros:v.micros+(x.usage.micros||0),calls:v.calls+1}));
  const realRun=async()=>{
    if(!hasProvider){setRunError("请配置站点 Secret，或输入当前会话临时 DeepSeek Key");return}
    setRunning(true);setProgress(0);setRunError("");setRealEvents([]);setRealUsage({input:0,output:0,micros:0,calls:0});
    const controller=new AbortController();abortRef.current=controller;
    try{
      const created=await api({action:"create_run",population:config.population,rounds:config.rounds,concurrency,modelA,modelB,promptA,promptB,config:{seed:config.seed,abEnabled}},controller.signal);setActiveRunId(created.runId);
      const seeds=buildSimulation({...config,population:universeSize},customNames).users.slice(0,config.population).map((p,i)=>({...p,baziPrior:BAZI_PRIORS[i%BAZI_PRIORS.length]}));
      const jobs=seeds.flatMap(persona=>(abEnabled?["A","B"]:["A"]).map(variant=>({persona,variant})));
      const completed:any[]=[];let done=0;
      await runPool(jobs,concurrency,async({persona,variant})=>{
        const model=variant==="A"?modelA:modelB,promptVersion=variant==="A"?promptA:promptB;const history:any[]=[];
        pushRealEvent("AGENT_STARTED",persona.name,`Variant ${variant} · ${model}`,"gray");
        for(let turn=0;turn<config.rounds;turn++){
          const userOut=await api({action:"turn",role:"user",experimentId:created.runId,persona,history,variant,model,promptVersion:"user-v1",turnIndex:turn*2},controller.signal);addUsage(userOut);history.push({speaker:"user",content:userOut.text});pushRealEvent("USER_MESSAGE",persona.name,userOut.text,"cream");
          const agentOut=await api({action:"turn",role:"agent",experimentId:created.runId,persona,history,variant,model,promptVersion,turnIndex:turn*2+1},controller.signal);addUsage(agentOut);history.push({speaker:"agent",content:agentOut.text});pushRealEvent("AGENT_MESSAGE",persona.name,agentOut.text,"blue");
        }
        const profileOut=await api({action:"profile",experimentId:created.runId,persona,history,variant,model:"deepseek-v4-flash"},controller.signal);addUsage(profileOut);completed.push({persona,variant,history,profile:profileOut.profile});pushRealEvent("PROFILE_UPDATED",persona.name,`Readiness ${pct(Number(profileOut.profile.readiness||0))}`,"green");done++;setProgress(Math.round(done/jobs.length*78));
      });
      const realMatches:Match[]=[];const variants=abEnabled?["A","B"]:["A"];
      for(const variant of variants){const pool=completed.filter(x=>x.variant===variant&&Number(x.profile.readiness||0)>=config.threshold);for(let i=0;i+1<pool.length&&i<10;i+=2){const a=pool[i],b=pool[i+1];const out=await api({action:"match",experimentId:created.runId,variant,model:"deepseek-v4-flash",personaAId:a.persona.id,personaBId:b.persona.id,profileA:a.profile,profileB:b.profile},controller.signal);addUsage(out);const rr=out.research;realMatches.push({id:realMatches.length+1,remoteId:out.matchId,a:a.persona,b:b.persona,score:Number(rr.score||0),relation:String(rr.relationship_type||"unexpected"),resonance:String(rr.resonance||""),value:String(rr.mutual_value||""),status:"research",aYes:false,bYes:false,evidence:Array.isArray(rr.evidence)?rr.evidence:[]});pushRealEvent("OPPORTUNITY_SCORED",`${a.persona.name} × ${b.persona.name}`,`Variant ${variant} · score ${Number(rr.score||0).toFixed(2)}`,"green")}}
      const primary=new Map(completed.filter(x=>x.variant==="A").map(x=>[x.persona.id,x]));const base=buildSimulation({...config,population:universeSize},customNames);base.users=base.users.map(p=>{const x=primary.get(p.id);if(!x)return p;const pr=x.profile;return {...p,transcript:x.history.map((m:any)=>({from:m.speaker as "user"|"agent",text:m.content})),summary:String(pr.episode_summary||p.summary),readiness:Number(pr.readiness||0),memories:[...(pr.active_state||[]).slice(0,1).map((z:any)=>`最近：${z.claim}`),...(pr.stable_profile||[]).slice(0,1).map((z:any)=>`稳定倾向：${z.claim}`),`Social Intent：${pr.social_intent?.state||"unknown"}`],intent:(pr.social_intent?.state||"unknown") as Intent,status:Number(pr.readiness||0)>=config.threshold?"ready":"chatting"}});base.matches=realMatches;base.events=[];setData(base);
      await api({action:"complete",experimentId:created.runId,status:"completed"},controller.signal);setProgress(100);pushRealEvent("RUN_COMPLETED","SYSTEM",`${jobs.length} 个 Agent 会话完成 · ${realMatches.length} 个机会`,"green");
    }catch(e){const message=e instanceof Error?e.message:"运行失败";if(message!=="This operation was aborted")setRunError(message)}finally{setRunning(false);abortRef.current=null}
  };
  const recordOutcome=async(checkpoint:string,alive:boolean)=>{if(!match?.remoteId||!activeRunId)return;try{await api({action:"outcome",experimentId:activeRunId,matchId:match.remoteId,checkpoint,acceptedA:true,acceptedB:true,messagesExchanged:alive?12:0,relationshipAlive:alive,note:"manual eval"});pushRealEvent("OUTCOME_SAVED",`${match.a.name} × ${match.b.name}`,`${checkpoint} · ${alive?"关系持续":"未持续"}`,alive?"green":"gray")}catch(e){setRunError(e instanceof Error?e.message:"Outcome 保存失败")}};
  return <main>
    <aside className="rail"><div className="brand"><span>V</span><em>Vouch Lab</em><b>β</b></div><nav aria-label="主导航">{NAV.map(([id,icon,label])=><button key={id} className={`nav ${tab===id?'active':''}`} onClick={()=>setTab(id)}><i>{icon}</i><span>{label}</span>{id==="logs"&&<small>{(realEvents.length||data.events.length)}</small>}</button>)}</nav><div className="rail-sep"/><button className="nav" onClick={exportRun}><i>⇩</i><span>导出本轮</span></button><div className="rail-foot"><i className={hasProvider?"":"offline"}/> {hasProvider?`DeepSeek 已连接${sessionKey?" · 临时 Key":""}`:"等待 DeepSeek Key"}<br/><small>{universeSize} 人宇宙 · 本轮 {config.population} 人</small></div></aside>
    <section className="canvas">
      <header><div><p className="eyebrow">SOCIAL AGENT SIMULATOR · {config.seed}</p><h1>{tab==="overview"?`${data.users.length} 个小精灵，正在真正对话。`:tab==="run"?"让一次关系实验可复现。":tab==="users"?"每个人，都在被慢慢理解。":tab==="matches"?"不是相似的人，而是值得认识的人。":"看见系统做出的每一个判断。"}</h1><p className="sub">{tab==="overview"?"DeepSeek Conversation → Memory → Profile → Matching → Outcome。":tab==="run"?"调整模型与 Prompt，重放真实对话和匹配链路。":tab==="users"?"检查真实对话、Memory、Intent 与画像证据。":tab==="matches"?"研究关系假设、双边价值和长期结果。":"全链路 trace：可筛选、可解释、可导出。"}</p></div><div className="header-actions"><button className="ghost" onClick={()=>fileRef.current?.click()}>↑ 导入人设</button><input ref={fileRef} hidden type="file" accept=".json,.csv" onChange={importPersonas}/><button className="run" onClick={()=>setTab("run")} disabled={running}>{running?`运行中 ${progress}%`:"▶ 新建实验"}</button></div></header>
      {tab==="overview"&&<>
        <div className="stats"><article><label>用户宇宙</label><strong>{data.users.length}</strong><em>本轮抽样 {config.population} 人</em></article><article><label>Profile Ready</label><strong>{ready}</strong><em>{pct(ready/data.users.length)} 画像达标</em></article><article><label>关系机会</label><strong>{data.matches.length}</strong><em>{gated} 通过 Social Gate</em></article><article><label>双向确认率</label><strong>{pct(mutual)}</strong><em>{groups} 个四人群</em></article></div>
        <div className="overview-grid"><article className="card universe"><CardHead title="用户宇宙" sub="人设、Agent 与当前状态" action="查看全部 →" onClick={()=>setTab("users")}/><div className="orbital">{data.users.slice(0,60).map((x,i)=><button aria-label={x.name} title={`${x.name} · ${x.status}`} onClick={()=>{setSelectedUser(x.id-1);setTab("users")}} key={x.id} className={x.status} style={{"--i":i,"--total":Math.min(60,data.users.length)} as React.CSSProperties}/>) }<div className="core">{active}<small>活跃中</small></div></div><div className="legend"><span><i className="blue"/>聊天中 {data.users.filter(x=>x.status==="chatting").length}</span><span><i className="cream"/>可匹配 {data.users.filter(x=>x.status==="ready").length}</span><span><i className="dim"/>休眠 {data.users.filter(x=>x.status==="resting").length}</span></div></article>
        <article className="card pipeline"><CardHead title="本轮漏斗" sub={`${config.seed} · 已完成`} badge="REPLAYABLE"/>{[["Profile Ready",ready,ready/data.users.length],["Intent Gate",gated,gated/Math.max(1,ready)],["机会生成",data.matches.length,data.matches.length/Math.max(1,gated)],["双边通过",groups,groups/Math.max(1,data.matches.length)],["四人群",groups,1]].map(([n,v,p])=><div className="funnel" key={n as string}><span>{n}</span><div><i style={{width:pct(p as number)}}/></div><strong>{v}</strong></div>)}<div className="gate-note"><b>ⓘ</b><span>Unknown ≠ Yes<br/><small>Intent 不充能，只决定是否进入社交引擎。</small></span></div></article></div>
        <div className="lower-grid"><article className="card compact"><CardHead title="正在发生" sub="最新系统事件" action="全部日志 →" onClick={()=>setTab("logs")}/><EventList events={data.events.slice(0,5)}/></article><article className="card compact"><CardHead title="最近的关系机会" sub="Sequential reveal · 非 Top-K" action="匹配实验 →" onClick={()=>setTab("matches")}/>{data.matches.slice(0,3).map((m,i)=><button className="match-row" key={m.id} onClick={()=>{setSelectedMatch(i);setTab("matches")}}><Avatars a={m.a.name} b={m.b.name}/><span><b>{m.a.name} × {m.b.name}</b><small>{m.relation} · {m.resonance}</small></span><strong>{Math.round(m.score*100)}</strong></button>)}</article></div>
      </>}
      {tab==="run"&&<div className="run-layout"><article className="card controls"><CardHead title="实验设置" sub={`从 ${universeSize} 人宇宙中抽样`} badge="DEEPSEEK"/><div className={`provider ${hasProvider?"connected":"missing"}`}><i/><span><b>{hasProvider?`DeepSeek 已连接${sessionKey?" · 当前会话 Key":" · 环境 Secret"}`:"需要配置 API Key"}</b><small>{sessionKey?"刷新页面即清除，不写数据库或日志":providerReady?"服务端默认密钥已就绪":"可在下方输入临时 Key"}</small></span><button className="key-toggle" onClick={()=>setShowKey(!showKey)}>{showKey?"收起":"更换"}</button></div>{showKey&&<div className="session-key"><label>当前会话临时 Key<input type="password" autoComplete="off" placeholder="sk-… 仅保存在页面内存" value={sessionKey} onChange={e=>setSessionKey(e.target.value)}/></label><div><button onClick={()=>setSessionKey("")}>清除临时 Key</button><small>临时 Key 优先于站点环境变量</small></div></div>}<label className="field"><span>实验种子 <small>相同人设可复现</small></span><input value={config.seed} onChange={e=>update("seed",e.target.value)}/></label><Slider label="本轮抽样人数" value={config.population} min={2} max={universeSize} step={2} suffix={` / ${universeSize} 人`} onChange={v=>update("population",v)}/><Slider label="每人对话轮次" value={config.rounds} min={1} max={8} step={1} suffix=" 轮" onChange={v=>update("rounds",v)}/><Slider label="并发数" value={concurrency} min={1} max={6} step={1} suffix="" onChange={setConcurrency}/><Slider label="Readiness 阈值" value={config.threshold} min={.3} max={.9} step={.01} format={pct} onChange={v=>update("threshold",v)}/><div className="ab-switch"><span><b>A/B 对照实验</b><small>相同人设分别运行两个版本</small></span><button className={abEnabled?"on":""} onClick={()=>setAbEnabled(!abEnabled)}><i/></button></div><Variant label="A" model={modelA} prompt={promptA} setModel={setModelA} setPrompt={setPromptA}/>{abEnabled&&<Variant label="B" model={modelB} prompt={promptB} setModel={setModelB} setPrompt={setPromptB}/>}<div className="mode"><span>运行方式</span><button className={runMode==="real"?"selected":""} onClick={()=>setRunMode("real")}>真实 LLM</button><button className={runMode==="synthetic"?"selected":""} onClick={()=>setRunMode("synthetic")}>零成本 dry run</button></div>{runError&&<div className="run-error">{runError}</div>}<button className="start" disabled={running||(runMode==="real"&&!hasProvider)} onClick={runMode==="real"?realRun:dryRun}>{running?`运行中 · ${progress}%`:`▶ 运行 ${config.population} 人${abEnabled&&runMode==="real"?" × A/B":""}`}</button>{running&&<button className="stop" onClick={()=>abortRef.current?.abort()}>停止实验</button>}<p className="budget-note">用户池与运行人数独立；扩大宇宙不会自动产生 API 成本。</p></article>
      <div className="run-main"><article className="card simulation"><CardHead title="运行现场" sub={running?phase:activeRunId?`Run ${activeRunId.slice(-8)} 已完成`:"等待开始真实实验"} badge={running?"LIVE":activeRunId?"SAVED":"READY"}/><div className="progress"><i style={{width:`${progress}%`}}/></div><div className="usage-strip"><div><span>API CALLS</span><b>{realUsage.calls}</b></div><div><span>INPUT</span><b>{realUsage.input.toLocaleString()}</b></div><div><span>OUTPUT</span><b>{realUsage.output.toLocaleString()}</b></div><div><span>EST. COST</span><b>${(realUsage.micros/1e6).toFixed(4)}</b></div></div><div className="flow">{[["01","Conversation","双 Agent 多轮对话"],["02","Memory","Session compaction"],["03","Profile","证据化字段"],["04","Social Gate","Intent × Energy"],["05","Matching","双边关系研究"],["06","Outcome","Day 0/3/7/30"]].map((x,i)=><div className={progress>i*18?"passed":""} key={x[0]}><small>{x[0]}</small><b>{x[1]}</b><span>{x[2]}</span></div>)}</div><div className="live-console"><div className="console-top"><span>LIVE DEEPSEEK TRACE</span><small>{running?phase:realEvents.length?`${realEvents.length} events`:"等待运行"}</small></div><EventList events={(realEvents.length?realEvents:data.events).slice(0,9)}/></div></article><article className="card compact assumptions"><CardHead title="实验解释" sub="避免同模型自嗨与错误归因"/><ul><li><b>Persona</b><span>命理只作冷启动先验；真实问题可自由发散</span></li><li><b>A/B</b><span>相同人设分别跑 A/B，减少样本差异</span></li><li><b>Memory</b><span>每项保留 evidence、confidence、recency、permission</span></li><li><b>Cost</b><span>按每次 API 返回的 usage 实时累计</span></li><li><b>Outcome</b><span>Day 0/3/7/30 持久化回流，而非只看点击</span></li></ul></article></div></div>}
      {tab==="users"&&<div className="split"><article className="card table-card"><div className="universe-controls"><span><b>用户宇宙</b><small>池子大小不会触发模型调用</small></span><input aria-label="用户宇宙规模" type="range" min="20" max="300" step="20" value={universeSize} onChange={e=>resizeUniverse(Number(e.target.value))}/><strong>{universeSize} 人</strong><em>本轮选择 {config.population} 人</em></div><div className="table-tools"><div className="search">⌕ <input placeholder="搜索名字、城市、职业、话题…" value={query} onChange={e=>setQuery(e.target.value)}/></div><span>{filteredUsers.length} / {data.users.length}</span></div><div className="person-table"><div className="tr head"><span>用户 / Agent</span><span>Social Intent</span><span>Readiness</span><span>Energy</span><span>状态</span></div>{filteredUsers.map(x=><button className={`tr ${u?.id===x.id?'selected':''}`} key={x.id} onClick={()=>setSelectedUser(x.id-1)}><span><Avatar name={x.name}/><b>{x.name}<small>{x.city} · {x.job}</small></b></span><span><i className={`intent ${x.intent}`}/>{intentLabel[x.intent]}</span><span><Meter value={x.readiness}/><small>{pct(x.readiness)}</small></span><span>{x.energy.toFixed(1)} / {config.energyMax}</span><span className={`status ${x.status}`}>{x.status==="ready"?"可匹配":x.status==="chatting"?"聊天中":"休眠"}</span></button>)}</div></article>{u&&<article className="card inspector"><div className="identity"><Avatar name={u.name} large/><div><h2>{u.name}</h2><p>{u.age} 岁 · {u.city} · {u.job}</p></div><span className={`status ${u.status}`}>{u.status==="ready"?"可匹配":u.status==="chatting"?"聊天中":"休眠"}</span></div><div className="inspect-metrics"><div><span>Readiness</span><b>{pct(u.readiness)}</b><Meter value={u.readiness}/></div><div><span>Energy</span><b>{u.energy.toFixed(1)}</b><Meter value={u.energy/config.energyMax}/></div><div><span>Evidence</span><b>{pct(u.confidence)}</b><Meter value={u.confidence}/></div></div><section className="profile-block"><label>AGENT 的当前理解</label><p>{u.summary}</p></section><section className="profile-block"><label>MEMORY / PROFILE</label>{u.memories.map((m,i)=><div className="memory" key={m}><i>{i===0?"◷":i===1?"◇":"⌁"}</i><span>{m}<small>{i===0?"Active State · 7 天过期":i===1?"Stable Profile · confidence 0.82":"Social Preference · user confirmed"}</small></span></div>)}</section><section className="profile-block"><label>最近一次对话 · {u.scenario}</label><div className="transcript">{u.transcript.map((m,i)=><p className={m.from} key={i}><b>{m.from==="agent"?"苔苔":"用户"}</b>{m.text}</p>)}</div></section><div className="permission"><span>Discoverable</span><b>{u.discoverable?"ON":"OFF"}</b><small>完整 Profile 不进入发现层</small></div></article>}</div>}
      {tab==="matches"&&<div className="match-layout"><article className="card match-list"><CardHead title="关系机会池" sub={`${data.matches.length} 个 latent opportunities`} badge="NO INBOX"/>{data.matches.map((m,i)=><button key={m.id} className={selectedMatch===i?"selected":""} onClick={()=>setSelectedMatch(i)}><Avatars a={m.a.name} b={m.b.name}/><span><b>{m.a.name} × {m.b.name}</b><small>{m.relation} · {m.a.city===m.b.city?"同城":"跨城"}</small></span><em className={m.status}>{m.status==="group"?"已建群":m.status==="one-sided"?"单边确认":"研究中"}</em><strong>{Math.round(m.score*100)}</strong></button>)}</article>{match&&<article className="card match-detail"><div className="match-hero"><Avatars a={match.a.name} b={match.b.name} large/><p className="eyebrow">SOCIAL OPPORTUNITY #{String(match.id).padStart(3,"0")}</p><h2>{match.a.name} <i>×</i> {match.b.name}</h2><p>{match.relation} relationship hypothesis</p><div className="score-ring" style={{"--score":`${match.score*360}deg`} as React.CSSProperties}><b>{Math.round(match.score*100)}</b><small>fit score</small></div></div><div className="research-grid"><section><label>RESONANCE · 共振</label><p>{match.resonance}</p></section><section><label>MUTUAL VALUE · 双边价值</label><p>{match.value}</p></section></div><section className="evidence"><label>可追溯证据</label>{match.evidence.map(x=><span key={x}>✓ {x}</span>)}</section><div className="consent"><div><Avatar name={match.a.name}/><span>{match.a.name}<small>Agent sequential reveal</small></span><b className={match.aYes?"yes":"wait"}>{match.aYes?"✓ 想认识":"等待"}</b></div><div><Avatar name={match.b.name}/><span>{match.b.name}<small>Inbound Judge</small></span><b className={match.bYes?"yes":"wait"}>{match.bYes?"✓ 想认识":"等待"}</b></div></div>{match.status==="group"?<div className="group-created"><b>✦ 四人小群已建立</b><span>{match.a.name} · Agent A · {match.b.name} · Agent B</span><button>查看模拟群聊 →</button></div>:<div className="waiting">不会暴露另一方的完整 Profile；只有双向确认后才建立四人群。</div>}{match.remoteId&&<div className="outcome-panel"><label>LONG-TERM OUTCOME 回流</label><div><button onClick={()=>recordOutcome("day0",true)}>Day 0 双向接受</button><button onClick={()=>recordOutcome("day3",true)}>Day 3 有对话</button><button onClick={()=>recordOutcome("day7",true)}>Day 7 仍持续</button><button onClick={()=>recordOutcome("day30",false)}>Day 30 已结束</button></div></div>}</article>}</div>}
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
function Variant({label,model,prompt,setModel,setPrompt}:{label:string;model:string;prompt:string;setModel:(x:string)=>void;setPrompt:(x:string)=>void}){return <div className="variant"><b>VARIANT {label}</b><label>模型<select value={model} onChange={e=>setModel(e.target.value)}><option value="deepseek-v4-flash">DeepSeek V4 Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label><label>Prompt<select value={prompt} onChange={e=>setPrompt(e.target.value)}><option value="guardian-v1">guardian-v1 · 温和承接</option><option value="guardian-v2">guardian-v2 · 独立朋友</option></select></label></div>}

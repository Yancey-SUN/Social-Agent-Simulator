import { env } from "cloudflare:workers";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { experiments, failures, matches, messages, outcomes, profiles } from "../../../db/schema";
import { buildUserSimulationPrompt, NATURAL_GUARDIAN_PROMPT } from "./prompts";

type HistoryItem = { speaker: "user" | "agent"; content: string };
type GroupHistoryItem = { speaker: string; content: string };
type PersonaSeed = { id: number | string; name: string; age?: number; city?: string; job?: string; archetype?: string; topic?: string; secondary?: string; stage?: string; scenario?: string; preference?: string; baziPrior?: string };
type DeepSeekUsage = { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
type ProviderName = "deepseek" | "openai" | "qwen" | "moonshot" | "siliconflow";

const PROVIDER_BASES: Record<ProviderName, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  moonshot: "https://api.moonshot.cn/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
};
const PROVIDERS = Object.keys(PROVIDER_BASES) as ProviderName[];
const PRICE: Record<string, { input: number; output: number }> = {
  "deepseek-v4-flash": { input: .44, output: 1.32 },
  "deepseek-v4-pro": { input: 1.32, output: 3.96 },
};

const guardianPrompts: Record<string, string> = {
  "guardian-natural-v3": NATURAL_GUARDIAN_PROMPT,
  "guardian-v1": `你是用户熟悉的守护灵朋友，有判断但不抢着解决问题。像微信聊天：有时只接一句，有时讲一个具体联想，有时沉默在某个细节上。问题只是偶尔使用，不把每轮变成访谈。不做情绪复读，不把普通生活命理化，不声称命理是科学事实。`,
  "guardian-v2": `你是一个有独立生活、边界、偏好和轻微缺点的小精灵朋友。你会记得前文，也会走神、分享自己的虚拟日常、温和反驳、开一点不过火的玩笑或自然换话题。少做分析，不像客服、咨询师或采访者，不主动讲命理。`,
};

function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function jsonError(message: string, status = 400) { return Response.json({ error: message }, { status }); }
function safeModel(value: unknown) { const model = String(value || "deepseek-v4-flash").trim(); return /^[a-zA-Z0-9._:/-]{1,100}$/.test(model) ? model : "deepseek-v4-flash"; }
function safeProvider(value: unknown): ProviderName { const provider = String(value || "deepseek") as ProviderName; return PROVIDERS.includes(provider) ? provider : "deepseek"; }
function transcript(history: HistoryItem[]) { return history.map((m, i) => `${i + 1}. ${m.speaker === "user" ? "用户" : "守护灵"}：${m.content}`).join("\n"); }
function splitChatBubbles(content: string) {
  const lines = content.replace(/```(?:text)?/gi, "").split(/\n+/).map(line => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "").replace(/^(?:用户|守护者|小精灵)[:：]\s*/, "")).filter(Boolean);
  return (lines.length ? lines : [content.trim()]).slice(0, 3);
}
function bubbleCap(personaId: string, turnIndex: number, role: string) { const seed = `${personaId}:${turnIndex}:${role}`; let value = 0; for (const char of seed) value = (value * 31 + char.charCodeAt(0)) % 100; return value < 80 ? 1 : value < 95 ? 2 : 3; }
function runtimeEnv() { return env as unknown as { LLM_API_KEY?: string; LLM_PROVIDER?: string; LLM_BASE_URL?: string; DEEPSEEK_API_KEY?: string; DEEPSEEK_BASE_URL?: string } }
function parseJson(content: string) { const clean = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); const start = clean.indexOf("{"); const end = clean.lastIndexOf("}"); return JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean); }
function profileTerms(profile: Record<string, unknown>) { const text = JSON.stringify(profile || {}).toLowerCase(); const terms = new Set<string>(text.match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2}/g) || []); for (const part of text.match(/[\u4e00-\u9fff]{3,}/g) || []) for (let i = 0; i < part.length - 1; i++) terms.add(part.slice(i, i + 2)); return terms; }
function claim(profile: Record<string, any>, field: "stable_profile" | "active_state") { const item = Array.isArray(profile?.[field]) ? profile[field][0] : null; return String(item?.claim || "").trim(); }
function deterministicResearch(profileA: Record<string, any>, profileB: Record<string, any>) {
  const termsA = profileTerms(profileA), termsB = profileTerms(profileB); let overlap = 0; for (const term of termsA) if (termsB.has(term)) overlap++;
  const overlapRatio = overlap / Math.max(1, Math.min(termsA.size, termsB.size));
  const evidenceA = (profileA.stable_profile?.length || 0) + (profileA.active_state?.length || 0), evidenceB = (profileB.stable_profile?.length || 0) + (profileB.active_state?.length || 0);
  const intentA = profileA.social_intent?.state, intentB = profileB.social_intent?.state;
  const preferenceA = String(profileA.social_preference?.relationship || "unknown"), preferenceB = String(profileB.social_preference?.relationship || "unknown");
  const intentBonus = [intentA, intentB].some(x => x === "explicit" || x === "implicit") ? .07 : 0;
  const preferenceBonus = preferenceA !== "unknown" || preferenceB !== "unknown" ? .06 : 0;
  const evidenceBonus = Math.min(.12, Math.min(evidenceA, evidenceB) * .025);
  const score = Math.max(.5, Math.min(.88, .46 + Math.min(.19, overlapRatio * .55) + intentBonus + preferenceBonus + evidenceBonus));
  const activeA = claim(profileA, "active_state") || claim(profileA, "stable_profile") || "正在形成更清晰的生活方向";
  const activeB = claim(profileB, "active_state") || claim(profileB, "stable_profile") || "愿意从具体日常开始认识别人";
  const relation = preferenceA !== "unknown" ? preferenceA : preferenceB !== "unknown" ? preferenceB : overlapRatio > .08 ? "peer" : "complement";
  return { score: Number(score.toFixed(3)), relationship_type: relation, resonance: `一方${activeA}；另一方${activeB}。两人的现阶段存在可以自然展开的连接点。`, mutual_value: overlapRatio > .08 ? "已有共同语境，第一次聊天容易从具体经历开始，同时保留不同视角。" : "生活经验并不完全相同，可能为彼此提供新的活动线索和观察角度。", risk: intentBonus ? "仍需尊重双方当下的社交节奏。" : "社交意图证据较弱，建议以低压力群聊验证真实意愿。", evidence: [`A：${activeA}`, `B：${activeB}`, `画像关键词交集 ${overlap} 项 · 双方证据 ${evidenceA}/${evidenceB} 项`], recommend: score >= .55, engine: "profile-matching-v1" };
}

async function callDeepSeek(args: { provider?: ProviderName; model: string; system: string; user: string; json?: boolean; maxTokens?: number; apiKey?: string }) {
  const runtime = runtimeEnv();
  const provider = safeProvider(args.provider || runtime.LLM_PROVIDER);
  const apiKey = args.apiKey || runtime.LLM_API_KEY || (provider === "deepseek" ? runtime.DEEPSEEK_API_KEY : undefined);
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY_NOT_CONFIGURED");
  const model = safeModel(args.model);
  const envProvider = safeProvider(runtime.LLM_PROVIDER);
  const baseUrl = (provider === envProvider ? runtime.LLM_BASE_URL : undefined) || (provider === "deepseek" ? runtime.DEEPSEEK_BASE_URL : undefined) || PROVIDER_BASES[provider];
  const started = Date.now();
  let lastError = "DeepSeek returned empty content";
  const attempts = 3;
  const totalUsage: DeepSeekUsage = {};
  for (let attempt = 0; attempt < attempts; attempt++) {
    const maxTokens = Math.min(args.json ? 6400 : 720, (args.maxTokens || 500) * 2 ** attempt);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: args.system }, { role: "user", content: args.user }], stream: false, max_tokens: maxTokens }),
    });
    const body = await response.json() as { error?: { message?: string }; choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: DeepSeekUsage };
    if (!response.ok) {
      lastError = body.error?.message || `DeepSeek API ${response.status}`;
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) { await new Promise(resolve => setTimeout(resolve, 700 * 2 ** attempt)); continue; }
      throw new Error(lastError);
    }
    const choice = body.choices?.[0];
    totalUsage.prompt_tokens = (totalUsage.prompt_tokens || 0) + (body.usage?.prompt_tokens || 0);
    totalUsage.completion_tokens = (totalUsage.completion_tokens || 0) + (body.usage?.completion_tokens || 0);
    const content = choice?.message?.content?.trim() || "";
    if (choice?.finish_reason === "length") {
      lastError = "模型回复因长度限制被截断";
      if (attempt < attempts - 1) continue;
      throw new Error(lastError);
    }
    if (content) return { content, usage: totalUsage, latencyMs: Date.now() - started, model, provider };
    lastError = "DeepSeek JSON mode returned empty content; retried once";
  }
  throw new Error(lastError);
}

async function addUsage(experimentId: string, model: string, usage: DeepSeekUsage) {
  const input = usage.prompt_tokens || 0, output = usage.completion_tokens || 0;
  const price = PRICE[model];
  const micros = price ? Math.round(input * price.input + output * price.output) : 0;
  try {
    await getDb().update(experiments).set({ inputTokens: sql`${experiments.inputTokens} + ${input}`, outputTokens: sql`${experiments.outputTokens} + ${output}`, estimatedCostMicros: sql`${experiments.estimatedCostMicros} + ${micros}` }).where(eq(experiments.id, experimentId));
  } catch { /* A response should still be usable if usage logging briefly fails. */ }
  return { input, output, micros };
}

export async function GET(request: Request) {
  const configured = Boolean(request.headers.get("x-llm-api-key") || request.headers.get("x-deepseek-api-key") || runtimeEnv().LLM_API_KEY || runtimeEnv().DEEPSEEK_API_KEY);
  const defaultProvider = runtimeEnv().LLM_API_KEY ? safeProvider(runtimeEnv().LLM_PROVIDER) : "deepseek";
  const runId = new URL(request.url).searchParams.get("run_id");
  try {
    const db = getDb();
    if (runId) {
      const run = await db.select().from(experiments).where(eq(experiments.id, runId)).limit(1);
      const savedMessages = await db.select().from(messages).where(eq(messages.experimentId, runId));
      const savedProfiles = await db.select().from(profiles).where(eq(profiles.experimentId, runId));
      const savedMatches = await db.select().from(matches).where(eq(matches.experimentId, runId));
      const savedOutcomes = await db.select().from(outcomes).where(eq(outcomes.experimentId, runId));
      const savedFailures = await db.select().from(failures).where(eq(failures.experimentId, runId));
      return Response.json({ configured, defaultProvider, run: run[0] || null, messages: savedMessages, profiles: savedProfiles, matches: savedMatches, outcomes: savedOutcomes, failures: savedFailures });
    }
    const runs = await db.select().from(experiments).orderBy(desc(experiments.createdAt)).limit(12);
    return Response.json({ configured, defaultProvider, providers: PROVIDERS, runs });
  } catch {
    return Response.json({ configured, defaultProvider, providers: PROVIDERS, runs: [], storage: "unavailable_in_local_preview" });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, any>;
    const sessionApiKey = request.headers.get("x-llm-api-key") || request.headers.get("x-deepseek-api-key") || undefined;
    const provider = safeProvider(request.headers.get("x-llm-provider") || body.provider);
    const action = String(body.action || "");
    const db = getDb();
    if (action === "create_run") {
      const runId = id("run"), now = new Date();
      await db.insert(experiments).values({ id: runId, createdAt: now, status: "running", population: Math.min(300, Math.max(1, Number(body.population || 20))), rounds: Math.min(20, Math.max(1, Number(body.rounds || 4))), concurrency: Math.min(8, Math.max(1, Number(body.concurrency || 3))), modelA: safeModel(body.modelA), modelB: safeModel(body.modelB), promptA: String(body.promptA || "guardian-natural-v3"), promptB: String(body.promptB || "guardian-natural-v3"), configJson: JSON.stringify(body.config || {}) });
      return Response.json({ runId }, { status: 201 });
    }
    if (action === "turn") {
      const persona = body.persona as PersonaSeed, history = (body.history || []) as HistoryItem[];
      const role = body.role === "user" ? "user" : "agent", model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A";
      const baseTurnIndex = Number(body.turnIndex || 0) * 10;
      const existing = await db.select().from(messages).where(and(eq(messages.experimentId, String(body.experimentId)), eq(messages.personaId, String(persona.id)), eq(messages.variant, variant), eq(messages.speaker, role), gte(messages.turnIndex, baseTurnIndex), lte(messages.turnIndex, baseTurnIndex + 2)));
      if (existing.length) { const texts = existing.sort((a,b)=>a.turnIndex-b.turnIndex).map(x=>x.content); return Response.json({ text: texts[0], texts, usage: { input: 0, output: 0, micros: 0, latencyMs: 0 }, model: existing[0].model, replayed: true }); }
      const system = role === "user"
        ? buildUserSimulationPrompt(persona)
        : (guardianPrompts[String(body.promptVersion)] || guardianPrompts["guardian-natural-v3"]);
      const user = role === "user" ? `这是你和守护者目前的微信聊天记录：\n${transcript(history) || "（还没有聊天记录）"}\n\n现在轮到你发消息。默认只发 1 个完整微信气泡；确有自然补充时可发 2 个，最多 3 个，每个气泡单独一行。不要重复最近已经表达过的意思。` : `这是你和用户目前的微信聊天记录：\n${transcript(history)}\n\n现在轮到你回复。默认只发 1 个完整微信气泡；确有新信息需要补充时可发 2 个，最多 3 个，每个气泡单独一行。不要复述最近消息。`;
      const result = await callDeepSeek({ provider, model, system, user, maxTokens: 140, apiKey: sessionApiKey });
      const usage = await addUsage(String(body.experimentId), result.model, result.usage);
      const texts = splitChatBubbles(result.content).slice(0, bubbleCap(String(persona.id), Number(body.turnIndex || 0), role));
      await db.insert(messages).values(texts.map((content, bubbleIndex) => ({ id: id("msg"), experimentId: String(body.experimentId), personaId: String(persona.id), variant, turnIndex: baseTurnIndex + bubbleIndex, speaker: role, content, model: result.model, promptVersion: String(body.promptVersion || "user-natural-v2"), inputTokens: bubbleIndex === 0 ? usage.input : 0, outputTokens: bubbleIndex === 0 ? usage.output : 0, latencyMs: bubbleIndex === 0 ? result.latencyMs : 0, createdAt: new Date() })));
      return Response.json({ text: texts[0], texts, usage: { ...usage, latencyMs: result.latencyMs }, model: result.model });
    }
    if (action === "profile") {
      const persona = body.persona as PersonaSeed, history = (body.history || []) as HistoryItem[], model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A", partialSession = Boolean(body.partialSession);
      const existing = await db.select().from(profiles).where(and(eq(profiles.experimentId, String(body.experimentId)), eq(profiles.personaId, String(persona.id)), eq(profiles.variant, variant))).limit(1);
      if (existing.length) return Response.json({ profile: parseJson(existing[0].profileJson), usage: { input: 0, output: 0, micros: 0, latencyMs: 0 }, replayed: true });
      if (!history.length) return jsonError("没有任何已完成消息，无法生成画像", 422);
      const system = `你是 Memory Session Compactor 与 Profile Curator。只根据已经发生的对话证据输出紧凑 JSON，即使对话中途停止、话题尚未聊完，也必须基于现有内容尽力形成阶段性画像与 readiness；不能因为会话不完整而拒绝输出。证据不足的字段保持 unknown，并在 open_questions 标记，不要用人设设定补齐对话中没有透露的信息。不做命理推断，不把一次性情绪写成稳定人格。Unknown 不等于 Yes。Readiness 表示现有证据是否足够支持负责任的社交推荐：0–0.29 零散闲聊；0.30–0.49 有基础状态但缺社交意图/偏好；0.50–0.61 仅探索；0.62–0.79 至少三个证据维度且包含社交意图或关系偏好；0.80–1.0 丰富长期证据。不得只因用户问 AI 是否有空而判断社交意图。episode_summary 不超过120字；stable_profile、active_state、no_go、open_questions 各最多3项；每条 claim/evidence 不超过80字。只输出一个 JSON 对象，不要解释。结构：{"episode_summary":"","stable_profile":[{"claim":"","evidence":"","confidence":0.0}],"active_state":[{"claim":"","evidence":"","expires_days":7}],"social_intent":{"state":"explicit|implicit|unknown|negative","topic":"","strength":0.0,"evidence":""},"social_preference":{"relationship":"ahead|peer|contrast|complement|unknown","evidence":""},"no_go":[],"open_questions":[],"readiness":0.0,"partial_session":${partialSession}}`;
      const result = await callDeepSeek({ provider, model, system, user: `用户：${persona.name}\n已完成的 ${history.length} 条消息（会话可能中途停止）：\n${transcript(history)}\n只输出完整紧凑 JSON。`, json: true, maxTokens: 1600, apiKey: sessionApiKey });
      const profile = parseJson(result.content); const usage = await addUsage(String(body.experimentId), result.model, result.usage);
      await db.insert(profiles).values({ id: id("profile"), experimentId: String(body.experimentId), personaId: String(persona.id), variant, profileJson: JSON.stringify(profile), readiness: Math.max(0, Math.min(1, Number(profile.readiness || 0))), evidenceJson: JSON.stringify([...(profile.stable_profile || []), ...(profile.active_state || [])]), createdAt: new Date() });
      return Response.json({ profile, usage: { ...usage, latencyMs: result.latencyMs } });
    }
    if (action === "match") {
      const variant = body.variant === "B" ? "B" : "A";
      const existing = await db.select().from(matches).where(and(eq(matches.experimentId, String(body.experimentId)), eq(matches.personaAId, String(body.personaAId)), eq(matches.personaBId, String(body.personaBId)), eq(matches.variant, variant))).limit(1);
      if (existing.length) return Response.json({ matchId: existing[0].id, research: parseJson(existing[0].researchJson), usage: { input: 0, output: 0, micros: 0, latencyMs: 0 }, replayed: true });
      const research = deterministicResearch(body.profileA || {}, body.profileB || {}), matchId = id("match");
      await db.insert(matches).values({ id: matchId, experimentId: String(body.experimentId), personaAId: String(body.personaAId), personaBId: String(body.personaBId), variant, score: Math.max(0, Math.min(1, Number(research.score || 0))), relationType: String(research.relationship_type || "unexpected"), researchJson: JSON.stringify(research), status: research.recommend ? "opportunity" : "filtered", createdAt: new Date() });
      return Response.json({ matchId, research, usage: { input: 0, output: 0, micros: 0, latencyMs: 0 }, engine: "profile-matching-v1" });
    }
    if (action === "match_existing") {
      const experimentId = String(body.experimentId), threshold = Math.max(0, Math.min(1, Number(body.threshold || .3))), savedProfiles = await db.select().from(profiles).where(eq(profiles.experimentId, experimentId));
      const created: Array<{ matchId: string; personaAId: string; personaBId: string; variant: string; research: ReturnType<typeof deterministicResearch> }> = [];
      for (const variant of ["A", "B"]) {
        const pool = savedProfiles.filter(row => row.variant === variant && row.readiness >= threshold).map(row => ({ row, profile: parseJson(row.profileJson) as Record<string, any> }));
        const candidates: Array<{ a: typeof pool[number]; b: typeof pool[number]; retrieval: number }> = [];
        for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) { const research = deterministicResearch(pool[i].profile, pool[j].profile); candidates.push({ a: pool[i], b: pool[j], retrieval: research.score }); }
        candidates.sort((a, b) => b.retrieval - a.retrieval); const used = new Set<string>();
        for (const pair of candidates) {
          if (used.has(pair.a.row.personaId) || used.has(pair.b.row.personaId)) continue;
          const existing = await db.select().from(matches).where(and(eq(matches.experimentId, experimentId), eq(matches.personaAId, pair.a.row.personaId), eq(matches.personaBId, pair.b.row.personaId), eq(matches.variant, variant))).limit(1);
          if (existing.length) { used.add(pair.a.row.personaId); used.add(pair.b.row.personaId); continue; }
          const research = deterministicResearch(pair.a.profile, pair.b.profile), matchId = id("match");
          await db.insert(matches).values({ id: matchId, experimentId, personaAId: pair.a.row.personaId, personaBId: pair.b.row.personaId, variant, score: research.score, relationType: research.relationship_type, researchJson: JSON.stringify(research), status: "opportunity", createdAt: new Date() });
          created.push({ matchId, personaAId: pair.a.row.personaId, personaBId: pair.b.row.personaId, variant, research }); used.add(pair.a.row.personaId); used.add(pair.b.row.personaId);
        }
      }
      return Response.json({ created, threshold, engine: "profile-matching-v1" }, { status: 201 });
    }
    if (action === "create_group") {
      const matchId = String(body.matchId), variant = body.variant === "B" ? "B" : "A", groupKey = `group:${matchId}`;
      const existing = await db.select().from(messages).where(and(eq(messages.experimentId, String(body.experimentId)), eq(messages.personaId, groupKey), eq(messages.variant, variant))).orderBy(messages.turnIndex);
      if (existing.length) return Response.json({ messages: existing.map(row => ({ speaker: row.speaker, content: row.content })), replayed: true });
      const personaA = body.personaA as PersonaSeed, personaB = body.personaB as PersonaSeed, research = body.research || {};
      const resonance = String(research.resonance || "你们最近关注的事情有一些很自然的连接点").replace(/\s+/g, " ").slice(0, 100);
      const opening = [
        { speaker: "agent_a", content: `我把你们拉进来啦。${resonance}，感觉你们可能会聊得来。你们随意，不用照顾我。` },
        { speaker: "agent_b", content: `我也先潜水，除非你们 @ 我。${personaA.name}、${personaB.name}，从最近最想吐槽的小事开始就行哈哈。` },
      ];
      await db.insert(messages).values(opening.map((item, turnIndex) => ({ id: id("msg"), experimentId: String(body.experimentId), personaId: groupKey, variant, turnIndex, speaker: item.speaker, content: item.content, model: "system", promptVersion: "group-cold-start-v1", inputTokens: 0, outputTokens: 0, latencyMs: 0, createdAt: new Date() })));
      await db.update(matches).set({ status: "group" }).where(eq(matches.id, matchId));
      const day0 = await db.select().from(outcomes).where(and(eq(outcomes.experimentId, String(body.experimentId)), eq(outcomes.matchId, matchId), eq(outcomes.checkpoint, "day0"))).limit(1);
      if (!day0.length) await db.insert(outcomes).values({ id: id("outcome"), experimentId: String(body.experimentId), matchId, checkpoint: "day0", acceptedA: true, acceptedB: true, messagesExchanged: 0, relationshipAlive: true, note: "simulation auto mutual consent", createdAt: new Date() });
      return Response.json({ messages: opening }, { status: 201 });
    }
    if (action === "group_turn") {
      const matchId = String(body.matchId), variant = body.variant === "B" ? "B" : "A", groupKey = `group:${matchId}`;
      const persona = body.persona as PersonaSeed, peer = body.peer as PersonaSeed, speaker = body.speaker === "user_b" ? "user_b" : "user_a", turnIndex = Math.max(2, Number(body.turnIndex || 2));
      const existing = await db.select().from(messages).where(and(eq(messages.experimentId, String(body.experimentId)), eq(messages.personaId, groupKey), eq(messages.variant, variant), eq(messages.speaker, speaker), eq(messages.turnIndex, turnIndex))).limit(1);
      if (existing.length) return Response.json({ text: existing[0].content, usage: { input: 0, output: 0, micros: 0, latencyMs: 0 }, replayed: true });
      const history = (body.history || []) as GroupHistoryItem[];
      const groupSystem = `${buildUserSimulationPrompt(persona)}\n\n# 四人群聊补充规则\n你现在已经同意认识 ${peer.name}，正在一个有你、${peer.name} 和双方 AI 守护者的四人微信群里。守护者开场后会潜水。你是在和另一个真人聊天，不是在继续向 AI 倾诉。自然接住对方刚说的具体内容，也可以分享一个相关小事、轻微跑题、开玩笑或表达不同意见。不要急着建立深度关系，不要采访，不要写动作或旁白。通常只发一个短气泡。你知道两个守护者是 AI；只有确实想让它们补充信息时才 @守护者。`;
      const groupTranscript = history.map((item, index) => `${index + 1}. ${item.speaker}：${item.content}`).join("\n");
      const result = await callDeepSeek({ provider, model: safeModel(body.model), system: groupSystem, user: `群聊记录：\n${groupTranscript}\n\n现在轮到你回复 ${peer.name}。只输出这次真正会发的一条微信消息。`, maxTokens: 120, apiKey: sessionApiKey });
      const usage = await addUsage(String(body.experimentId), result.model, result.usage), content = splitChatBubbles(result.content)[0];
      await db.insert(messages).values({ id: id("msg"), experimentId: String(body.experimentId), personaId: groupKey, variant, turnIndex, speaker, content, model: result.model, promptVersion: "group-human-v1", inputTokens: usage.input, outputTokens: usage.output, latencyMs: result.latencyMs, createdAt: new Date() });
      return Response.json({ text: content, usage: { ...usage, latencyMs: result.latencyMs } });
    }
    if (action === "group_agent") {
      const matchId = String(body.matchId), variant = body.variant === "B" ? "B" : "A", groupKey = `group:${matchId}`;
      const speaker = body.speaker === "agent_b" ? "agent_b" : "agent_a", turnIndex = Number(body.turnIndex || 2), history = (body.history || []) as GroupHistoryItem[];
      const last = history[history.length - 1]?.content || "";
      if (!/@(?:守护者|小精灵|agent|Agent|苔苔)/.test(last)) return Response.json({ skipped: true });
      const result = await callDeepSeek({ provider, model: safeModel(body.model), system: `${NATURAL_GUARDIAN_PROMPT}\n\n你在用户匹配后的四人群里。平时保持潜水；现在因为被 @ 才回复。只补充被问到的信息或轻轻推动一次，不主导两个用户的聊天，只发一个短气泡。`, user: `群聊：\n${history.map((item, index) => `${index + 1}. ${item.speaker}：${item.content}`).join("\n")}\n\n你被 @ 了，回复一次。`, maxTokens: 100, apiKey: sessionApiKey });
      const usage = await addUsage(String(body.experimentId), result.model, result.usage), content = splitChatBubbles(result.content)[0];
      await db.insert(messages).values({ id: id("msg"), experimentId: String(body.experimentId), personaId: groupKey, variant, turnIndex, speaker, content, model: result.model, promptVersion: "group-agent-mention-v1", inputTokens: usage.input, outputTokens: usage.output, latencyMs: result.latencyMs, createdAt: new Date() });
      return Response.json({ text: content, usage: { ...usage, latencyMs: result.latencyMs } });
    }
    if (action === "outcome") {
      await db.insert(outcomes).values({ id: id("outcome"), experimentId: String(body.experimentId), matchId: String(body.matchId), checkpoint: String(body.checkpoint || "day0"), acceptedA: Boolean(body.acceptedA), acceptedB: Boolean(body.acceptedB), messagesExchanged: Number(body.messagesExchanged || 0), relationshipAlive: Boolean(body.relationshipAlive), note: String(body.note || ""), createdAt: new Date() });
      return Response.json({ saved: true }, { status: 201 });
    }
    if (action === "failure") {
      const rawMessage = String(body.message || "未知错误").replace(/\s+/g, " ").trim();
      await db.insert(failures).values({ id: id("failure"), experimentId: String(body.experimentId), personaId: String(body.personaId || ""), variant: body.variant === "B" ? "B" : "A", stage: String(body.stage || "unknown").slice(0, 48), errorCode: String(body.errorCode || "UNKNOWN").slice(0, 48), message: rawMessage.slice(0, 600), createdAt: new Date() });
      return Response.json({ saved: true }, { status: 201 });
    }
    if (action === "complete") {
      await db.update(experiments).set({ status: String(body.status || "completed"), completedAt: new Date() }).where(eq(experiments.id, String(body.experimentId)));
      return Response.json({ completed: true });
    }
    return jsonError("Unknown action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.includes("DEEPSEEK_API_KEY_NOT_CONFIGURED")) return jsonError("当前 LLM Provider 的 API Key 尚未配置", 503);
    return jsonError(message, 500);
  }
}

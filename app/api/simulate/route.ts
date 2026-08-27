import { env } from "cloudflare:workers";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { experiments, failures, matches, messages, outcomes, profiles } from "../../../db/schema";
import { buildUserSimulationPrompt, NATURAL_GUARDIAN_PROMPT } from "./prompts";

type HistoryItem = { speaker: "user" | "agent"; content: string };
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
      const persona = body.persona as PersonaSeed, history = (body.history || []) as HistoryItem[], model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A";
      const existing = await db.select().from(profiles).where(and(eq(profiles.experimentId, String(body.experimentId)), eq(profiles.personaId, String(persona.id)), eq(profiles.variant, variant))).limit(1);
      if (existing.length) return Response.json({ profile: parseJson(existing[0].profileJson), usage: { input: 0, output: 0, micros: 0, latencyMs: 0 }, replayed: true });
      const system = `你是 Memory Session Compactor 与 Profile Curator。只根据对话证据输出紧凑 JSON，不做命理推断，不把一次性情绪写成稳定人格。Unknown 不等于 Yes。Readiness 表示证据是否足够支持负责任的社交推荐：0–0.29 零散闲聊；0.30–0.49 有基础状态但缺社交意图/偏好；0.50–0.61 仅探索；0.62–0.79 至少三个证据维度且包含社交意图或关系偏好；0.80–1.0 丰富长期证据。不得只因用户问 AI 是否有空而判断社交意图。episode_summary 不超过120字；stable_profile、active_state、no_go、open_questions 各最多3项；每条 claim/evidence 不超过80字。只输出一个 JSON 对象，不要解释。结构：{"episode_summary":"","stable_profile":[{"claim":"","evidence":"","confidence":0.0}],"active_state":[{"claim":"","evidence":"","expires_days":7}],"social_intent":{"state":"explicit|implicit|unknown|negative","topic":"","strength":0.0,"evidence":""},"social_preference":{"relationship":"ahead|peer|contrast|complement|unknown","evidence":""},"no_go":[],"open_questions":[],"readiness":0.0}`;
      const result = await callDeepSeek({ provider, model, system, user: `用户：${persona.name}\n对话：\n${transcript(history)}\n只输出完整紧凑 JSON。`, json: true, maxTokens: 1600, apiKey: sessionApiKey });
      const profile = parseJson(result.content); const usage = await addUsage(String(body.experimentId), result.model, result.usage);
      await db.insert(profiles).values({ id: id("profile"), experimentId: String(body.experimentId), personaId: String(persona.id), variant, profileJson: JSON.stringify(profile), readiness: Math.max(0, Math.min(1, Number(profile.readiness || 0))), evidenceJson: JSON.stringify([...(profile.stable_profile || []), ...(profile.active_state || [])]), createdAt: new Date() });
      return Response.json({ profile, usage: { ...usage, latencyMs: result.latencyMs } });
    }
    if (action === "match") {
      const model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A";
      const existing = await db.select().from(matches).where(and(eq(matches.experimentId, String(body.experimentId)), eq(matches.personaAId, String(body.personaAId)), eq(matches.personaBId, String(body.personaBId)), eq(matches.variant, variant))).limit(1);
      if (existing.length) return Response.json({ matchId: existing[0].id, research: parseJson(existing[0].researchJson), usage: { input: 0, output: 0, micros: 0, latencyMs: 0 }, replayed: true });
      const system = `你是 Relationship Researcher。评估的单位是 Social Opportunity，不做整段聊天相似度。综合 active state、intent、topic、stage、preference、no_go、mutual value 与适度 surprise。只输出 json。JSON 示例：{"score":0.0,"relationship_type":"peer|ahead|contrast|complement|unexpected","resonance":"","mutual_value":"","risk":"","evidence":[""],"recommend":true}`;
      const result = await callDeepSeek({ provider, model, system, user: `候选A：${JSON.stringify(body.profileA)}\n候选B：${JSON.stringify(body.profileB)}\n只输出完整关系研究 JSON。`, json: true, maxTokens: 1000, apiKey: sessionApiKey });
      const research = parseJson(result.content), matchId = id("match"), usage = await addUsage(String(body.experimentId), result.model, result.usage);
      await db.insert(matches).values({ id: matchId, experimentId: String(body.experimentId), personaAId: String(body.personaAId), personaBId: String(body.personaBId), variant, score: Math.max(0, Math.min(1, Number(research.score || 0))), relationType: String(research.relationship_type || "unexpected"), researchJson: JSON.stringify(research), status: research.recommend ? "opportunity" : "filtered", createdAt: new Date() });
      return Response.json({ matchId, research, usage: { ...usage, latencyMs: result.latencyMs } });
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

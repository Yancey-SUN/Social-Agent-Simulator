import { env } from "cloudflare:workers";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { experiments, matches, messages, outcomes, profiles } from "../../../db/schema";

type HistoryItem = { speaker: "user" | "agent"; content: string };
type PersonaSeed = { id: number | string; name: string; age?: number; city?: string; job?: string; archetype?: string; topic?: string; secondary?: string; stage?: string; scenario?: string; baziPrior?: string };
type DeepSeekUsage = { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };

const MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const PRICE: Record<string, { input: number; output: number }> = {
  "deepseek-v4-flash": { input: .44, output: 1.32 },
  "deepseek-v4-pro": { input: 1.32, output: 3.96 },
};

const guardianPrompts: Record<string, string> = {
  "guardian-v1": `你是用户熟悉的守护灵朋友，有判断但不抢着解决问题。像微信聊天：有时只接一句，有时讲一个具体联想，有时沉默在某个细节上。问题只是偶尔使用，不把每轮变成访谈。不做情绪复读，不把普通生活命理化，不声称命理是科学事实。`,
  "guardian-v2": `你是一个有独立生活、边界、偏好和轻微缺点的小精灵朋友。你会记得前文，也会走神、分享自己的虚拟日常、温和反驳、开一点不过火的玩笑或自然换话题。少做分析，不像客服、咨询师或采访者，不主动讲命理。`,
};

function id(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function jsonError(message: string, status = 400) { return Response.json({ error: message }, { status }); }
function safeModel(value: unknown) { const model = String(value || "deepseek-v4-flash"); return MODELS.has(model) ? model : "deepseek-v4-flash"; }
function transcript(history: HistoryItem[]) { return history.map((m, i) => `${i + 1}. ${m.speaker === "user" ? "用户" : "守护灵"}：${m.content}`).join("\n"); }
function runtimeEnv() { return env as unknown as { DEEPSEEK_API_KEY?: string; DEEPSEEK_BASE_URL?: string } }

async function callDeepSeek(args: { model: string; system: string; user: string; json?: boolean; maxTokens?: number; apiKey?: string }) {
  const runtime = runtimeEnv();
  const apiKey = args.apiKey || runtime.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY_NOT_CONFIGURED");
  const model = safeModel(args.model);
  const started = Date.now();
  let lastError = "DeepSeek returned empty content";
  const attempts = args.json ? 3 : 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(`${(runtime.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: args.system }, { role: "user", content: args.user }], stream: false, max_tokens: args.maxTokens || 500, ...(args.json ? { response_format: { type: "json_object" } } : {}) }),
    });
    const body = await response.json() as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }>; usage?: DeepSeekUsage };
    if (!response.ok) {
      lastError = body.error?.message || `DeepSeek API ${response.status}`;
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) { await new Promise(resolve => setTimeout(resolve, 700 * 2 ** attempt)); continue; }
      throw new Error(lastError);
    }
    const content = body.choices?.[0]?.message?.content?.trim() || "";
    if (content) return { content, usage: body.usage || {}, latencyMs: Date.now() - started, model };
    lastError = "DeepSeek JSON mode returned empty content; retried once";
  }
  throw new Error(lastError);
}

async function addUsage(experimentId: string, model: string, usage: DeepSeekUsage) {
  const input = usage.prompt_tokens || 0, output = usage.completion_tokens || 0;
  const price = PRICE[model] || PRICE["deepseek-v4-flash"];
  const micros = Math.round(input * price.input + output * price.output);
  try {
    await getDb().update(experiments).set({ inputTokens: sql`${experiments.inputTokens} + ${input}`, outputTokens: sql`${experiments.outputTokens} + ${output}`, estimatedCostMicros: sql`${experiments.estimatedCostMicros} + ${micros}` }).where(eq(experiments.id, experimentId));
  } catch { /* A response should still be usable if usage logging briefly fails. */ }
  return { input, output, micros };
}

export async function GET(request: Request) {
  const configured = Boolean(request.headers.get("x-deepseek-api-key") || runtimeEnv().DEEPSEEK_API_KEY);
  const runId = new URL(request.url).searchParams.get("run_id");
  try {
    const db = getDb();
    if (runId) {
      const run = await db.select().from(experiments).where(eq(experiments.id, runId)).limit(1);
      const savedMessages = await db.select().from(messages).where(eq(messages.experimentId, runId));
      const savedProfiles = await db.select().from(profiles).where(eq(profiles.experimentId, runId));
      const savedMatches = await db.select().from(matches).where(eq(matches.experimentId, runId));
      const savedOutcomes = await db.select().from(outcomes).where(eq(outcomes.experimentId, runId));
      return Response.json({ configured, run: run[0] || null, messages: savedMessages, profiles: savedProfiles, matches: savedMatches, outcomes: savedOutcomes });
    }
    const runs = await db.select().from(experiments).orderBy(desc(experiments.createdAt)).limit(12);
    return Response.json({ configured, models: [...MODELS], runs });
  } catch {
    return Response.json({ configured, models: [...MODELS], runs: [], storage: "unavailable_in_local_preview" });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, any>;
    const sessionApiKey = request.headers.get("x-deepseek-api-key") || undefined;
    const action = String(body.action || "");
    const db = getDb();
    if (action === "create_run") {
      const runId = id("run"), now = new Date();
      await db.insert(experiments).values({ id: runId, createdAt: now, status: "running", population: Math.min(300, Math.max(2, Number(body.population || 20))), rounds: Math.min(10, Math.max(1, Number(body.rounds || 4))), concurrency: Math.min(8, Math.max(1, Number(body.concurrency || 3))), modelA: safeModel(body.modelA), modelB: safeModel(body.modelB), promptA: String(body.promptA || "guardian-v1"), promptB: String(body.promptB || "guardian-v2"), configJson: JSON.stringify(body.config || {}) });
      return Response.json({ runId }, { status: 201 });
    }
    if (action === "turn") {
      const persona = body.persona as PersonaSeed, history = (body.history || []) as HistoryItem[];
      const role = body.role === "user" ? "user" : "agent", model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A";
      const conversationFingerprint = `${persona.archetype || "慢热"}；最近${persona.stage || "在调整生活"}；职业视角是${persona.job || "自由职业"}；容易从${persona.topic || "日常细节"}联想到${persona.secondary || "另一件小事"}；说话节奏编号${String(persona.id).slice(-2)}`;
      const system = role === "user"
        ? `你不是助手，而是正在和熟悉的小精灵聊天的真实用户“${persona.name}”。你${persona.age || 29}岁，在${persona.city || "一座城市"}做${persona.job || "自己的工作"}。人物指纹：${conversationFingerprint}。命理意象${persona.baziPrior || "无"}只用于冷启动气质，不要主动讲命理。\n像真人一样延续自己的记忆和立场：可以说琐事、跳话题、吐槽、纠正前一句、只回几个字、讲一个具体经历，或暂时不接对方的问题。不要为了匹配而说想认识人，不要使用“很少有人理解我”“想找能聊深的人”等抽象社交模板。不要每条都写括号动作或舞台说明，五条里最多一次。长度在 6–90 个汉字间自然变化；至少一半消息不提问。只输出这一条用户消息。`
        : `${guardianPrompts[String(body.promptVersion)] || guardianPrompts["guardian-v1"]}\n当前用户指纹：${conversationFingerprint}。不要像咨询师，不要每轮追问；至少四成回复不带问号。可以回应后停住、分享一个很短的精灵日常、提出具体看法、温和反驳或自然换话题。避免“听起来……”“你是A还是B”“最卡住你的是什么”等模板句。回复 1–3 句，语气与前文不同，不复述用户原话。`;
      const user = role === "user" ? `当前场景：${persona.scenario || "一次普通闲聊"}\n潜在关注：${persona.topic || "最近的生活"}、${persona.secondary || "关系"}\n已有对话：\n${transcript(history) || "（这是第一句话，请从一个具体生活细节自然开始）"}` : `用户画像先验：${persona.name}，${persona.stage || "生活变化期"}，可能关注${persona.topic || "最近的生活"}。\n已有对话：\n${transcript(history)}\n请回复用户最后一句。`;
      const result = await callDeepSeek({ model, system, user, maxTokens: 180, apiKey: sessionApiKey });
      const usage = await addUsage(String(body.experimentId), result.model, result.usage);
      await db.insert(messages).values({ id: id("msg"), experimentId: String(body.experimentId), personaId: String(persona.id), variant, turnIndex: Number(body.turnIndex || 0), speaker: role, content: result.content, model: result.model, promptVersion: String(body.promptVersion || "user-v1"), inputTokens: usage.input, outputTokens: usage.output, latencyMs: result.latencyMs, createdAt: new Date() });
      return Response.json({ text: result.content, usage: { ...usage, latencyMs: result.latencyMs }, model: result.model });
    }
    if (action === "profile") {
      const persona = body.persona as PersonaSeed, history = (body.history || []) as HistoryItem[], model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A";
      const system = `你是 Memory Session Compactor 与 Profile Curator。只根据对话证据输出 json，不做命理推断，不把一次性情绪写成稳定人格。Unknown 不等于 Yes。每项保留 evidence、confidence、recency、permission。JSON 示例：{"episode_summary":"","stable_profile":[{"claim":"","evidence":"","confidence":0.0}],"active_state":[{"claim":"","evidence":"","expires_days":7}],"social_intent":{"state":"explicit|implicit|unknown|negative","topic":"","strength":0.0,"evidence":""},"social_preference":{"relationship":"ahead|peer|contrast|complement|unknown","evidence":""},"no_go":[],"open_questions":[],"readiness":0.0}`;
      const result = await callDeepSeek({ model, system, user: `用户：${persona.name}\n对话：\n${transcript(history)}\n输出完整 json。`, json: true, maxTokens: 1200, apiKey: sessionApiKey });
      const profile = JSON.parse(result.content); const usage = await addUsage(String(body.experimentId), result.model, result.usage);
      await db.insert(profiles).values({ id: id("profile"), experimentId: String(body.experimentId), personaId: String(persona.id), variant, profileJson: JSON.stringify(profile), readiness: Math.max(0, Math.min(1, Number(profile.readiness || 0))), evidenceJson: JSON.stringify([...(profile.stable_profile || []), ...(profile.active_state || [])]), createdAt: new Date() });
      return Response.json({ profile, usage: { ...usage, latencyMs: result.latencyMs } });
    }
    if (action === "match") {
      const model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A";
      const system = `你是 Relationship Researcher。评估的单位是 Social Opportunity，不做整段聊天相似度。综合 active state、intent、topic、stage、preference、no_go、mutual value 与适度 surprise。只输出 json。JSON 示例：{"score":0.0,"relationship_type":"peer|ahead|contrast|complement|unexpected","resonance":"","mutual_value":"","risk":"","evidence":[""],"recommend":true}`;
      const result = await callDeepSeek({ model, system, user: `候选A：${JSON.stringify(body.profileA)}\n候选B：${JSON.stringify(body.profileB)}\n输出关系研究 json。`, json: true, maxTokens: 800, apiKey: sessionApiKey });
      const research = JSON.parse(result.content), matchId = id("match"), usage = await addUsage(String(body.experimentId), result.model, result.usage);
      await db.insert(matches).values({ id: matchId, experimentId: String(body.experimentId), personaAId: String(body.personaAId), personaBId: String(body.personaBId), variant, score: Math.max(0, Math.min(1, Number(research.score || 0))), relationType: String(research.relationship_type || "unexpected"), researchJson: JSON.stringify(research), status: research.recommend ? "opportunity" : "filtered", createdAt: new Date() });
      return Response.json({ matchId, research, usage: { ...usage, latencyMs: result.latencyMs } });
    }
    if (action === "outcome") {
      await db.insert(outcomes).values({ id: id("outcome"), experimentId: String(body.experimentId), matchId: String(body.matchId), checkpoint: String(body.checkpoint || "day0"), acceptedA: Boolean(body.acceptedA), acceptedB: Boolean(body.acceptedB), messagesExchanged: Number(body.messagesExchanged || 0), relationshipAlive: Boolean(body.relationshipAlive), note: String(body.note || ""), createdAt: new Date() });
      return Response.json({ saved: true }, { status: 201 });
    }
    if (action === "complete") {
      await db.update(experiments).set({ status: String(body.status || "completed"), completedAt: new Date() }).where(eq(experiments.id, String(body.experimentId)));
      return Response.json({ completed: true });
    }
    return jsonError("Unknown action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.includes("DEEPSEEK_API_KEY_NOT_CONFIGURED")) return jsonError("DeepSeek API Key 尚未配置", 503);
    return jsonError(message, 500);
  }
}

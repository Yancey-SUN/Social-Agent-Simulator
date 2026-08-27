import { env } from "cloudflare:workers";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { experiments, failures, matches, messages, outcomes, profiles } from "../../../db/schema";
import { buildUserSimulationPrompt, NATURAL_GUARDIAN_PROMPT } from "./prompts";

type HistoryItem = { speaker: "user" | "agent"; content: string };
type PersonaSeed = { id: number | string; name: string; age?: number; city?: string; job?: string; archetype?: string; topic?: string; secondary?: string; stage?: string; scenario?: string; preference?: string; baziPrior?: string };
type DeepSeekUsage = { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };

const MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
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
function safeModel(value: unknown) { const model = String(value || "deepseek-v4-flash"); return MODELS.has(model) ? model : "deepseek-v4-flash"; }
function transcript(history: HistoryItem[]) { return history.map((m, i) => `${i + 1}. ${m.speaker === "user" ? "用户" : "守护灵"}：${m.content}`).join("\n"); }
function splitChatBubbles(content: string) {
  const lines = content.replace(/```(?:text)?/gi, "").split(/\n+/).map(line => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, "").replace(/^(?:用户|守护者|小精灵)[:：]\s*/, "")).filter(Boolean);
  return (lines.length ? lines : [content.trim()]).slice(0, 3);
}
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
    const body = await response.json() as { error?: { message?: string }; choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: DeepSeekUsage };
    if (!response.ok) {
      lastError = body.error?.message || `DeepSeek API ${response.status}`;
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) { await new Promise(resolve => setTimeout(resolve, 700 * 2 ** attempt)); continue; }
      throw new Error(lastError);
    }
    const choice = body.choices?.[0];
    const content = choice?.message?.content?.trim() || "";
    if (choice?.finish_reason === "length") {
      lastError = "模型回复因长度限制被截断";
      if (attempt < attempts - 1) continue;
      throw new Error(lastError);
    }
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
      const savedFailures = await db.select().from(failures).where(eq(failures.experimentId, runId));
      return Response.json({ configured, run: run[0] || null, messages: savedMessages, profiles: savedProfiles, matches: savedMatches, outcomes: savedOutcomes, failures: savedFailures });
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
      await db.insert(experiments).values({ id: runId, createdAt: now, status: "running", population: Math.min(300, Math.max(1, Number(body.population || 20))), rounds: Math.min(20, Math.max(1, Number(body.rounds || 4))), concurrency: Math.min(8, Math.max(1, Number(body.concurrency || 3))), modelA: safeModel(body.modelA), modelB: safeModel(body.modelB), promptA: String(body.promptA || "guardian-natural-v3"), promptB: String(body.promptB || "guardian-natural-v3"), configJson: JSON.stringify(body.config || {}) });
      return Response.json({ runId }, { status: 201 });
    }
    if (action === "turn") {
      const persona = body.persona as PersonaSeed, history = (body.history || []) as HistoryItem[];
      const role = body.role === "user" ? "user" : "agent", model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A";
      const system = role === "user"
        ? buildUserSimulationPrompt(persona)
        : (guardianPrompts[String(body.promptVersion)] || guardianPrompts["guardian-natural-v3"]);
      const user = role === "user" ? `这是你和守护者目前的微信聊天记录：\n${transcript(history) || "（还没有聊天记录）"}\n\n现在轮到你发消息。可以发 1–3 个连续微信气泡，每个气泡单独一行。` : `这是你和用户目前的微信聊天记录：\n${transcript(history)}\n\n现在轮到你回复。可以发 1–3 个连续微信气泡，每个气泡单独一行。`;
      const result = await callDeepSeek({ model, system, user, maxTokens: 180, apiKey: sessionApiKey });
      const usage = await addUsage(String(body.experimentId), result.model, result.usage);
      const texts = splitChatBubbles(result.content), baseTurnIndex = Number(body.turnIndex || 0) * 10;
      await db.insert(messages).values(texts.map((content, bubbleIndex) => ({ id: id("msg"), experimentId: String(body.experimentId), personaId: String(persona.id), variant, turnIndex: baseTurnIndex + bubbleIndex, speaker: role, content, model: result.model, promptVersion: String(body.promptVersion || "user-natural-v2"), inputTokens: bubbleIndex === 0 ? usage.input : 0, outputTokens: bubbleIndex === 0 ? usage.output : 0, latencyMs: bubbleIndex === 0 ? result.latencyMs : 0, createdAt: new Date() })));
      return Response.json({ text: texts[0], texts, usage: { ...usage, latencyMs: result.latencyMs }, model: result.model });
    }
    if (action === "profile") {
      const persona = body.persona as PersonaSeed, history = (body.history || []) as HistoryItem[], model = safeModel(body.model), variant = body.variant === "B" ? "B" : "A";
      const system = `你是 Memory Session Compactor 与 Profile Curator。只根据对话证据输出 json，不做命理推断，不把一次性情绪写成稳定人格。Unknown 不等于 Yes。每项保留 evidence、confidence、recency、permission。Readiness 表示“现有证据是否足够支持一次负责任的社交推荐”，不是聊天气氛或消息数量。评分标尺：0–0.29 只有零散闲聊；0.30–0.49 有基础状态但缺少社交意图与偏好；0.50–0.61 有两项左右可追溯维度，可作探索但不可直接推荐；0.62–0.79 至少三个可追溯维度，且包含社交意图或关系偏好之一，可以进入候选研究；0.80–1.0 是丰富、跨话题或长期证据。不得只因用户问 AI 是否有空而判断存在社交意图。JSON 示例：{"episode_summary":"","stable_profile":[{"claim":"","evidence":"","confidence":0.0}],"active_state":[{"claim":"","evidence":"","expires_days":7}],"social_intent":{"state":"explicit|implicit|unknown|negative","topic":"","strength":0.0,"evidence":""},"social_preference":{"relationship":"ahead|peer|contrast|complement|unknown","evidence":""},"no_go":[],"open_questions":[],"readiness":0.0}`;
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
    if (message.includes("DEEPSEEK_API_KEY_NOT_CONFIGURED")) return jsonError("DeepSeek API Key 尚未配置", 503);
    return jsonError(message, 500);
  }
}

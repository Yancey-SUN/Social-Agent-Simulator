# Vouch Lab — Social Agent Simulator

[中文](#中文) · [English](#english)

线上体验 / Live demo: [vouch-social-agent-lab.clean-crane-7316.chatgpt.site](https://vouch-social-agent-lab.clean-crane-7316.chatgpt.site/)

---

## 中文

### 项目简介

Vouch Lab — Social Agent Simulator 是一个社交 Agent 全链路模拟器，用于在产品正式上线前验证以下核心假设：

> 用户与长期陪伴型 Agent 聊得越多，Agent 获得的真实 Context 越丰富，就越有机会在合适的时机识别用户的社交意图，并推荐一个真正值得认识的人。

模拟器不是简单地批量生成一段“看起来像聊天”的剧本。用户模拟器与 Agent 作为两个独立角色逐轮交互，每一轮只看到各自应该知道的内容，由此形成可追踪的对话、Memory、用户画像、Social Intent、匹配判断和匹配后结果。

### 核心流程

1. **建立用户宇宙**：导入或生成具有不同背景、表达习惯、活跃度和社交状态的模拟用户。
2. **逐轮真实对话**：用户模型与陪伴 Agent 交替生成消息，保留完整聊天记录。
3. **理解用户**：从对话中沉淀 Memory、当前状态、稳定偏好和带证据的用户画像。
4. **识别 Social Intent**：判断用户是否有认识新朋友的显性或隐性意图，以及当前是否适合被推荐。
5. **触发匹配**：在满足 Readiness、Social Intent、可发现性和其他约束后生成候选关系。
6. **双边判断与确认**：分别研究双方为什么值得认识，并模拟双方是否愿意接受推荐。
7. **创建四人小群**：匹配成功后建立“用户 A + A 的 Agent + 用户 B + B 的 Agent”群聊。
8. **观察匹配后社交**：两个 Agent 负责冷启动；之后默认保持安静，只有被用户 `@` 时才介入。两个用户继续聊天，并回收继续接触意愿等 Outcome。

### 可以验证什么

- 对话轮数与 Context 完整度是否会影响匹配质量
- Agent 能否区分“正在聊天”与真实的 Social Intent
- Readiness 阈值和社交 Gate 是否合理
- 相似、互补、共同活动或阶段性需求中，哪些匹配理由更有效
- 双方接受推荐的原因与拒绝原因
- 四人群的冷启动方式是否自然
- 匹配后是否愿意继续聊天、交换联系方式或线下见面
- 不同模型、Prompt 和参数组合对完整链路的影响

### 实验能力

- 自定义实验名称、用户样本、对话轮数、并发数和随机种子
- 配置 Readiness 阈值、群聊轮数及是否自动建群
- 使用不同的模型与 Prompt 版本进行 A/B 对比
- 接入 DeepSeek 及其他 OpenAI-compatible 模型 API
- 保存并共享实验历史，查看完整对话、画像、匹配和群聊详情
- 对已有对话与画像补跑匹配，无需重复消耗对话模型调用
- 记录失败阶段与失败原因，支持定位部分完成的实验

### 主要产物

- 用户与 Agent 的原始对话
- Memory、Profile、Social Intent 与 Readiness
- 候选关系、匹配理由与双边判断
- 四人群完整聊天记录
- 匹配后 Outcome 与继续接触意愿
- Token、模型调用和实验运行日志

### 使用边界

- 所有用户均为模拟角色，实验结果不能直接代表真实用户行为。
- Readiness 代表当前信息是否足够支持一次负责任的推荐，不代表用户价值或人格评分。
- Social Intent 应当决定是否进入社交链路，不应被强行“优化”为同意匹配。
- API Key 仅应在当前请求或服务端环境变量中使用，不应提交到 Git 仓库。
- 上线前仍需使用真实用户研究、人工评审、安全测试和长期 Outcome 校准模拟结论。

### 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

构建与测试：

```bash
npm run build
npm test
```

环境变量示例见 `.env.example`。不要把真实 Key 写入仓库。

---

## English

### Overview

Vouch Lab — Social Agent Simulator is an end-to-end simulation environment for validating a social-agent product before launch. It tests a central hypothesis:

> As a companion agent learns more authentic context through ongoing conversations, it can recognize social intent at the right moment and introduce someone genuinely worth meeting.

This is not intended to be a single-model script generator. The simulated user and companion agent act as separate roles and interact turn by turn, producing traceable conversations, memories, profiles, social-intent decisions, matches, group chats, and post-match outcomes.

### Core Flow

1. **Build a user universe** with diverse backgrounds, communication styles, activity levels, and social states.
2. **Run turn-by-turn conversations** between an independent user model and companion-agent model.
3. **Understand the user** by extracting evidence-backed memory, current state, stable preferences, and profile signals.
4. **Detect social intent** and determine whether a recommendation is appropriate now.
5. **Trigger matching** only when readiness, intent, discoverability, and other constraints are satisfied.
6. **Evaluate both sides** and simulate whether each person accepts the introduction.
7. **Create a four-party room** containing User A, A's agent, User B, and B's agent.
8. **Observe post-match interaction**. Agents provide the opening message and otherwise stay quiet unless mentioned; the two users continue the conversation and generate outcome signals.

### What It Helps Validate

- How conversation depth and context coverage affect match quality
- Whether an agent can distinguish casual conversation from actual social intent
- Appropriate readiness thresholds and social gating rules
- Which matching rationales—similarity, complementarity, shared activities, or timely needs—work best
- Why users accept or reject an introduction
- Whether the four-party-room cold start feels natural
- Whether matched users want to keep talking, exchange contact details, or meet offline
- How model, prompt, and parameter variants affect the full pipeline

### Experiment Features

- Configurable experiment name, sample, conversation rounds, concurrency, and seed
- Configurable readiness threshold, group-chat rounds, and automatic room creation
- Model and prompt A/B comparisons
- DeepSeek and other OpenAI-compatible model APIs
- Persistent, shareable experiment history with full conversation and match details
- Matching reruns using existing profiles, without regenerating conversations
- Stage-level failure reporting for partial or failed runs

### Outputs

- Raw user–agent transcripts
- Memory, profile, social intent, and readiness
- Candidate relationships, rationales, and bilateral decisions
- Complete four-party-room transcripts
- Post-match outcomes and willingness to continue
- Token usage, model calls, and run logs

### Scope and Limitations

- All users are synthetic; results must not be treated as observed human behavior.
- Readiness measures whether there is enough context for a responsible recommendation. It is not a score of a person's worth or personality.
- Social intent gates the social flow and must not be optimized into forced consent.
- API keys should only be supplied per request or through server-side environment variables and must never be committed.
- Production decisions still require real-user research, human review, safety testing, and long-term outcome calibration.

### Local Development

Node.js `>=22.13.0` is required.

```bash
npm install
npm run dev
```

Build and test:

```bash
npm run build
npm test
```

See `.env.example` for environment-variable names. Never commit real credentials.

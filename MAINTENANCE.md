# Vouch Social Agent Lab 维护说明

## 1. 环境要求

- Node.js 22.13 或更高版本
- npm
- DeepSeek API Key

首次运行：

```bash
npm install
cp .env.example .env.local
```

推荐使用通用 OpenAI-compatible 配置：

```bash
LLM_PROVIDER=deepseek
LLM_API_KEY=你的Key
```

`LLM_PROVIDER` 可设为 `deepseek`、`openai`、`qwen`、`moonshot` 或
`siliconflow`。旧的 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_BASE_URL` 仍兼容。

不要把 `.env.local`、API Key 或其他密钥提交到 Git 或发给第三方。

## 2. 本地运行与验证

```bash
npm run dev
```

浏览器访问 `http://localhost:3000`。

修改完成后运行：

```bash
npm run build
```

只有构建成功后再发布。

## 3. 常用修改位置

- 主界面和实验执行逻辑：`app/page.tsx`
- 用户模拟 Prompt、守护者 Prompt：`app/api/simulate/prompts.ts`
- DeepSeek 调用、Profile、Matching 和失败记录接口：`app/api/simulate/route.ts`
- 页面样式：`app/globals.css`
- 数据库表结构：`db/schema.ts`
- 数据库迁移：`drizzle/`
- 站点绑定：`.openai/hosting.json`
- 环境变量示例：`.env.example`

## 4. 修改 Prompt

用户 Prompt 在 `buildUserSimulationPrompt` 中；守护者 Prompt 在
`NATURAL_GUARDIAN_PROMPT` 中。

修改 Prompt 后建议：

1. 先用 1–2 人、4 轮做低成本检查。
2. 再用相同实验种子进行 A/B 对比。
3. 检查对话是否完整、是否有重复模板、是否把 AI 当成人类。
4. 检查 Profile 的 evidence 和 readiness 是否能由原对话支持。

## 5. 修改数据库

先修改 `db/schema.ts`，再生成迁移：

```bash
npm run db:generate
```

检查 `drizzle/` 中新生成的 SQL，确认不会误删已有表或数据，然后重新构建和发布。

当前主要表：

- `experiments`：实验配置、状态和成本
- `messages`：逐用户、逐 Variant 的完整消息
- `profiles`：Memory/Profile 和 readiness
- `matches`：关系机会研究
- `outcomes`：Day 0/3/7/30 结果回流
- `failures`：运行失败和部分完成原因

## 6. API Key 与共享安全

- 页面临时输入的 Key 只存在当前页面内存，刷新后清除。
- 生产环境 Key 应作为站点 Secret 配置，不要写进源码。
- 历史实验会共享对话、画像、匹配结果和失败原因，但不会保存 Key。

## 7. Readiness 建议

- 0–49%：证据不足
- 50–61%：探索候选，不直接推荐
- 62–69%：可以进入匹配研究
- 70% 以上：更谨慎的正式推荐门槛

Readiness 不应只由消息数量决定；至少应包含三个可追溯维度，并包含社交意图或关系偏好之一。

## 8. 发布

此项目当前由 OpenAI Sites 托管。通过 Codex 修改时，可以要求它构建并发布现有
Sites 项目。若迁移到其他 Cloudflare Workers/D1 环境，需要重新配置：

- D1 数据库绑定 `DB`
- `DEEPSEEK_API_KEY` Secret
- 可选的 `DEEPSEEK_BASE_URL`
- Drizzle 数据库迁移

生产网址：`https://vouch-social-agent-lab.clean-crane-7316.chatgpt.site/`

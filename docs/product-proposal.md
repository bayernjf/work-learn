# Universal Learning Skill 产品方案

## 1. 产品定义

这是一个被安装到各种 AI Agent 中的个人英语语料学习系统。

用户日常使用 Claude、ChatGPT、Hermes、OpenClaw 以及其他 Agent 工作时，通过 Skill 主动整理当前对话，将真实工作语料转化为可复用、可复习的英语学习材料。

核心定位：

> 把你和任何 AI 的工作过程，沉淀成属于你的英语课程。

第一阶段聚焦英语学习，底层能力可扩展到技术知识、工作决策和个人知识管理。

## 2. 核心判断

Skill 应该是主入口，而不是附属功能。

模型最了解当前对话的上下文、意图和重点，因此适合负责“理解与整理”；产品自己的服务负责“保存、检索、复习和跨 Agent 同步”。

本地桌面端、剪贴板、终端录制等能力作为兼容性兜底，覆盖无法安装 Skill 或无法提供完整上下文的 Agent。

## 3. 产品架构

```text
Claude / ChatGPT / Hermes / OpenClaw / 其他 Agent
                         │
              Universal Learning Skill
                         │
                   MCP / API 层
                         │
                  Hono API on Vercel
                         │
              Supabase Auth / Postgres / RLS / Storage
                          │
          React Web App on Cloudflare Pages
```

### 3.0 首版技术基线

- API：Hono + TypeScript，部署到 Vercel Functions；
- 前端：React + TypeScript，构建为静态资源，部署到 Cloudflare Pages；
- 数据层：Supabase 一整套，统一承担 Auth、Postgres、Row Level Security 和后续 Storage；
- 数据策略：**本地优先**——stdio MCP 与 CLI 默认写本地 SQLite（离线可用、无需 token），云端 Supabase 是同步副本，由 `learn sync` 主动推送；remote MCP 与 Web 保持云端直写（见 [本地优先存储方案](local-first-storage.md)）；
- Skill/MCP：通过 Hono API 访问统一的 Work Learn 能力，不直接耦合数据库；
- CLI 与桌面端：本地优先读写，同步时经 `/api/sync` 幂等推送；
- 部署原则：前端和 API 分离部署，数据权限集中在 Supabase RLS。

首版不引入 Cloudflare Workers API，也不再单独维护另一套数据库或认证系统。

### 3.1 Universal Learning Skill

Skill 安装到不同 Agent 中，负责：

- 读取当前可见的对话上下文；
- 判断哪些内容值得学习；
- 提取自然表达、搭配、词汇和语法问题；
- 生成适合用户技术工作的例句；
- 将结果整理成统一结构；
- 把抽取结果展示给用户后保存；
- 当这段对话里没有值得保存的内容时，说明原因并且不保存。

典型指令：

- “整理刚才这段对话”；
- “提取值得学习的英语表达”；
- “记录我刚才犯的错误”；
- “把这次技术讨论加入我的语料库”；
- “用我最近学过的表达继续练习”。

Skill 不负责直接实现数据库、账号、同步和复习算法，而是调用统一的工具/API。

### 3.2 Learning MCP Server / API

统一提供以下能力（已实现的十三个工具）：

- `create_session`：为当前对话建立会话；
- `save_material`：保存学习材料；
- `save_question_translation`：保存用户原始提问与地道英文译法；
- `search_corpus`：搜索用户语料；
- `get_review_items`：获取待复习内容；
- `mark_mastered`：记录掌握状态；
- `snooze_review`：把复习项延后；
- `generate_practice`：基于一条或最近多条语料生成结构化练习提示；
- `get_user_patterns`：汇总近期高频表达、纠错模式、词汇和练习建议；
- `get_reuse_summary`：汇总主动词汇、沉睡表达、跨场景复用和最近复用事件；
- `record_reuse`：在后续真实对话里记录已保存表达的自然复用。
- `suggest_reuse`：当当前英文已命中某个保存表达时，返回同一意图下最多一个其他表达，用于扩充说法而不是纠错。
- `configure_reuse_nudges`：开启/关闭复用提示，或调整冷却时间和每日上限。

Skill 只需要知道这些能力，不需要耦合具体数据库或前端实现。

### 3.3 Local Companion

本地 Companion 是 macOS 菜单栏应用与 CLI，负责补足 Skill 无法覆盖的场景：

- 全局快捷键保存选中文本或剪贴板内容；
- 捕获没有 Skill 的桌面 Agent；
- 通过 PTY 记录终端 Agent 会话；
- 离线缓存和隐私过滤；
- 将本地内容同步到 Learning Service。

终端可以通过以下方式接入：

```bash
learn run -- hermes
learn run -- openclaw
learn capture
learn review
```

不针对 Hermes、OpenClaw 或某个具体 Agent 编写核心逻辑，而是在 stdin/stdout/PTY 和统一事件层接入。

## 4. 统一数据模型

所有来源最终转换为统一的 Session/Event：

```text
Session
 ├── UserMessage
 ├── AssistantMessage
 ├── ToolCall
 ├── ToolResult
 ├── CodeChange
 └── LearningCapture
```

学习材料建议至少包含：

```json
{
  "source": "claude",
  "session_id": "sess_123",
  "topic": "database migration",
  "original_text": "...",
  "useful_expressions": [],
  "corrections": [],
  "vocabulary": [],
  "practice_prompts": [],
  "tags": ["software-development"]
}
```

来源信息用于追溯和筛选，但学习分析逻辑不应依赖来源名称。

## 5. 用户体验原则

### 主动整理优先

默认不监听和上传用户所有对话。用户通过 Skill 指令明确触发整理，或者通过快捷键保存片段。

### 少量、高价值

一次对话不要生成几十张卡片。默认推荐：

- 3 个最值得掌握的表达；
- 2 个用户反复出现的问题；
- 1 个可以立即复用的句型；
- 一段 2 至 5 分钟的复习练习。

### 学习闭环

```text
真实对话 → 提取语料 → 短练习 → 新对话复用 → 记录掌握情况
```

系统的价值不在于生成笔记，而在于帮助用户在下一次工作中真正使用这些表达。

## 6. MVP 范围

第一版建议只包含：

1. 一个可安装的 Universal Learning Skill；
2. 一个连接 Hono API 的 MCP Server；
3. 一个简单的 Web 语料库；
4. `learn capture` CLI 作为通用兜底；
5. 保存、整理、搜索、每日 5 条复习；
6. 基础隐私过滤：API Key、密码、Token、绝对路径等。

暂不做：

- 全量桌面屏幕监听；
- 复杂的原生移动 App；
- 针对每个 Agent 的深度 UI 插件；
- 完整英语课程体系；
- 复杂社交和排行榜。

## 7. 平台策略

推荐顺序：

1. Hono API + Supabase：建立统一数据和权限基线；
2. Skill + MCP：验证核心价值；
3. React 静态 Web App：承载语料、搜索和复习，部署到 Cloudflare Pages；
4. CLI：覆盖终端和无 Skill Agent；
5. macOS Companion：提供全局快捷键、离线能力和桌面兜底；
6. 移动端：验证复习习惯后再建设。

核心数据和用户关系放在自己的服务中，Skill、CLI、Companion 都只是接入入口，避免绑定某一个 AI 平台。

## 8. 主要风险

- 不同 Agent 对 Skill、MCP 和上下文访问能力不一致；
- Skill 可能只能访问当前上下文，无法读取完整历史；
- 终端录制可能包含密钥、代码和个人隐私；
- AI 会过度纠错，破坏用户表达风格；
- 生成材料过多，反而增加学习负担。

应对原则是：明确触发、最小权限、本地优先、默认脱敏、无料不存、推荐少量高价值内容。

## 9. 成功指标

早期不以“生成了多少学习卡片”为核心指标，而关注：

- 用户每周主动整理的会话数；
- 整理内容的复习完成率；
- 用户在后续对话中复用表达的次数；
- 用户重复错误是否下降；
- 用户是否持续使用不同 Agent 接入。

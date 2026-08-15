# Work Learn

Work Learn 是一个跨 AI Agent 的个人英语语料学习系统。它把用户与 Claude、ChatGPT、Hermes、OpenClaw 以及其他 Agent 的真实工作对话，转化为可复用、可搜索、可复习的英语学习材料。

核心承诺：让用户直接从每天已经发生的 AI 工作对话中，获得属于自己的英语课程，而不是再维护一套脱离工作场景的学习材料。

## 第一版定位

第一版面向使用 AI Agent 进行全栈开发的独立开发者，先提供一条固定的对话整理与复习闭环。英语学习是首个产品场景，底层能力可扩展到技术知识、工作决策和个人 AI 工作资产沉淀。

Skill 负责理解和整理当前对话；MCP/API 负责保存、搜索、复习和跨 Agent 同步；CLI 与本地 Companion 负责终端会话和无 Skill 场景的兼容接入。

```text
Agent 中调用 Skill -> 整理当前对话 -> 用户确认 -> MCP/API 保存 -> Web 查看和复习
```

第一版的完成结果不是“生成更多笔记”，而是：用户能够在后续真实工作对话中复用学过的表达，并看到自己的重复错误逐步减少。

## 文档索引

### 产品定义

- [产品方案](docs/product-proposal.md)：产品定位、用户流程、核心架构和平台策略。
- [品牌标志](docs/brand.md)：`W` 路径标志的概念、颜色和使用规则。
- [Logo 方案](docs/brand-concepts.md)：三个备用的 `W + L` 融合方向。

### 当前实施

- [项目交接](handoff.md)：当前决策、待实现模块和下一步。

## 当前状态

当前仓库处于产品方案和 MVP 定义阶段，不是可用于生产的稳定版本。

当前已完成：

- 明确 Universal Learning Skill 作为跨 Agent 主入口；
- 定义 MCP/API 统一能力层，以及 CLI、本地 Companion 的兼容边界；
- 沉淀 Session/Event 和 LearningMaterial 的初步数据模型；
- 完成 Web 落地页方向和第一版产品叙事；
- 明确主动触发、本地优先、默认脱敏和保存前确认等安全原则。

下一步是实现最小闭环：

- `save_material`、`search_corpus`、`get_review_items`；
- Universal Learning Skill 的指令和输出格式；
- Hono API 和 Supabase 数据层；
- 连接 Hono API 的 MCP Server；
- 基础 Web 语料库和每日复习。

## 设计原则

```text
主动触发 -> 最小权限 -> 本地优先 -> 默认脱敏 -> 保存前确认
```

- Skill 是主入口，不是附属插件；
- 不绑定某一个 AI 平台；
- 默认不全量监听和上传用户对话；
- 推荐少量高价值内容，而不是制造更多笔记。

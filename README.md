# Work Learn

Work Learn 是一个跨 AI Agent 的个人英语语料学习系统。

它把用户与 Claude、ChatGPT、Hermes、OpenClaw 以及其他 Agent 的真实工作对话，转化为可复用、可搜索、可复习的英语学习材料。

## 核心定位

> 把你和任何 AI 的工作过程，沉淀成属于你的英语课程。

Skill 负责理解和整理当前对话；MCP/API 负责保存、搜索、复习和跨平台同步；CLI 与本地 Companion 负责终端会话和无 Skill 场景的兼容接入。

## 当前阶段

项目处于产品方案和 MVP 定义阶段，当前重点是验证以下闭环：

```text
Agent 中调用 Skill
  → 整理当前对话
  → 用户确认
  → MCP/API 保存
  → Web 查看和复习
```

## 文档

- [产品方案](docs/product-proposal.md)：产品定位、架构、数据模型、MVP 和平台策略
- [项目交接](handoff.md)：当前决策、待实现模块和下一步

## 设计原则

- Skill 是主入口，不是附属插件；
- 不绑定某一个 AI 平台；
- 默认主动触发，不默认全量监听和上传；
- 本地优先、最小权限、默认脱敏；
- 推荐少量高价值内容，而不是制造更多笔记。

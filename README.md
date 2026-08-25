# Work Learn

Work Learn 是一个跨 AI Agent 的个人英语语料学习系统。它把用户与 Claude、ChatGPT、Hermes、OpenClaw 以及其他 Agent 的真实工作对话，转化为可复用、可搜索、可复习的英语学习材料。

核心承诺：让用户直接从每天已经发生的 AI 工作对话中，获得属于自己的英语课程，而不是再维护一套脱离工作场景的学习材料。

## 第一版定位

第一版面向使用 AI Agent 进行全栈开发的独立开发者，先提供一条固定的对话整理与复习闭环。英语学习是首个产品场景，底层能力可扩展到技术知识、工作决策和个人 AI 工作资产沉淀。

Skill 负责理解和整理当前对话；MCP/API 负责保存、搜索、复习和跨 Agent 同步；CLI 负责终端会话和无 Skill 场景的兼容接入。本地 Companion 仍在设计中，尚未实现。

```text
Agent 中调用 Skill -> 整理当前对话 -> 展示抽取结果 -> MCP/API 保存 -> Web 查看和复习
```

第一版的完成结果不是“生成更多笔记”，而是：用户能够在后续真实工作对话中复用学过的表达，并看到自己的重复错误逐步减少。

## 文档索引

### 产品定义

- [使用手册](docs/usage.md)：保存、搜索、复习、问题翻译、CLI 和隐私边界。
- [产品方案](docs/product-proposal.md)：产品定位、用户流程、核心架构和平台策略。
- [品牌标志](docs/brand.md)：`W` 路径标志的概念、颜色和使用规则。
- [Logo 方案](docs/brand-concepts.md)：三个备用的 `W + L` 融合方向。

### 技术设计

- [v0.1 技术架构](docs/technical-architecture-v0.1.md)：Vercel API、Cloudflare 静态前端、Supabase 数据层和 monorepo 边界。
- [本地优先存储方案](docs/local-first-storage.md)：本地 SQLite、同步状态和 `learn sync` 的边界。
- [CLI 与 MCP 接入](docs/cli-and-mcp.md)：本地采集、脱敏和 Agent 配置方式。
- [MCP Agent 接入](docs/mcp-agent-setup.md)：Claude Desktop、Codex 等 Agent 的具体接入配置。
- [远程 MCP 方案](docs/remote-mcp.md)：普通用户通过 URL 连接 Agent 的远程 MCP 设计。
- [部署](docs/deployment.md)：GitHub Actions 部署 Vercel API 与 Cloudflare Pages，以及所需 Secrets。

### 当前实施

- [项目交接](handoff.md)：当前决策、待实现模块和下一步。

## 当前状态

最小闭环已经跑通并上线：API 在 Vercel（`https://work-learn-api.vercel.app`），Web 在 Cloudflare Pages（`https://work-learn.pages.dev`），数据在 Supabase。

已经可用的部分：

- 六个 MCP 工具：`create_session`、`save_material`、`save_question_translation`、`search_corpus`、`get_review_items`、`mark_mastered`；
- 本地优先：CLI 与 stdio MCP 默认读写本地 SQLite（`~/.work-learn/work-learn.db`），不需要 token 也不需要起 API；只有配置了 token 才转而调用线上 API；
- 两种 MCP 形态共用同一套工具实现：本地 stdio（`packages/mcp-server`）与远程 HTTP（`POST /api/mcp`，无状态 Streamable HTTP）；
- 三种认证方式：Supabase JWT、Personal Access Token（服务端只存哈希，可选有效期，可撤销，可设只读 / 可读可写 scope）、MCP OAuth 2.1（动态注册、PKCE、access token 为 opaque 随机串按哈希查库、refresh token 轮换、Web consent 页）；
- `npx @work-learn/setup` 一键安装：探测 Codex / Claude Code / Claude Desktop / CodeBuddy / Cursor / OpenCode，写入前备份配置，可顺带安装 Skill；支持 `--token-file` 让 token 不出现在命令行和对话里；
- Universal Learning Skill（`skills/work-learn/SKILL.md`）和 `scripts/install-skill.sh`；
- Web 端语料库、每日复习、PAT 管理和 Agent 接入引导；
- `learn` CLI 五个命令：`capture`（stdin / 剪贴板采集，本地先脱敏）、`review`、`search`、`sync`（推送本地未同步数据到云端）、`export`（按天导出 markdown）。

下一步：

- 实测各 Agent 客户端的远程 MCP OAuth 兼容性（清单见 `handoff.md`「OAuth 兼容性排查结论与实测清单」）。

测试：`pnpm test` 全绿（`apps/api`：PAT/OAuth/鉴权与 scope 解析 22 例；`packages/mcp-server`：工具与 scope 守卫 15 例；`packages/shared-schema` 11 例；`packages/setup` 5 例；`packages/local-store` 5 例）。

## 设计原则

```text
主动触发 -> 最小权限 -> 本地优先 -> 默认脱敏 -> 无料不存
```

- Skill 是主入口，不是附属插件；
- 不绑定某一个 AI 平台；
- 默认不全量监听和上传用户对话；
- 推荐少量高价值内容，而不是制造更多笔记。

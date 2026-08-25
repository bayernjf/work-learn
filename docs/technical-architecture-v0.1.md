# Work Learn v0.1 技术架构

## 1. 部署边界

```text
React/Vite Web App -> Cloudflare Pages
Hono API           -> Vercel Functions
Auth/Database      -> Supabase Auth + Postgres + RLS + Storage
Local store        -> SQLite (~/.work-learn/work-learn.db)
AI Agent           -> Skill / MCP / CLI
```

前端和 API 分离部署。前端只访问公开 API，用户数据权限由 Supabase RLS 负责，服务端的 service role key 只存在于 Vercel 环境变量中。

数据策略为**本地优先**：stdio MCP 与 CLI 默认写入本地 SQLite（离线可用、无需 token），云端 Supabase 是「个人账号的同步副本」，由 `learn sync` 主动推送；remote MCP 与 Web 保持云端直写。详见 [本地优先存储方案](local-first-storage.md)。

## 2. Monorepo 结构

```text
apps/web          React + Vite 静态前端
apps/api          Hono API，本地 Node 适配器 + Vercel 入口
apps/cli          learn 命令行入口
packages/shared-schema   Zod 输入输出协议
packages/learning-core   学习材料领域逻辑
packages/learning-skill  Universal Learning Skill 指令
packages/mcp-server      Agent 工具目录和 MCP 适配边界
packages/local-store     本地 SQLite 存储（真相源），本地优先的核心
packages/setup           npx 一键安装器，写入各 Agent 的 MCP 配置
```

## 3. 首版 API 边界

全部挂在 `/api` 下：

- `GET /api/health`
- `GET /api/config`：浏览器端公开 Supabase 配置（URL + anon key）
- `POST /api/sessions`
- `GET /api/materials?q=`
- `POST /api/materials`
- `GET /api/reviews`
- `POST /api/reviews/:id/complete`
- `POST /api/mcp`：远程 MCP HTTP 端点，供普通用户通过 URL 连接 Agent
- `GET|POST /api/tokens`、`POST /api/tokens/:id/revoke`、`DELETE /api/tokens/:id`：Personal Access Token 管理
- `/api/oauth/*`：MCP OAuth 2.1 授权服务器（元数据、动态注册、authorize、decision、token）
- `POST /api/sync`：接收 `learn sync` 推送的本地数据，幂等 upsert 到用户云端表
- 所有请求和响应通过 `@work-learn/shared-schema` 校验。

MCP Server 提供两种形态：本地 stdio 与远程 HTTP（挂载在 `/api/mcp`，普通用户通过 URL + 授权连接 Agent）。**stdio 默认走本地优先**——未设置 token 时直接读写本地 SQLite，设置了 `WORK_LEARN_ACCESS_TOKEN`（或 `WORK_LEARN_ACCESS_TOKEN_FILE`）才回退为调用线上 API。两种形态复用同一套工具逻辑，已实现 `create_session`、`save_material`、`save_question_translation`、`search_corpus`、`get_review_items`、`mark_mastered`、`generate_practice` 和 `get_user_patterns` 八个工具。详见 [远程 MCP 方案](remote-mcp.md)。

## 4. 本地开发

```bash
pnpm install
pnpm dev:api
pnpm dev:web
```

API 默认运行在 `http://localhost:3000`，Web 默认运行在 `http://localhost:5173`。

## 5. 明确不做

- 不使用 Cloudflare Workers 作为 API；
- 不引入第二套数据库或认证系统；
- 不让 Skill 直接读写 Supabase；
- 不在桌面端重复实现语料库和复习逻辑。

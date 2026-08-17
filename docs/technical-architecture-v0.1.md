# Work Learn v0.1 技术架构

## 1. 部署边界

```text
React/Vite Web App -> Cloudflare Pages
Hono API           -> Vercel Functions
Auth/Database      -> Supabase Auth + Postgres + RLS + Storage
AI Agent           -> Skill / MCP / CLI
```

前端和 API 分离部署。前端只访问公开 API，用户数据权限由 Supabase RLS 负责，服务端的 service role key 只存在于 Vercel 环境变量中。

## 2. Monorepo 结构

```text
apps/web          React + Vite 静态前端
apps/api          Hono API，本地 Node 适配器 + Vercel 入口
apps/cli          learn 命令行入口
packages/shared-schema   Zod 输入输出协议
packages/learning-core   学习材料领域逻辑
packages/learning-skill  Universal Learning Skill 指令
packages/mcp-server      Agent 工具目录和 MCP 适配边界
```

## 3. 首版 API 边界

- `GET /api/health`
- `POST /api/sessions`
- `GET /api/materials?q=`
- `POST /api/materials`
- `GET /api/reviews`
- `POST /api/reviews/:id/complete`
- 所有请求和响应通过 `@work-learn/shared-schema` 校验。

MCP Server 通过 `WORK_LEARN_API_URL` 和 `WORK_LEARN_ACCESS_TOKEN` 调用上述 API，当前已实现 `create_session`、`save_material`、`search_corpus`、`get_review_items` 和 `mark_mastered` 五个工具。

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

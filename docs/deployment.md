# 部署

基于 GitHub Actions，push 到 `main` 时自动部署。

## 架构

- API：Hono serverless 函数（esbuild 打包为自包含函数）→ Vercel
- Web：Vite 静态构建 → Cloudflare Pages
- 数据：Supabase Auth + Postgres + RLS

## API（Vercel）

- Vercel 项目：`work-learn-api`（org `bayernjfs-projects`）
- 生产域名：`https://work-learn-api.vercel.app`，health：`/api/health`
- 由于 API 依赖 monorepo 内的 workspace 包，直接从 `apps/api` 部署会遇到 pnpm workspace 解析问题，
  因此用 esbuild 把函数打包成自包含文件 `api/[[...route]].js`（见 `apps/api/scripts/bundle-function.mjs`），
  再从**仓库根**部署。
- 根 `vercel.json` 用显式 `builds` 配置，只声明 `api/[[...route]].js` 为 `@vercel/node` 函数，
  避免根 `package.json` 被 Vercel 误判为静态站点；同时用 `routes` 把 `/api/(.*)` 显式转发到该函数。
- 构建命令：`pnpm --filter @work-learn/api build:function`（生成打包函数后再部署）。
- `api/[[...route]].js` 已加入 `.gitignore`，由构建阶段生成。
- Supabase 环境变量（`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`）配置在
  Vercel 项目环境变量（production / preview / development），不放入 workflow。
- Remote MCP OAuth 还需要：
  - `WORK_LEARN_PUBLIC_API_URL`：生产 API origin，例如 `https://work-learn-api.vercel.app`
  - `WORK_LEARN_WEB_URL`：生产 Web origin，例如 `https://work-learn.pages.dev`
  - `OAUTH_JWT_SECRET`：OAuth access token 的 HMAC 密钥，可用 `openssl rand -base64 48` 生成

## Web（Cloudflare Pages）

- Pages 项目：`work-learn`
- 构建命令：`pnpm --filter @work-learn/web build`，输出目录 `apps/web/dist`
- 生产域名：`https://work-learn.pages.dev`（push 到 `main` 后生效）
- Web 启动时会请求 API 的 `GET /api/config` 获取浏览器端公开 Supabase 配置（URL + anon key），
  因此不会因为漏配 `VITE_SUPABASE_*` 构建变量而显示 “Supabase is not configured yet”。
- Cloudflare Pages 部署包含 `apps/web/public/_worker.js`，会把同源 `/api/*` 代理到
  `https://work-learn-api.vercel.app`。浏览器只访问 `work-learn.pages.dev`，不直连 `vercel.app`，
  可避免部分网络环境下 Vercel 域名不可达导致登录页白屏。
- `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 仍可作为本地/CI 构建覆盖项，但生产主要依赖 API
  返回的公开配置；`SUPABASE_URL`、`SUPABASE_ANON_KEY` 必须在 Vercel 配置正确。

## Workflows

- `.github/workflows/ci.yml`：push/PR 时跑全仓 `typecheck` 与 `build`
- `.github/workflows/deploy-api.yml`：push 到 `main` 时部署 API 到 Vercel（从仓库根）
  - 必须先跑 `pnpm --filter @work-learn/api build:function`：`vercel.json` 里存在 `builds`，
    Vercel 会忽略项目设置里的 buildCommand，而 `api/[[...route]].js` 是 gitignore 的构建产物。
    漏掉这一步时 `vercel build` 只会打一行 warning，仍然部署成功，但 `/api/*` 全部 404。
  - 部署后用 `/api/health` 和 `/api/config` 做 smoke test，空函数会让 workflow 直接失败。
- `.github/workflows/deploy-web.yml`：push 到 `main` / `dev` 时部署 Web 到 Cloudflare Pages
  （`main` 为生产 `work-learn.pages.dev`，`dev` 为预览 `dev.work-learn.pages.dev`）

## 需要的 GitHub Secrets

### Vercel（`deploy-api.yml`）

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`（`team_0EaIhqEnnWPbsb34TVj26WeI`）
- `VERCEL_PROJECT_ID`（`prj_hI5SFzc4nWJA2er7MzYOM1PjriSC`）

### Cloudflare Pages（`deploy-web.yml`）

- `CLOUDFLARE_API_TOKEN`（已配置，具备 Cloudflare Pages 的 `Pages:Edit` 权限）
- `CLOUDFLARE_ACCOUNT_ID`（`23afa7f0233653f87dc9ceafd02eb79a`）
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_WORK_LEARN_API_URL`
- 这些 Web 构建变量用于 CI 构建覆盖；其中 `VITE_WORK_LEARN_API_URL` 应指向生产 API
  （`https://work-learn-api.vercel.app`），OAuth consent 页会调用 `/api/oauth/decision`。

## 部署触发

本地 `vercel deploy --prod` 与 `wrangler pages deploy` 可直接上线；GitHub Actions 在 push 到
`main` 时自动执行。未 push 前不会触发 workflow。

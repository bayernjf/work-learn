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
  避免根 `package.json` 被 Vercel 误判为静态站点。
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

## Workflows

- `.github/workflows/ci.yml`：push/PR 时跑全仓 `typecheck` 与 `build`
- `.github/workflows/deploy-api.yml`：push 到 `main` 时部署 API 到 Vercel（从仓库根）
- `.github/workflows/deploy-web.yml`：push 到 `main` 时部署 Web 到 Cloudflare Pages

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
- `VITE_WORK_LEARN_API_URL` 应指向生产 API（`https://work-learn-api.vercel.app`），OAuth consent 页会调用 `/api/oauth/decision`。

## 部署触发

本地 `vercel deploy --prod` 与 `wrangler pages deploy` 可直接上线；GitHub Actions 在 push 到
`main` 时自动执行。未 push 前不会触发 workflow。

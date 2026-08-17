# 部署

基于 GitHub Actions，push 到 `main` 时自动部署。

## 架构

- API：Hono serverless 函数 → Vercel
- Web：Vite 静态构建 → Cloudflare Pages
- 数据：Supabase Auth + Postgres + RLS

## Workflows

- `.github/workflows/ci.yml`：push/PR 时跑全仓 `typecheck` 与 `build`
- `.github/workflows/deploy-api.yml`：push 到 `main` 时部署 API 到 Vercel
- `.github/workflows/deploy-web.yml`：push 到 `main` 时部署 Web 到 Cloudflare Pages

## 需要的 GitHub Secrets

### Vercel（`deploy-api.yml`）

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

三个值来自 `vercel link` 的 `.vercel/project.json`，Vercel 项目根目录设为 `apps/api`。API 的 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 在 Vercel 项目环境变量里配置，不放入 workflow。

### Cloudflare Pages（`deploy-web.yml`）

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_WORK_LEARN_API_URL`

Pages 项目名固定为 `work-learn-web`，构建目录为 `apps/web/dist`。

## 已知注意点

- `apps/api` 的 `api/[[...route]].ts` 是 Vercel serverless 入口，Hono 自带 `hono/vercel` 适配器，无需新增依赖。
- `@work-learn/shared-schema` 等 workspace 包以 TS 源码发布，Vercel 函数打包时需能解析这些依赖；首次部署若失败，需把共享包先构建成 JS 或调整 `exports` 指向构建产物。
- Vercel 项目根目录必须设为 `apps/api`（Web 的 Cloudflare Pages 根目录为 `apps/web`）。

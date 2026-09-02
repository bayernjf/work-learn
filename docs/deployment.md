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
  - `WORK_LEARN_PUBLIC_API_URL`：**可选**回退值。API 的 `resolvePublicOrigin()` 优先级为
    `x-work-learn-entry-host`（由 Pages worker 注入，见下）→ 此 env → 请求 URL origin。
    经 pages.dev 代理访问时，worker 注入的自定义 header 优先，因此无需配置此 env；直连
    Vercel origin 时回退到请求 origin（即 vercel.app）。两个入口各自自洽，RFC 8414 issuer
    匹配在两边都成立。生产验证：`node scripts/check-public-entry.mjs` → 12/12 全过。
  - `WORK_LEARN_WEB_URL`：生产 Web origin，例如 `https://work-learn.pages.dev`

## Web（Cloudflare Pages）

- Pages 项目：`work-learn`
- 构建命令：`pnpm --filter @work-learn/web build`，输出目录 `apps/web/dist`
- 生产域名：`https://work-learn.pages.dev`（push 到 `main` 后生效）
- Web 启动时会请求 API 的 `GET /api/config` 获取浏览器端公开 Supabase 配置（URL + anon key），
  因此不会因为漏配 `VITE_SUPABASE_*` 构建变量而显示 “Supabase is not configured yet”。
- Cloudflare Pages 部署包含 `apps/web/public/_worker.js`，会把同源 `/api/*` 代理到
  `https://work-learn-api.vercel.app`。浏览器只访问 `work-learn.pages.dev`，不直连 `vercel.app`，
  可避免部分网络环境下 Vercel 域名不可达导致登录页白屏。
- `_worker.js` 代理时会删除 `host` header 并注入自定义 header `x-work-learn-entry-host` 和
  `x-work-learn-entry-proto`（无条件覆盖客户端传入值，只信任 CF worker）。API 的 `resolvePublicOrigin()`
  优先读这两个 header 推导公开 origin。**为什么不用标准 `x-forwarded-host`**：Vercel 边缘网络会用
  Vercel origin 覆盖它（生产调试确认），自定义 header 不会被覆盖。
- `_worker.js` 的代理目标读取 Pages 运行时环境变量 `API_ORIGIN`（`env.API_ORIGIN`），未配置时
  回退到内置默认值 `https://work-learn-api.vercel.app`。**已配置**：2026-08-31 经
  `wrangler pages secret put API_ORIGIN` 写入 production（value encrypted），`/api/health` 代理 200。

### 网络可达性结论（2026-08-31 实测）

- `*.vercel.app` 泛域名在当前网络（中国大陆）被阻断：DNS 正常、TCP 层不可达，连不存在的随机
  `vercel.app` 域名同样超时——是域名级阻断，与部署本身无关。
- **产品不受影响**：Web 页面在 Cloudflare（可达），`/api/*` 由 Pages worker 代理到 Vercel
  （Cloudflare 边缘到 Vercel 通），数据直连 Supabase（可达）。
- **受影响面已消除**（2026-09-02）：
  - `setup` 与 `learn` CLI 的默认 API URL 已由 `https://work-learn-api.vercel.app` 改为
    `https://work-learn.pages.dev`（CF 代理入口，实测 `/api/mcp` 鉴权正常），国内用户不需要再手动指定入口。
  - OAuth issuer 自洽（方案 B）：`_worker.js` 注入 `x-work-learn-entry-host`，API `resolvePublicOrigin()`
    优先读它，经 pages.dev 访问时 issuer/metadata/apiUrl 全部为 pages.dev，直连 vercel.app 时全部为
    vercel.app。RFC 8414 issuer 匹配在两个入口都成立，生产 `check-public-entry.mjs` 12/12 全过。
  - 需要覆盖时仍可用：
    ```bash
    learn sync --api-url https://work-learn-api.vercel.app   # 海外直连后端
    # 或环境变量
    export WORK_LEARN_API_URL=https://work-learn.pages.dev
    ```
  `_worker.js` 的代理目标 `API_ORIGIN` 仍必须是 Vercel origin，不随本次改动变化。
- 对外文档/教程的远程 MCP 地址统一推荐 `https://work-learn.pages.dev/api/mcp`。
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
- Web 构建**不需要**任何 `VITE_*` 变量：浏览器只走同源 `/api/*`，由 `_worker.js` 代理到
  Vercel，Supabase 配置在运行时从 `/api/config` 取。曾经注入的 `VITE_WORK_LEARN_API_URL`
  会被内联进产物并把线上请求指向 `localhost`，已删除，不要再加回来。
- API 的浏览器端配置（Supabase URL / anon key / `apiUrl`）统一由 `GET /api/config` 返回：
  `apiUrl` 取 `WORK_LEARN_PUBLIC_API_URL`，未配置时回退到请求 origin。Web 端
  `AgentConnect` 的 API 地址即来自该字段，不再硬编码。

## 部署触发

本地 `vercel deploy --prod` 与 `wrangler pages deploy` 可直接上线；GitHub Actions 在 push 到
`main` 时自动执行。未 push 前不会触发 workflow。

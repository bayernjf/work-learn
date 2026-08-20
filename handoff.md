# Handoff

## 当前产品结论

本项目定位为一个跨 AI Agent 的个人英语语料学习系统。核心入口是安装到 Claude、ChatGPT、Hermes、OpenClaw 等 Agent 中的 Universal Learning Skill。

Skill 负责理解和整理当前对话；MCP/API 负责保存、搜索、复习和跨平台同步；CLI 与 macOS Companion 负责无 Skill 场景、终端会话和本地兜底采集。

详细方案见：[docs/product-proposal.md](/Users/jiangfeng/000mycodes/work-learn/docs/product-proposal.md)

## 技术基线

- API：Hono + TypeScript，部署到 Vercel Functions；
- 前端：React + TypeScript 静态构建，部署到 Cloudflare Pages；
- 数据层：Supabase Auth、Postgres、RLS，后续按需使用 Storage；
- Skill/MCP、CLI 和桌面端统一通过 API 访问数据；
- 不使用 Cloudflare Workers 作为 API，不引入第二套数据库或认证系统。

脚手架已建立在 `apps/` 和 `packages/` 下，详细边界见 [v0.1 技术架构](docs/technical-architecture-v0.1.md)。

## 推荐的第一步

先实现最小闭环：

```text
Agent 中调用 Skill
  → 整理当前对话
  → 用户确认
  → MCP/API 保存
  → Web 查看和复习
```

第一版只需要支持保存、搜索和每日复习，不需要先做桌面监听或移动 App。

## 待实现模块

- [x] 定义 Session/Event 和 LearningMaterial 数据结构
- [x] 建立 Supabase schema、migration 和 RLS
- [x] 实现 Hono API 的 Supabase 鉴权与 materials 读写接口
- [x] 保存学习材料时自动创建待复习项
- [x] 实现 reviews 查询和完成状态更新接口
- [x] 实现 Web Supabase Auth 注册、登录、退出和 session 恢复
- [x] 实现 `create_session`、`save_material`、`search_corpus` 的 MCP 工具调用
- [x] 实现 MCP `get_review_items` 和 `mark_mastered`
- [x] 编写 Universal Learning Skill 指令和输出格式
- [x] 实现连接 Hono API 的 MCP Server
- [x] 创建基础 Web 语料库页面和登录入口
- [x] 实现 `learn capture` CLI 的 stdin 和剪贴板采集
- [x] 增加 API Key、Token、密码和绝对路径脱敏
- [x] 用真实 Supabase 测试账号验证 Auth、RLS、materials 保存、复习生成与完成、搜索闭环
- [x] API 部署到 Vercel（`work-learn-api`，health 返回 200）
- [x] Web 部署到 Cloudflare Pages（`work-learn-web`，dev 预览已上线）
- [x] 配置 GitHub Actions 部署 workflow，并写入 Vercel / Supabase / Cloudflare 账号 Secrets
- [x] 配置 `CLOUDFLARE_API_TOKEN`（Pages:Edit 权限）并写入 Secret
- [x] push 到 `main` 后 GitHub Actions 自动部署到生产（Vercel API + Cloudflare Pages 均已上线）
- [ ] 在 Claude Desktop / Codex / Hermes 等 Agent 中配置 `WORK_LEARN_ACCESS_TOKEN` 并完成一次 MCP 客户端调用

## 接入分发待办

- [x] 产出独立 `SKILL.md`（`skills/work-learn/SKILL.md`），并提供 `scripts/install-skill.sh` 一键安装到所有检测到的 Agent skills 目录
- [x] 落地页 `#get-started` 改为实质性接入引导：三步说明 + 可复制 MCP 配置 + SKILL.md/文档链接
- [x] Web 端登录后提供 access token 折叠面板与一键复制（`Connect an agent`）
- [x] 提供 `npx` 一键安装脚本（`npx @work-learn/setup`），自动探测并写入 Codex/Claude/CodeBuddy/Cursor/OpenCode 的 MCP 配置，写入前备份，可选顺带安装 Skill；发布到 npm 后即可直接用（`packages/setup`，见 `docs/mcp-agent-setup.md`）
  - [x] 发布 `@work-learn/setup@0.1.0` 到 npm（公开包，页面：https://www.npmjs.com/package/@work-learn/setup ）；`npx -y @work-learn/setup`、`pnpm dlx @work-learn/setup` 均可直接运行
- [x] 实现远程 MCP 第一版（`POST /api/mcp`，无状态 Streamable HTTP + Bearer token），复用 `registerTools`，普通用户通过 URL + access token 连接 Agent；已用 initialize/tools/list/create_session 端到端验证（`packages/mcp-server/src/{tools,direct,http}.ts`、`apps/api/src/routes/mcp.ts`）
  - [x] Web 端生成/撤销长期 Personal Access Token（服务端只存哈希），替代短期 Supabase access token
  - [x] 第二版补 MCP OAuth 2.1 授权端点、Web consent、PKCE、refresh token rotation；待用户执行 007 SQL、配置 Vercel env 后实测各 Agent 远程 MCP 兼容性

## 当前关键决策

- Skill 是主入口，不是附属插件；
- MCP/API 是统一能力层；
- 本地采集只做兼容性兜底；
- 不为每个 Agent 建立独立的核心业务逻辑；
- 英语学习是第一场景，底层可扩展为个人 AI 工作资产沉淀系统；
- 默认主动触发，不默认全量监听和上传。

## 部署结论

- API 用 esbuild 打包为自包含 serverless 函数，从仓库根部署到 Vercel，规避 pnpm workspace 解析问题；
- 根 `vercel.json` 用显式 `builds` 配置，避免根 `package.json` 被误判为静态站点；
- 部署细节见 [docs/deployment.md](docs/deployment.md)。

## 需要后续确认的问题

- 首版是否只支持 macOS；
- 使用本地模型还是云端模型做语料分析；
- 数据是否默认本地优先、云端可选同步；
- 首个重点 Agent 是 Claude Desktop、终端 Agent，还是两者同时支持；
- 复习机制先采用简单队列，还是直接引入间隔重复算法。

CLI 与 MCP 接入说明见：[docs/cli-and-mcp.md](docs/cli-and-mcp.md)

Agent 接入配置见：[docs/mcp-agent-setup.md](docs/mcp-agent-setup.md)（需在对应 App 内实际配置并验证）。

远程 MCP 方案见：[docs/remote-mcp.md](docs/remote-mcp.md)（普通用户通过 URL 连接 Agent，规划中）。

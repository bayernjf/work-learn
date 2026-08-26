# Handoff

## 当前产品结论

本项目定位为一个跨 AI Agent 的个人英语语料学习系统。核心入口是安装到 Claude、ChatGPT、Hermes、OpenClaw 等 Agent 中的 Universal Learning Skill。

Skill 负责理解和整理当前对话；MCP/API 负责保存、搜索、复习和跨平台同步；CLI 与 macOS Companion 负责无 Skill 场景、终端会话和本地兜底采集。

详细方案见：[docs/product-proposal.md](docs/product-proposal.md)

## 技术基线

- API：Hono + TypeScript，部署到 Vercel Functions；
- 前端：React + TypeScript 静态构建，部署到 Cloudflare Pages；
- 数据层：Supabase Auth、Postgres、RLS，后续按需使用 Storage；
- Skill/MCP、CLI 和桌面端统一通过 API 访问数据；
- 不使用 Cloudflare Workers 作为 API，不引入第二套数据库或认证系统。

脚手架已建立在 `apps/` 和 `packages/` 下，详细边界见 [v0.1 技术架构](docs/technical-architecture-v0.1.md)。

## 最小闭环

```text
Agent 中调用 Skill
  → 整理当前对话
  → 用户确认
  → MCP/API 保存
  → Web 查看和复习
```

这条闭环已经实现并上线，第一版不做桌面监听和移动 App。

## 待实现模块

- [x] 定义 Session/Event 和 LearningMaterial 数据结构
- [x] 建立 Supabase schema、migration 和 RLS
- [x] 增加 `012_sync_timestamps.sql` 和 `013_sync_tombstones.sql`，支持本地 ↔ 云端双向增量同步、复习状态同步与删除传播（待用户执行 migration）
- [x] 实现 Hono API 的 Supabase 鉴权与 materials 读写接口
- [x] 保存学习材料时自动创建待复习项
- [x] 实现 reviews 查询和完成状态更新接口
- [x] 实现 Web Supabase Auth 注册、登录、退出和 session 恢复
- [x] 实现 `create_session`、`save_material`、`search_corpus` 的 MCP 工具调用
- [x] 实现 MCP `get_review_items` 和 `mark_mastered`
- [x] 实现 MCP `generate_practice` 和 `get_user_patterns`
- [x] 编写 Universal Learning Skill 指令、输出格式和跨 Agent 抽取契约
- [x] 实现连接 Hono API 的 MCP Server
- [x] 创建基础 Web 语料库页面和登录入口
- [x] 实现 `learn capture` CLI 的 stdin 和剪贴板采集
- [x] Web 端和 `learn delete` 支持删除材料/提问，删除经 tombstone 跨设备传播
- [x] 增加 API Key、Token、密码和绝对路径脱敏
- [x] 用真实 Supabase 测试账号验证 Auth、RLS、materials 保存、复习生成与完成、搜索闭环
- [x] API 部署到 Vercel（`work-learn-api`，health 返回 200）
- [x] Web 部署到 Cloudflare Pages（`work-learn`，dev 预览已上线）
- [x] 配置 GitHub Actions 部署 workflow，并写入 Vercel / Supabase / Cloudflare 账号 Secrets
- [x] 配置 `CLOUDFLARE_API_TOKEN`（Pages:Edit 权限）并写入 Secret
- [x] push 到 `main` 后 GitHub Actions 自动部署到生产（Vercel API + Cloudflare Pages 均已上线）
- [x] Cloudflare Pages 项目改名为 `work-learn`，生产默认域名为 `https://work-learn.pages.dev`
- [x] Web 改为运行时从 `/api/config` 拉取公开 Supabase 配置，修复 Pages 漏配 `VITE_SUPABASE_*` 导致的白屏
- [x] Pages 同源代理 `/api/*` 到 Vercel；`vercel.json` 补 `/api/*` routes，修复生产 API 平台级 404
- [x] 增加同步可观测性：Web 端“Connect an agent”面板展示云端同步计数和最近保存时间；CLI 增加 `learn doctor`；`learn sync` 输出本地库统计
- [x] Skill 抽取质量统一：8 点自检清单 + 正反例，不同宿主 Agent 按同一标准判断什么值得存
- [x] Web 练习入口：语料卡片"练习"按钮调用 /api/practice；首页"你的学习模式"面板调用 /api/patterns
- [x] 复习卡片改为先回忆再展开：默认只显示原文，点"显示答案"后展开 better/why/reuse/词汇和练习按钮
- [ ] 在 Claude Desktop / Codex / Hermes 等 Agent 中配置 `WORK_LEARN_ACCESS_TOKEN` 并完成一次 MCP 客户端调用
- [x] 云端提问翻译按规范化问题去重，新增 `014_question_norm_dedupe.sql`（待执行）
- [x] 复习项支持 snooze 到明天，Web/API/MCP/本地队列均支持
- [x] Web 端支持编辑语料的 topic、explanation、tags 等字段
- [x] `learn practice` 可从本地库生成练习
- [x] `generate_practice` 将已保存的提问翻译纳入练习
- [x] 语料库支持按 source/tag 筛选，CLI `learn search` 支持 `--source`/`--tag`
- [x] Web 端支持导出当前视图为 Markdown

## 接入分发待办

- [x] 产出独立 `SKILL.md`（`skills/work-learn/SKILL.md`），并提供 `scripts/install-skill.sh` 一键安装到所有检测到的 Agent skills 目录
- [x] 落地页 `#get-started` 改为实质性接入引导：三步说明 + 可复制 MCP 配置 + SKILL.md/文档链接
- [x] Web 端登录后提供 access token 折叠面板与一键复制（`Connect an agent`）
- [x] 提供 `npx` 一键安装脚本（`npx @work-learn/setup`），自动探测并写入 Codex/Claude/CodeBuddy/Cursor/OpenCode 的 MCP 配置，写入前备份，可选顺带安装 Skill；发布到 npm 后即可直接用（`packages/setup`，见 `docs/mcp-agent-setup.md`）
  - [x] 发布 `@work-learn/setup@0.1.0` 到 npm（公开包，页面：https://www.npmjs.com/package/@work-learn/setup ）；`npx -y @work-learn/setup`、`pnpm dlx @work-learn/setup` 均可直接运行
- [x] 实现远程 MCP 第一版（`POST /api/mcp`，无状态 Streamable HTTP + Bearer token），复用 `registerTools`，普通用户通过 URL + access token 连接 Agent；已用 initialize/tools/list/create_session 端到端验证（`packages/mcp-server/src/{tools,direct,http}.ts`、`apps/api/src/routes/mcp.ts`）
  - [x] Web 端生成/撤销长期 Personal Access Token（服务端只存哈希），替代短期 Supabase access token
  - [x] 第二版补 MCP OAuth 2.1 授权端点、Web consent、PKCE、refresh token rotation
  - [x] 用户已执行 `006_personal_access_tokens.sql`、`007_oauth.sql`、`011_pat_scopes.sql`；Vercel production 已配置 `WORK_LEARN_PUBLIC_API_URL`、`WORK_LEARN_WEB_URL`（`OAUTH_JWT_SECRET` 已不再使用，可从 Vercel 删掉）
  - [x] OAuth 代码层面排查完成（见下方「OAuth 兼容性排查结论与实测清单」），并修复一处缺口：`authenticate` 现在会把 OAuth token 的 `scope` 解析后传下去（`scope=read` 的 OAuth token 同样禁止写操作），与 PAT scope 行为一致
  - [ ] 实测各 Agent 远程 MCP OAuth 兼容性（清单见下）
  - [x] 给 Personal Access Token 加 scope（`011_pat_scopes.sql`）：`read`（搜索/列表）与 `write`（保存/同步/完成复习），`write` 隐含 `read`，空 scopes 视为全量向后兼容；Web 端创建时可选「只读 / 可读可写」，只读 token 的写操作返回 403；migration 已在生产执行

### OAuth 兼容性排查结论与实测清单

**代码层面已确认符合规范的点**
- `issuer` 从请求 URL 推导，与 protected-resource metadata 的 `authorization_servers[0]` 完全一致，严格客户端不会因 issuer 不匹配而拒绝；
- PKCE S256 强制，`code_challenge_methods_supported: ["S256"]`；
- 动态注册强制 public client（`token_endpoint_auth_method: "none"`），注册响应与 metadata 一致；
- token 端点同时支持 `application/json` 与表单编码 body，支持 `authorization_code` / `refresh_token` 两种 grant；
- MCP 401 返回 `WWW-Authenticate: Bearer resource_metadata="..."`（RFC 9728 风格），CORS 已 `exposeHeaders` 该头；
- refresh token 轮换并吊销旧 token。

**已知风险点（需实测或决策）**
1. ~~`/jwks` 返回空 `keys: []`~~ 已解决：access token 改为 opaque 随机串（`wloat_` 前缀，SHA-256 哈希存 `oauth_tokens`），`/jwks` 与元数据里的 `jwks_uri` 一并删除。副作用：旧的 HS256 token 全部失效，客户端需重新授权（目前没有真实客户端跑通过流程，无影响）。
2. ~~`/authorize` 参数缺失时返回 JSON 400，而非按规范带 `error` 参数重定向回 `redirect_uri`~~ 已解决：`client_id` / `redirect_uri` 未通过验证时仍返回 400（跳转即开放重定向），其余错误按 RFC 6749 4.1.2.1 带 `error`、`error_description`、`state` 302 回 `redirect_uri`。同时把 `code_challenge_method` 非 S256 的情况提前到 `/authorize` 拒掉，否则要到 token 交换阶段才报错。
3. `/token` 的 `redirect_uri` 客户端不传就不校验（传了才比对），属轻微偏差，可接受。

**待实测清单（需真实客户端）**
- [ ] Claude Desktop / Claude Code 远程 MCP：URL 指向 `https://work-learn-api.vercel.app/api/mcp`，验证无 token 时 401 → 自动拉起浏览器 OAuth → 授权后 `search_corpus` / `save_material` 可用
- [ ] Codex（OpenAI）远程 MCP 走 OAuth
- [ ] Cursor / VS Code 类客户端远程 MCP 走 OAuth
- [ ] MCP Inspector（官方调试工具）连远程端点 + OAuth 流程
- [ ] refresh token 过期 / 吊销后客户端行为（应静默重授权）

## Token 交付体验

- [x] Web 端创建 PAT 时可选有效期（30/90/365 天或永不过期），列表显示到期时间
- [x] 只显示一次的 token 提供一键复制，以及「保存到文件」下载
- [x] 页面直接给出 `--token-file` 路径，并生成 `umask 077` 写文件命令与 `install -m 600` 移动命令
- [x] 「让 agent 帮你配置」的提示词有两种模式：token 写进提示词，或只给出文件路径（提示词明确要求 agent 不要读取该文件）
- [x] `@work-learn/setup` 的 `--token-file` 支持 `~` 展开；仓库检测改为从当前目录向上查找，不再硬编码作者的家目录路径

## 当前关键决策

- Skill 是主入口，不是附属插件；
- MCP/API 是统一能力层；
- 数据**本地优先**：本机（stdio MCP、CLI）默认写本地 SQLite，云端 Supabase 是「个人账号的同步副本」，由 `learn sync` 主动推送；线上路径（remote MCP、Web）保持云端直写；
- 本地同时提供 markdown 镜像（`learn export`），SQLite 是唯一真相源；
- 不为每个 Agent 建立独立的核心业务逻辑；
- 英语学习是第一场景，底层可扩展为个人 AI 工作资产沉淀系统；
- 默认主动触发，不默认全量监听和上传。

存储方案详见 [docs/local-first-storage.md](docs/local-first-storage.md)。

## 部署结论

- API 用 esbuild 打包为自包含 serverless 函数，从仓库根部署到 Vercel，规避 pnpm workspace 解析问题；
- 根 `vercel.json` 用显式 `builds` 配置，避免根 `package.json` 被误判为静态站点；
- 部署细节见 [docs/deployment.md](docs/deployment.md)。

## 已经由实现回答的问题

- 数据本地优先（SQLite），云端 Supabase 是同步副本，由 `learn sync` 做 pull → push → pull 双向同步，见 [docs/local-first-storage.md](docs/local-first-storage.md)；
- 复习先用简单队列：完成一次即 `status = completed`、`interval_days = 1`，没有间隔重复算法（按当前决策先不推进 SRS）；
- 不限定单一重点 Agent：`@work-learn/setup` 同时探测 Codex、Claude Code、Claude Desktop、CodeBuddy、Cursor、OpenCode；
- 除 `learn capture` 的剪贴板读取是 macOS 专有外，其余部分不依赖 macOS。

## 需要后续确认的问题

- 是否引入间隔重复算法，替换当前的一次性复习队列（当前决定暂缓）；
- `generate_practice` 目前生成结构化练习提示，覆盖材料和提问翻译，不调用模型；后续再决定是否引入本地/云端模型做自适应练习；
- 使用本地模型还是云端模型做语料分析；
- 是否需要 macOS Companion 做终端会话的自动采集。

CLI 与 MCP 接入说明见：[docs/cli-and-mcp.md](docs/cli-and-mcp.md)

## 本轮新增后的待执行项

- 在 Supabase 执行 `supabase/migrations/014_question_norm_dedupe.sql`；
- 合入 dev 后由 GitHub Actions 部署 API/Web；
- 真实 Agent 验证 `snooze_review`、提问翻译练习、source/tag 筛选和 Web 导出。

Agent 接入配置见：[docs/mcp-agent-setup.md](docs/mcp-agent-setup.md)（需在对应 App 内实际配置并验证）。

远程 MCP 方案见：[docs/remote-mcp.md](docs/remote-mcp.md)（`POST /api/mcp` 已实现并上线）。

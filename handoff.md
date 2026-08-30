# Handoff

## 2026-08-26 迭代（C1–C4：练习闭环 / 自适应出题 / Agent 浮层 / rc-hook）

全部实现并提交到 `dev`（未 push）。CI 在 `a275748` 修复 `noUncheckedIndexedAccess` 后转绿，PR #40 已合并并部署生产。

- **C1 练习闭环·状态保存**：新增 `practice_records` 表（迁移 `supabase/migrations/017_practice_records.sql`，**已于 2026-08-27 推到云端并验证表结构与代码查询一致**）。Web 练习改为「先写→对照→记住了/再练一次」，每次练习与错题落库；首页新增全局「练习记录 / 错题本」分区。覆盖 shared-schema / direct(Supabase) / local-store / api / mcp-server / web。
- **C2 模型驱动自适应出题**：新增 OpenAI 兼容 LLM 客户端，由 env 开关：`WORK_LEARN_LLM_BASE_URL`、`WORK_LEARN_LLM_API_KEY`、`WORK_LEARN_LLM_MODEL`（默认 `gpt-4o-mini`）。`generateAdaptivePractice` 基于近期错题生成练习；未配置 LLM 时回退规则生成。Web 练习面板新增「AI 出题」按钮。
- **C3 Companion Agent 浮层**：默认关。检测前台 Agent（Claude / Cursor / Codex / 终端）时弹出透明 always-on-top 浮层，显示已存表达以 nudate 复用。新增 `learn expressions` CLI 命令供浮层取数。
- **C4 rc-hook 自动录制**：新增 `learn hook install|uninstall|status`，向 shell rc（~/.zshrc 等）注入带边界标记的包裹块，把交互 shell 包进 `learn run` 自动录制；默认关，`uninstall` 仅移除注入片段、不动其余配置。托盘新增安装入口。

新增 CLI：`learn expressions [--json] [--limit N]`、`learn hook install|uninstall|status`。

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
- [x] 云端提问翻译按规范化问题去重，新增并已执行 `014_question_norm_dedupe.sql`
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
- 复习已升级为间隔重复（SRS，SM-2 风格，按评级重排 `due_at`/`interval_days`，见下「间隔重复算法」），不再是一致性标完成；
- 不限定单一重点 Agent：`@work-learn/setup` 同时探测 Codex、Claude Code、Claude Desktop、CodeBuddy、Cursor、OpenCode；
- 除 `learn capture` 的剪贴板读取是 macOS 专有外，其余部分不依赖 macOS。

## 功能迭代 Backlog

### P1：练习闭环

- [x] 练习记录：保存用户是否练过、练习结果、Agent 反馈和错题（`practice_records` 表 + `017` 迁移，云端已推，C1）；
- [x] Web 练习模式：先自己写，再展开参考说法，再标记“记住了 / 再练一次”（C1）；
- [x] 模型驱动自适应练习：由 `WORK_LEARN_LLM_*` env 开关接入任意 OpenAI 兼容模型（本地或云端均可），基于近期错题动态出题，未配置回退规则生成（C2）。

### P1：复用追踪

方案见 [docs/reuse-tracking.md](docs/reuse-tracking.md)。核心原则是追踪真实工作流里的主动复用，不把多重表达折叠成唯一标准答案；同一个意图下保留多种说法，按语域和场景扩充而不是纠正。

- [x] P1-a：新增 saved expressions / reuse events 存储，保存语料时自动升格 useful expressions；
- [x] P1-a：MCP/API/本地库提供 `record_reuse`，先用确定性短语匹配记录复用事件；
- [x] 用户执行 `015_reuse_tracking.sql`；
- [x] P1-b：Web 复用页展示主动词汇量、表达广度和沉睡表达；
- [x] P1-c：新增确定性 `suggest_reuse`，同一意图扩充、每轮最多一个建议；
- [x] P1-c 后续：nudge 频控、用户级开关，以及 `configure_reuse_nudges` / Web / CLI 设置入口；
- [x] P1-d：模型辅助意图聚类（`list_expressions` + `cluster_intents`，宿主模型分组），并提供 `merge_intents` / `split_intent` 纠偏；同义变体识别复用现有确定性匹配。
- [x] P1-d 后续：Web 端意图浏览与编辑 UI（`GET /api/intents` + `IntentDashboard`：勾选表达聚类成意图、合并意图、拆分意图）。

### P2：备份、恢复与迁移

- [x] CLI 增加 `learn backup` / `learn restore`，用 SQLite 文件做无损本机恢复；
- [x] Web 增加 JSON 导出 / 导入，用于跨账号或人工迁移；
- Markdown 继续只作为可读归档，不作为无损恢复格式。

### P3：更大入口

- [x] `learn run -- <agent>`：CLI 用系统 `script` 在 PTY 中运行 agent、录制终端会话、脱敏后写入本地库（`source=terminal`），作为 macOS Companion 终端采集能力的第一刀（本地优先、离线可用）；
- macOS Companion 应用层：全局快捷键、菜单栏、离线兜底、自动采集（依赖 `learn run` 采集内核）。**M1 最小壳已落地**：`apps/companion` 是基于 Electron 的菜单栏应用，作为薄壳复用 `learn` CLI（spawn 仓库内 `tsx` 跑 `apps/cli/src/index.ts`，因此必须在 better-sqlite3 编译所用的 Node 下启动），菜单栏显示「今日采集 / 待复习 / 本地待推送 / 上次同步」，并提供「采集剪贴板 / 同步云端 / 打开 Web」三个按钮；**全局快捷键（M2）已落地**：默认 `⌘⇧L`（可用 `WORK_LEARN_HOTKEY` 覆盖）触发「拷贝当前选中文本 → `learn capture` → 还原剪贴板」并弹通知，需在本机「系统设置 › 隐私与安全性 › 辅助功能」授予权限；**离线兜底 UI（M3）已落地**：面板顶部横幅强调「离线可用 · 数据先存本地」，并展示本地库/云端状态点（绿=连通、黄=未配置 Token、红=云端不可达），同步失败按「Token 缺失 / 云端不可达」分类提示，每 8s 自动探活（`learn doctor`）；**自动采集（M4）已落地**：「自动采集」开关（持久化于 `userData` 的 `companion-config.json`）开启后，Companion 用 `osascript` 自动打开一个被 `learn run -- <shell>` 包裹的 Terminal 窗口，用户在其中进行终端 Agent 会话、关窗即自动存盘，无需手动敲 `learn run`；托盘菜单与面板均有「打开录制终端」入口（目前默认 Terminal.app，iTerm 留待增强）。
  - **M4 增强（rc-hook 自动录制，已实现，见 C4）**：在用户 shell 启动文件（`~/.zshrc` / `~/.bashrc`）写入包裹块，使**用户正常新开的任何终端窗口**默认被 `learn run` 包裹、自动录制，无需改用 Companion 开的录制窗口。实现已于 2026-08-26 的 C4 落地：`learn hook install|uninstall|status` 向 rc 注入带边界标记、用 `WORK_LEARN_RECORDING` 环境变量防重入的包裹块，默认关、可一键干净卸载；仅原生 shell 启用（Warp/Tmux 不支持）、不注入 `fnm`、不依赖特定 Node 版本（复用已安装的 `learn`）。
- 间隔重复算法（SRS）：**本轮已实现**。在 `shared-schema` 新增纯函数 `scheduleNextReview(prevIntervalDays, grade)`（SM-2 风格：again→立即重学、hard×1.3、good×2.1、easy×3.2；easy 且间隔≥21 天判为已掌握），云端 `direct.ts` 与本地 `local-store` 两处 `markMastered` 同步改为「按评级重排 due_at/interval_days」而非一次性标完成；API `/api/reviews/:id/complete?grade=`、web `completeReview`、MCP `mark_mastered` 均透传评级；复习卡片展开答案后显示 Again/Hard/Good/Easy 四档按钮（CSS `.grade-button`）。

## 本轮功能迭代（2026-08-26）

在语料库/复习闭环上新增三项能力，均已实现且 Web 类型检查通过（`apps/web` 下 `npx tsc --noEmit` 无错）：

1. **SRS + 今日待复习队列**：见上「间隔重复算法」。复习从「一次性标完成」升级为按评级递增间隔的间隔重复；待复习队列即现有 ReviewList（`getReviewItems` 返回 `due_at ≤ now` 的 pending 项）。
2. **多题型测验（确定性生成，无 LLM）**：`generatePracticeFromItems` 在原有 reuse/recall/correction/apply/question 基础上，新增 `mcq` / `fill` / `scenario` 三种可自测题型（选择、语境填空、情境应用），由材料的 vocabulary/usefulExpressions/practicePrompts 确定性生成；Web `PracticeButton` 新增 `PracticeExerciseItem` 交互组件（选项点击 / 填空检查 + 对错揭示，配套 CSS `.practice-options` / `.practice-fill`）。**说明**：此确定性多题型测验本身不调用模型；LLM 驱动的「AI 出题」已由 C2 的 `generate_adaptive_practice`（见上 C2）实现，由 `WORK_LEARN_LLM_*` 开关控制，未配置时回退规则生成。
3. **主动复用推送（in-app nudge）**：语料库在搜索词或选中 topic 时，顶部出现「相关已存表达」面板（`ReuseNudgePanel`，debounce 300ms 调 `/api/reuse/suggestions`），把存过的相似表达在浏览/检索时浮出。Companion 内的主动 nudge 表面（Agent 工作中浮层）**已落地（C3）**：检测前台 Agent（Claude / Cursor / Codex / 终端等）时弹出透明 always-on-top 浮层显示已存表达，默认关、托盘可开关。

### 本地预览提示
- Web 默认 `pnpm --filter @work-learn/web dev --port 3101`；Vite proxy 把 `/api` 指向 `WORK_LEARN_API_TARGET`（默认 `http://localhost:3000`）。
- **API 运行在 Node 20+ 即可**：Supabase JS 的 realtime 客户端原本需要原生 WebSocket（Node 22+ 才有），但 API 从不使用实时订阅，已在 `apps/api/src/lib/supabase.ts` 用 `ws` 做 polyfill（仅当 `globalThis.WebSocket` 缺失时挂上，Node 22+ 走原生）。仓库根 `.node-version` / `.nvmrc` 钉到 `20.20.2`，进入任意子目录 `fnm` 自动切到 Node 20。
- 启动示例：`cd apps/api && SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… PORT=3100 pnpm dev`
- 注：`shared-schema` 的 `exports` 直接指向 `src/index.ts`（源码），tsx/Vite 均用源码，无需先 build；其 `tsc` 脚本仅类型检查，`generatePracticeFromItems` 在 `noUncheckedIndexedAccess` 下有预存类型告警，esbuild 运行时不校验，不影响功能。

## 需要后续确认的问题

- 间隔重复算法（SRS）：**本轮（2026-08-26）已实现**，见上文「间隔重复算法（SRS）」与「本轮功能迭代」；复习改为按评级递增间隔（SM-2 风格），不再是一致性标完成，原「暂缓」决定已推翻。
- `generate_practice` 生成确定性结构化练习提示，覆盖材料和提问翻译，不调用模型；**C2 已新增 `generate_adaptive_practice`**：在配置 `WORK_LEARN_LLM_*` 时由 LLM 基于近期错题自适应出题，未配置时回退确定性生成。
- 使用本地模型还是云端模型做语料分析；
- macOS Companion 终端自动采集（M4）：**已落地**（「自动采集」开关开启后 `osascript` 自动开录制终端，关窗即存盘）；更激进的 rc-hook 自动录制**已于 C4 实现**（见 M4 增强，默认关、可一键干净卸载）。

## 本轮修复

- `LocalStore` 构造函数现在读取 `WORK_LEARN_DB_PATH`（原为 `options.dbPath ?? DEFAULT_DB_PATH`，忽略了该环境变量），与文档一致；可用它隔离测试库，避免污染 `~/.work-learn/work-learn.db`。
- `packages/learning-core` 的 typecheck / build 因 `shared-schema` 的 `getLlmConfig()` 读取 `process.env`（C2 引入的 LLM 客户端）而失败：`learning-core` 此前未声明 `@types/node`。已在 `devDependencies` 显式加入 `@types/node@^20.19.43`，并一并提交 `pnpm-lock.yaml`（CI 用 `--frozen-lockfile`），typecheck / build 全绿（commit `fff5862`，未 push）。

CLI 与 MCP 接入说明见：[docs/cli-and-mcp.md](docs/cli-and-mcp.md)

## 当前待执行项

- 将 `dev` 合入 `main`，由 GitHub Actions 部署包含复用追踪的 API/Web；
- 发布后可人工试用 `learn backup` / `learn restore --file ... --yes`；
- 发布后可人工试用 Web 的 JSON 导出 / 导入；
- 真实 Agent 验证 `record_reuse`：先保存一条包含 useful expression 的语料，再在后续对话中自然使用该表达；
- [x] 用户执行 `016_user_reuse_nudge_settings.sql`；
- 真实 Agent 验证 `suggest_reuse`：确认宿主 Skill 只在当前英文命中保存表达时给出最多一个扩充式说法；
- 真实 Agent 验证 `configure_reuse_nudges`：在 Agent 内关闭后不再返回建议；
- 真实 Agent 验证 P1-d：用 `list_expressions` 拉未聚类表达，模型分组后调 `cluster_intents`，再验证 `suggest_reuse` 能返回同一意图下的其他说法；
- [x] 更保守的同义变体识别策略（三层全部完成：屈折归一化 + 功能词弹性匹配 + 候选提示，见下「屈折归一化 Variant 匹配」）；
- `findReuseCandidates` 接入 MCP 工具 / API / Web UI（核心算法已完成并导出，待上层集成；当前不做）。

## 屈折归一化 Variant 匹配（2026-08-27）

在 `packages/shared-schema/src/inflection.ts` 新增轻量英语词形还原，`findReuseMatches` 实现三层递进匹配：

| 层级 | 匹配方式 | matchKind | confidence |
|------|----------|-----------|------------|
| 1 | normalized 子串精确匹配 | `exact` | 1.0 |
| 2 | lemmatized 子串匹配（时态/数/比较级） | `variant` | 0.85 |
| 3 | 弹性匹配（允许 1 个功能词差异） | `variant` | 0.7 |

**覆盖范围（仅屈折 + 功能词，不做语义/同义词）**：
- 动词时态：`rolling/rolled/rolls` → `roll`，不规则动词查表（~120 个常用词）
- 名词复数：`migrations` → `migration`，`boxes` → `box`，`queries` → `query`
- 比较级/最高级：`faster/fastest` → `fast`
- 双写辅音还原：`running` → `run`（白名单排除 `roll/call/pass` 等本身以双辅音结尾的词）
- -e 脱落还原：`making` → `make`，`built` → `build`
- 功能词弹性：允许冠词/介词/代词/助动词等 1 个差异（`a`→`the`、省略 `a`），**短语动词成分（out/in/up/down）视为实词，不弹性**

**保守设计**：
- 不做同义词替换（`deploy` ≠ `roll out` 仍不匹配，语义归意图层）
- 功能词集合严格排除短语动词介词（in/on/out/off/up/down/over/under），避免 "roll out" vs "roll in" 误匹配
- `variant` 与 `exact` 分开统计，confidence 逐级降低
- 数据库 `reuse_events.match_kind` CHECK 约束已包含 `variant`，无需迁移

**第三层：候选提示（`findReuseCandidates`）**：
- 对未命中的 expression，计算实词 Jaccard 相似度，≥0.6 返回为候选
- 不自动记录 `reuse_event`，需上层（Web/Companion/Skill）展示给用户确认
- 已导出 `findReuseCandidates` 和 `ReuseCandidate` 类型，MCP/API 接入待后续迭代

**测试**：`shared-schema` 39 个测试全过（新增 20 个），全仓库 typecheck 通过。

Agent 接入配置见：[docs/mcp-agent-setup.md](docs/mcp-agent-setup.md)（需在对应 App 内实际配置并验证）。

远程 MCP 方案见：[docs/remote-mcp.md](docs/remote-mcp.md)（`POST /api/mcp` 已实现并上线）。

## 2026-08-30 深度评审（安全 / 同步正确性 / 测试质量）

对全仓做了一轮只读深度评审。**核心结论：承载产品核心承诺（追踪真实复用）的同步层是最薄弱的一环，存在会静默丢数据的缺陷；同时"测试不拦回归、文档勾选先于真实验证"让已交付功能的实际可靠度低于账面。**

### 本轮已止血（已改、未提交）

- [x] `apps/api/api/[[...route]].ts:6-7` 补 `PATCH` / `DELETE` 导出——Vercel 只放行入口文件显式导出的方法，缺了它们导致 `PATCH /api/materials/:id`、`DELETE /api/materials/:id`、`DELETE /api/question-translations/:id`、`PATCH /api/reuse/settings` 在生产直接 405，Hono 路由到不了；本地 dev 正常，属"本地绿、生产坏"。
- [x] `.github/workflows/deploy-api.yml:40-49` 新增"方法路由冒烟"：部署后对生产发无鉴权 `DELETE`/`PATCH`，返回 405 即判定入口又漏了方法、CI 红。防同类故障复发。
- [x] `apps/api/src/routes/mcp.ts:17` 注释 five → twenty（工具实际注册 20 个，见 `packages/mcp-server/src/tools.ts:39-219`）。
- [ ] 删除死文件 `apps/api/api/index.ts`（全仓零引用，`vercel.json` 只构建 `api/[[...route]].js`）。

### P0 — 数据丢失级

- **LWW 方向写反**：`packages/mcp-server/src/direct.ts:850` 与 `:873` 用 `.gte("updated_at", 传入值)` 过滤 update。语义是"只在云端行**更新或相等**时才覆盖"，两个方向全错——云端更新时被旧数据覆盖、云端更旧时新数据被静默丢弃，且不查影响行数，CLI 照常 `markSynced`（`apps/cli/src/index.ts:288`）。正确应为 `.lte(...)`。影响所有同步表。
- **practice_records 全链路缺席**：本地写入带 `sync_status`（`local-store/src/index.ts:293,642`），但 `unsynced()`（`:920-940`）、`markSynced`（`:1136`）、云端 `syncToCloud`/`fetchSyncSnapshot`（`direct.ts:897-997/784-828`）均不含。C1 练习闭环因此只在单机成立，Web 与 CLI 错题本是两个世界。
- **删除/插入时序会复活已删数据**：`direct.ts:977` tombstone 先于 upsert，但 insert 路径（`:846-848`）不查 `sync_tombstones`；`importPortableData`（`:1036-1045`，`tombstones:[]`）直接把已删实体插回。

### P1 — 高危

- **空 scope = 全权限**：`apps/api/src/lib/auth.ts:53-54,63-64`。对遗留 PAT 是刻意向后兼容（注释明说），但同一逻辑泄漏进 OAuth：`routes/oauth.ts:38` `scopes_supported: []` → 所有 OAuth 令牌实际全量读写，同意页展示的 scope 无约束力，属误导性授权。
- **OAuth code 兑换 / refresh 轮换非原子**：`lib/oauth.ts:143-151,170-192`，先查再更新，并发可双重兑换；旧 refresh 重放不触发家族撤销。应改单条条件 `UPDATE` 判成功。
- **毒丸批次**：云端 `UNIQUE(user_id,text_norm)`（`015:32`）vs 本地 `UNIQUE(text_norm)`（`local-store:265`）。本地 id 撞云端已有 norm 时 `upsertWithLww` 的 insert 永久报错且无事务（`direct.ts:977-984` 串行 HTTP）→ sync 卡死。
- **markSynced 竞态**：`apps/cli/src/index.ts:272-297` 快照批次 → 网络往返期间并发写入的行被无脑标 `synced`，新编辑永丢；tombstone 标记写在 `tx()` 之外（`local-store:1147-1156`）。
- **FK 级联两端分叉**：`materials/questions/practice_records` 关联云端 `SET NULL`、本地 `CASCADE`。云端 SET NULL 后 `normalizeMaterial` 把 `String(null)` 推成 `'null'`（`direct.ts:659`）→ 本地 FK 违反 → 整个 pull 事务回滚。

### P2 — 中

- **review id 漂移**：两端各自生成随机 uuid，按 `material_id` 匹配翻转（`local-store:1039`、`direct.ts:856`），翻转后按 id 的 tombstone 删除落空 → 幽灵行。
- **`updated_at` 可信度**：`012:44-62` 只为 4 表建 trigger；`intents/saved_expressions/user_settings/practice_records` 没有。`reuse_events` 无 `updated_at` 却被 `applyCloudTombstones` `.lte("updated_at")`（`direct.ts:1162`）→ 推其 tombstone 必 500。（后半条已在 P0-2 修复；前半条：`intents`/`saved_expressions`/`user_settings` 三表已由迁移 `018` 补齐触发器，`practice_records`/`reuse_events` 为追加写、无 `updated_at` 列，刻意不动。）
- **过滤注入**：`direct.ts:772` `q` 直接插值进 PostgREST `.or()`，含 `,`/`)` 可注入额外条件；外层 `eq(user_id)` 挡跨用户但可绕过搜索语义。
- **`/register` 可被刷**：`routes/oauth.ts:44-58` 无认证、无限流、不校验 `redirect_uris`；`client_name` 全由攻击者控制并渲染进同意页（钓鱼面）。
- **CI 不跑测试**：`.github/workflows/ci.yml:20-23` 只有 typecheck+build，111 个测试一个都不拦回归——与"方法路由 405 没人发现"同根：**验证没进流水线**。

### 架构性结论

1. **双实现是最大技术债**：`direct.ts`（云端）与 `local-store`（本地）是同一套业务逻辑的两份手写实现，FK 语义、唯一约束、tombstone CHECK、updated_at trigger 全在分叉，上面一半 P1 源于此。
2. **"完成"定义偏松**：C1 因 practice_records 不同步而半残、Web 编辑/删除因方法没导出而生产 405、复用追踪真实验证项（上文 `75,96,221-225`）全未勾。账面进度 ≈ 工程完成度，产品有效度尚未被任何一次真实使用证实。
3. **两个整包是空壳**：`packages/learning-skill`（零引用）、`packages/learning-core`（除 `redactSecrets` 外零引用，真算法在 `shared-schema`）；`mcp-server/src/index.ts` 的 17 项工具 HTTP 客户端已无人消费。持续误导读者。
4. **前端单文件巨石**：`apps/web/src/main.tsx` 1786 行、40+ `useState`、无测试、`react-query` 装了没用、两处硬编码 origin（`public/_worker.js:1`、`main.tsx:650`）。

### 修复优先级（待办）

- [x] P0-1：`direct.ts` 的 `upsertWithLww`/`upsertReviewsWithLww` `.gte` 已改 `.lte` 并加 `.select("id")`（零行=云端更新、按预期跳过，不抛错）；`upsertWithLww` 与 `upsertReviewsWithLww` 推送前先查 `sync_tombstones` 跳过已删 id（review 按 `material_id` 判，避免重建孤儿复习项）；`direct.test.ts` 新增回归测试锁定比较方向为 `lte`。**已跑通：mcp-server 28/28、api 22/22、shared-schema 39/39、setup 5/5，全仓 typecheck 绿。**
- [x] P0-2：insert 前查 tombstone（P0-1 已含）+ 按 id `onConflict`；practice_records 纳入同步批次。详见下方「P0-2：practice_records 同步」。
  - [ ] 统一两端 FK 语义（`materials/questions/practice_records` 云端 `SET NULL` vs 本地 `CASCADE`）：现阶段以「跳过孤儿行」兜底，未改约束。
- [x] P1：OAuth 新令牌强制非空最小 scope（commit `39baff2`）——空 scope 不再被当作全权限，新令牌默认 `read`，未请求 scope 的客户端只拿到只读；
- [x] P1：`/register` 的 `redirect_uri` 校验（commit `51f8235`）——拒绝非 https、非 loopback 的 http、带 fragment、含通配符的值，消除开放重定向拿授权码的漏洞；
- [ ] P1：`/register` 限流（serverless 无共享存储，需落库或网关层，待决策）；`client_name` 仍由攻击者控制并渲染进同意页（钓鱼面）；
- [ ] P1：code 兑换 / refresh 轮换改原子（单条条件 `UPDATE` 判成功，防并发双重兑换与旧 refresh 重放家族撤销）。
- [x] 把验证搬进 CI：`ci.yml` 在 typecheck 前加 `pnpm test`（详见下方「测试此前从未真正运行」）。
  - [ ] 补 `scheduleNextReview`（现零测试）、`markSynced` 往返、`apps/api` 用 `app.request()` 的进程内路由测试；
  - [x] CI 加一条「测试数为 0 即失败」的护栏（commit `d1aa84c`，详见下方「零测试护栏」）。
- [ ] 清债（可最后）：删两个空壳包、收敛双实现、拆 `main.tsx`。

## 测试此前从未真正运行（2026-08-30）

跑 P0-1 回归测试时发现问题不在被测代码，而在**测试根本没被执行过**：

1. **脚本依赖 shell 展开通配符**：5 个包的 `test` 都是 `tsx --test src/*.test.ts`。Linux/macOS 的 sh 会展开，Windows 的 cmd 不会——tsx 收到字面量 `src/*.test.ts`，找不到文件，**一个用例都不跑并退出 0**。
2. **`tsx` 的 `.bin` 垫片在部分 Windows 环境下是坏的**：`pnpm exec tsx --version` 零输出退出 0，`tsx --test <显式文件>` 同样零输出退出 0。即使用显式路径也跑不出结果。
3. **`markMastered cannot complete another user's review item` 一直是红的**：SRS 改造后 `markMastered` 先 `select` 读 `interval_days` 再 `update`，断言还停在 `calls[0].verb === "update"`，实际是 `"select"`。这条从 SRS 上线起就失败，因为测试从没跑过，无人知晓。
4. **CI 只跑 typecheck + build**（`ci.yml:20-23`），111 个测试一个都不拦回归。

**修复**：
- 5 个包的 `test` 改为 `node --import tsx --test src/*.test.ts`（api 用 `src/**/*.test.ts`，其测试在 `src/lib/`）。**glob 不能加引号**：Node 的测试运行器要到 v21+ 才支持 glob，仓库与 CI 都钉在 Node 20，加引号会让 Linux 上从「shell 展开」退化成「Node 展开」从而跑零个。不带引号时 POSIX 由 shell 展开、Windows 由 Node 22 兜底，两头都成立。
- `ci.yml` 在 typecheck 前加 `pnpm test`。
- 测试桩 `stubClient` 现在记录 `gte`/`lte` 比较算子到 `call.comparisons`（此前 `lte` 是空实现，无法断言），新增的 LWW 回归测试复用共享桩。
- 修掉上面第 3 条的陈旧断言，并补上 id 作用域断言。

**已知未覆盖**：`packages/local-store` 的约 21 个测试在本机跑不了——`better-sqlite3` 需要原生模块，预编译包下载超时、本机无 MSVC 工具链。只能靠 CI（ubuntu + Node 20 可正常构建）覆盖。

## P0-2：practice_records 同步（2026-08-30）

C1 的练习闭环此前只在单机成立：本地写 `practice_records` 带 `sync_status`，但 `unsynced()` / `markSynced()` / `syncToCloud` / `fetchSyncSnapshot` 全都不含它，Web 与 CLI 的错题本是两个世界。现已打通双向。

**数据形态**：云端 `017_practice_records.sql` 的 `practice_records` 只有 `created_at`（无 `updated_at`），RLS 也只有 select/insert/delete、没有 update 策略——它和 `reuse_events` 一样是**追加写（append-only）**。因此同步走 `upsertImmutableWithId`（`ON CONFLICT (id) DO NOTHING`），不做 LWW；pull 的增量游标用 `created_at`。

**改动**：
- `shared-schema`：`syncPracticeRecordSchema` + `syncBatchInputSchema.practiceRecords` + `syncPracticeRecordColumns`。
- `local-store`：`unsynced()` / `markSynced()` / `stats()` 纳入 practice_records；`applyRemoteBatch` 新增 `upsertPracticeRecord`（`ON CONFLICT(id) DO NOTHING`，仅在实际插入时计数）。
- `direct.ts`：`fetchSyncSnapshot` 拉 practice_records（按 `created_at` 增量）；`syncToCloud` 用 `upsertImmutableWithId` 推送并在返回计数里带上 `practiceRecords`。
- CLI `pushChanges`：`total` 与 `markSynced` 带上 practiceRecords。

**顺带修掉两个必炸的缺陷**：
- `applyCloudTombstones` 对所有实体都加 `.lte("updated_at")`，而 `reuse_events` 根本没有 `updated_at` 列 → **推送任何 reuse_event 删除都是 500**。现改为仅对有 `updated_at` 的表加护栏（回归测试同时断言了正例：`material` 仍受护栏保护）。
- 本地 `deleteReuseEvent` 语句是 `... WHERE id = ? AND ? >= ?`（3 个占位符），调用只传 2 个参数，且引用了 `reuse_events` 上不存在的 `updated_at` → pull 到 reuse_event tombstone 时 prepare 就抛错、整个事务回滚。改为按 id 直接删除。

**按 id `onConflict`**：`upsertWithLww` / `upsertReviewsWithLww` 的 insert 分支改为 `upsert(..., { onConflict: "id" })`——探测存在与写入是两次独立 HTTP，中间无事务，并发推送会在两者之间插入同一行；`ON CONFLICT (id) DO UPDATE` 让重试变成幂等而不是永久的主键冲突。`upsertImmutableWithId` 改为 `upsert(..., { onConflict: "id", ignoreDuplicates: true })`，省掉一次往返且原子。

**已知缺口（未修）**：
- **毒丸批次（P1，见上）未处理**：云端 `UNIQUE(user_id,text_norm)` vs 本地 `UNIQUE(text_norm)`，本地 id 撞云端已有 norm 时 insert/update 永久失败且无事务，sync 仍会卡死。本轮只消除了竞态，没消除约束冲突。
- **practice_record 没有 tombstone 实体**：本地 `sync_tombstones` 的 CHECK 只允许 `session/material/question/review/intent/expression/reuse_event`，加 `practice_record` 需要重建表。目前删除练习记录不会跨端传播（追加写语义下影响有限）。
- **`LocalStore.recordPractice` 返回 `id: ""`**：插入了行但没回传 id，调用方只能反查 `getPracticeHistory`。属既有缺陷，与同步无关，未在本轮改动。
- **孤儿行只跳过、不上报**：`applyRemoteBatch` 里父记录缺失时 `continue`，该行静默丢弃且不计入返回计数——仍是"静默丢数据"的形状，待统一 FK 语义时一并处理。

**验证**：`direct.test.ts` 新增 4 个用例（pull 带 practice_records 且游标走 `created_at`、push 走幂等 upsert 且不预探测、tombstone 只对有 `updated_at` 的表加护栏并同时断言 `material` 正例、已 tombstone 的 id 不写回），mcp-server 28/28 全过。`local-store` 新增 3 个用例覆盖 practice_records 的推/拉/孤儿跳过，**本机跑不了**（同上），只能在 CI 上见分晓；其 SQL 已用 Node 内置的 `node:sqlite` 单独验证过语法、占位符数量、`ON CONFLICT DO NOTHING` 的重放行为与 FK 拒绝孤儿。

## 测试一进 CI 就抓到的东西（2026-08-30）

`pnpm test` 进 CI 后第一次运行，`local-store` 25 个用例里红了 2 个，两个都不是新写的：

1. **`LocalStore.markMastered` 把重排后的到期时间写丢了**（真 bug，非测试问题）。非"已掌握"分支的 UPDATE 是 `SET due_at = ?, interval_days = ?, updated_at = ? WHERE id = ?`，但 `.run()` 第一个参数传的是 `new Date().toISOString()` 而不是算出的 `dueAt`。结果：本地给一条复习打分后，它**立刻又到期**，间隔重复在本地完全没生效——`interval_days` 存了，`due_at` 没存。云端 `direct.ts` 传的是 `dueAt`，只有本地这份写错。已修。
   - 这条是**既有用例 `material save feeds the review queue and can be marked mastered` 抓到的**——它断言打分后队列为空，断言本身一直是对的，只是从没被执行过。
2. **`unsynced includes local review completion` 断言的是 SRS 之前的语义**：打分后期望 `status === "completed"`，而现在打分是重排（status 保持 `pending`，`due_at` 后移）。与上面 `direct.test.ts` 那条 `markMastered` 是同一类陈旧断言。已按 SRS 语义重写，并补上"重排的日期必须落库、不能只是返回"这一条。

**结论印证了评审里的判断**：账面完成度不等于产品有效度。间隔重复是 2026-08-26 那轮上线的主要功能，本地实现从那天起就是坏的，四天里没有任何信号——因为测试从未运行。同理，这次也说明把验证搬进 CI 不是形式主义：它用一次运行就还清了一部分欠账。

**CI 现状**：`local-store` 25/25、mcp-server 28/28、shared-schema 39/39、api 22/22、setup 5/5；typecheck 与 build 均通过。

**本机验证的一个陷阱（重要）**：这台机器上 pnpm 的目录链接（junction）不可遍历，为了让测试能跑起来，`node_modules` 是用 `node-linker=hoisted` 重装、并把 workspace 包换成真实目录副本的。代价是 **`.bin` 下的垫片是空文件（0 字节）**：`pnpm typecheck`、`pnpm build`、`pnpm exec <bin>` 全部**静默什么都不做并返回 0**。

因此在本机要真正验证类型，必须绕过垫片直接调用：

```bash
node node_modules/typescript/bin/tsc -p <package>/tsconfig.json --noEmit
```

`pnpm test` 不受影响——上一步已经把测试脚本改成 `node --import tsx --test`，它不经过 `.bin`。测试的绿是可信的；`pnpm typecheck` / `pnpm build` 的绿在本机不可信，一律以 CI 为准。这轮就是这么踩的：本地 `pnpm typecheck` 报绿，CI 一跑就抓出 `direct.ts:872` 的类型错误。

## 2026-08-30 续：OAuth 注册与令牌 scope 加固

继续推进深度评审的 P1 安全项，两项已提交到 `dev`（未 push），两个原子提交、各带单测，28 个 api 测试全过：

- **`51f8235` fix(oauth): validate redirect_uri on dynamic client registration**
  - 新增纯函数 `validateRedirectUris`（`apps/api/src/lib/oauth.ts`）：校验每个 `redirect_uri` 必须是绝对 URL、scheme 为 `https`（或 loopback 上的 `http`）、不含 fragment、不含通配符，并去重。
  - `routes/oauth.ts` 的 `POST /register`（OAuth 动态客户端注册 RFC 7591）先做校验，非法即 `400 invalid_redirect_uri`。
  - 之前任何 `redirect_uri` 都接受，攻击者可注册 `https://evil.example.com` 之类的回调，把授权码/令牌引到自己的端点（开放重定向）。
  - 单测 5 条覆盖 https / loopback http / 公网 http 拒绝 / fragment 与通配符拒绝 / 空与非数组拒绝 / 去重。

- **`39baff2` fix(oauth): issue new tokens with a non-empty minimal scope**
  - 新增 `DEFAULT_OAUTH_SCOPE = "read"` 与 `resolveIssuedScope(scope)`；`exchangeAuthorizationCode` 与 `rotateRefreshToken` 发放令牌时改用它。
  - 之前 OAuth 令牌若协商到的 scope 为空，会在 `lib/auth.ts` 被解析成 `undefined`，而鉴权层把 `undefined` 视为「无限制」——即跳过 scope 参数的客户端静默获得读写全权限（与 `routes/oauth.ts:38` 的 `scopes_supported: []` 叠加，同意页展示的 scope 毫无约束力）。
  - 现默认 `read`，未显式请求更多 scope 的客户端只拿只读；合规客户端（含 Web consent 透传 `scope=read write`、MCP 客户端请求 `read write`）不受影响，无生产回归。
  - 遗留 PAT 的 `undefined=全权限` 是刻意向后兼容（注释明说），本轮未动。

**仍开着**：`/register` 无频控（`client_name` 仍由攻击者控制并渲染进同意页，钓鱼面）、code 兑换/refresh 轮换非原子（并发可双重兑换）、毒丸批次、markSynced 竞态、review id 漂移、过滤注入、FK 级联分叉、清债项。

## 2026-08-30 续二：零测试护栏 + `updated_at` 触发器补齐

### 零测试护栏（commit `d1aa84c`）

评审里「测试跑了个寂寞却返回 0」的根因有两个入口：glob 依赖 shell 展开、以及任何路径改名/包失去测试后静默匹配零个文件。新增共享运行器 `scripts/run-tests.mjs`，5 个包的 `test` 脚本统一改为 `node ../../scripts/run-tests.mjs "<glob>"`：

- **自己用 `node:fs` 展开 glob**，不再依赖 shell——POSIX/Windows 行为一致；
- **零文件匹配 → 退出 1**，并打印匹配失败的 glob；
- 跑完后解析 TAP 尾部 `# tests N`，**N 为 0 或读不到 → 退出 1**（输出仍原样透传，测试失败时透传子进程退出码）。

本机已验证：4 个可跑的包全绿（api 28 / shared-schema 39 / mcp-server 28 / setup 5），零匹配路径实测退出 1。`local-store` 仍只能靠 CI（better-sqlite3 原生构建，同前）。

**实现时的一个坑（记录防复发）**：脚本两次报 `SyntaxError`，根因不是转义——是**块注释里写了 `**/` 字样（如 `"**/"`），第二个 `*/` 恰好把注释提前终止**，后面的说明文字变成了代码。已改为文字描述，全文件避开这一序列。

### `updated_at` 触发器补齐（commit `e9d1bb1`，**迁移 `018` 需用户在云端执行**）

`012` 只给最初 4 张同步表建了 `set_updated_at` 触发器；015/016 后加的表没有。这些表上任何非同步写入都会把 `updated_at` 留旧，之后 `learn sync` 推送按旧时间戳做 LWW，可能用旧数据盖掉新编辑。迁移 `018_updated_at_triggers.sql` 给 `intents` / `saved_expressions` / `user_settings` 三表补齐触发器（函数定义随迁移自带 `create or replace`，幂等）。

`practice_records` / `reuse_events` 是追加写、无 `updated_at` 列（017/015），刻意不动——与 P0-2 确立的同步语义一致。

**待办**：用户在云端 Supabase 执行 `018`；执行后普通 Web/CLI 写入的 `updated_at` 才真正可信。

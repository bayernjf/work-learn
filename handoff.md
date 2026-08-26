# Handoff

## 2026-08-26 迭代（C1–C4：练习闭环 / 自适应出题 / Agent 浮层 / rc-hook）

全部实现并提交到 `dev`（未 push）。CI 在 `a275748` 修复 `noUncheckedIndexedAccess` 后转绿，PR #40 已合并并部署生产。

- **C1 练习闭环·状态保存**：新增 `practice_records` 表（迁移 `supabase/migrations/017_practice_records.sql`，需 `supabase db push` 应用到线上）。Web 练习改为「先写→对照→记住了/再练一次」，每次练习与错题落库；首页新增全局「练习记录 / 错题本」分区。覆盖 shared-schema / direct(Supabase) / local-store / api / mcp-server / web。
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
- 复习先用简单队列：完成一次即 `status = completed`、`interval_days = 1`，没有间隔重复算法（按当前决策先不推进 SRS）；
- 不限定单一重点 Agent：`@work-learn/setup` 同时探测 Codex、Claude Code、Claude Desktop、CodeBuddy、Cursor、OpenCode；
- 除 `learn capture` 的剪贴板读取是 macOS 专有外，其余部分不依赖 macOS。

## 功能迭代 Backlog

### P1：练习闭环

- 练习记录：保存用户是否练过、练习结果、Agent 反馈和错题；
- Web 练习模式：先自己写，再展开参考说法，再标记“记住了 / 再练一次”；
- 模型驱动的自适应练习：决定使用本地模型还是云端模型，基于近期错误和保存语料动态出题。

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
  - **M4 增强（rc-hook 自动录制，暂不做）**：在用户 shell 启动文件（`~/.zshrc` / `~/.bashrc`）写入 snippet + 设置 `WORK_LEARN_AUTO_CAPTURE=1` 环境变量，使**用户正常新开的任何终端窗口**默认被 `learn run` 包裹、自动录制，无需改用 Companion 开的录制窗口。决策：**排到可选增强队列末尾，主线闭环（录制→存→回看）跑顺后再做**；若做，必须默认关、显式一键开启 + 一键干净卸载，且只在原生 Terminal.app/iTerm 启用（Warp/Tmux 明确不支持），用 `unset` 环境变量防重入、并顺手 `fnm use 22` 注入 Node 22（better-sqlite3 ABI 约束）。理由：当前 M4 已能录，rc-hook 仅省「记得用录制窗口」一步，属体验优化非能力补齐；而改动用户系统级 rc 文件信任成本高、跨终端表现不一致、需兜底重入/环境注入等，性价比低于其他 P3。
- 间隔重复算法（SRS）：**本轮已实现**。在 `shared-schema` 新增纯函数 `scheduleNextReview(prevIntervalDays, grade)`（SM-2 风格：again→立即重学、hard×1.3、good×2.1、easy×3.2；easy 且间隔≥21 天判为已掌握），云端 `direct.ts` 与本地 `local-store` 两处 `markMastered` 同步改为「按评级重排 due_at/interval_days」而非一次性标完成；API `/api/reviews/:id/complete?grade=`、web `completeReview`、MCP `mark_mastered` 均透传评级；复习卡片展开答案后显示 Again/Hard/Good/Easy 四档按钮（CSS `.grade-button`）。

## 本轮功能迭代（2026-08-26）

在语料库/复习闭环上新增三项能力，均已实现且 Web 类型检查通过（`apps/web` 下 `npx tsc --noEmit` 无错）：

1. **SRS + 今日待复习队列**：见上「间隔重复算法」。复习从「一次性标完成」升级为按评级递增间隔的间隔重复；待复习队列即现有 ReviewList（`getReviewItems` 返回 `due_at ≤ now` 的 pending 项）。
2. **多题型测验（确定性生成，无 LLM）**：`generatePracticeFromItems` 在原有 reuse/recall/correction/apply/question 基础上，新增 `mcq` / `fill` / `scenario` 三种可自测题型（选择、语境填空、情境应用），由材料的 vocabulary/usefulExpressions/practicePrompts 确定性生成；Web `PracticeButton` 新增 `PracticeExerciseItem` 交互组件（选项点击 / 填空检查 + 对错揭示，配套 CSS `.practice-options` / `.practice-fill`）。**说明**：全仓此前无任何 LLM 调用，高质量「AI 出题」需另接 LLM（API Key + 依赖），本轮未引入，作为后续升级项。
3. **主动复用推送（in-app nudge）**：语料库在搜索词或选中 topic 时，顶部出现「相关已存表达」面板（`ReuseNudgePanel`，debounce 300ms 调 `/api/reuse/suggestions`），把存过的相似表达在浏览/检索时浮出。Companion 内的主动 nudge 表面（Agent 工作中浮层）留待下一步（需 Mac 重编 Electron）。

### 本地预览提示
- Web 默认 `pnpm --filter @work-learn/web dev --port 3101`；Vite proxy 把 `/api` 指向 `WORK_LEARN_API_TARGET`（默认 `http://localhost:3000`）。
- **API 运行在 Node 20+ 即可**：Supabase JS 的 realtime 客户端原本需要原生 WebSocket（Node 22+ 才有），但 API 从不使用实时订阅，已在 `apps/api/src/lib/supabase.ts` 用 `ws` 做 polyfill（仅当 `globalThis.WebSocket` 缺失时挂上，Node 22+ 走原生）。仓库根 `.node-version` / `.nvmrc` 钉到 `20.20.2`，进入任意子目录 `fnm` 自动切到 Node 20。
- 启动示例：`cd apps/api && SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… PORT=3100 pnpm dev`
- 注：`shared-schema` 的 `exports` 直接指向 `src/index.ts`（源码），tsx/Vite 均用源码，无需先 build；其 `tsc` 脚本仅类型检查，`generatePracticeFromItems` 在 `noUncheckedIndexedAccess` 下有预存类型告警，esbuild 运行时不校验，不影响功能。

## 需要后续确认的问题

- 间隔重复算法（SRS）：**本轮（2026-08-26）已实现**，见上文「间隔重复算法（SRS）」与「本轮功能迭代」；复习改为按评级递增间隔（SM-2 风格），不再是一致性标完成，原「暂缓」决定已推翻。
- `generate_practice` 目前生成结构化练习提示，覆盖材料和提问翻译，不调用模型；后续再决定是否引入本地/云端模型做自适应练习；
- 使用本地模型还是云端模型做语料分析；
- macOS Companion 终端自动采集（M4）：**已落地**（「自动采集」开关开启后 `osascript` 自动开录制终端，关窗即存盘）；更激进的 rc-hook 自动录制仍排到可选增强队尾（见 M4 增强）。

## 本轮修复

- `LocalStore` 构造函数现在读取 `WORK_LEARN_DB_PATH`（原为 `options.dbPath ?? DEFAULT_DB_PATH`，忽略了该环境变量），与文档一致；可用它隔离测试库，避免污染 `~/.work-learn/work-learn.db`。

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
- 下一步功能：更保守的同义变体识别策略。

Agent 接入配置见：[docs/mcp-agent-setup.md](docs/mcp-agent-setup.md)（需在对应 App 内实际配置并验证）。

远程 MCP 方案见：[docs/remote-mcp.md](docs/remote-mcp.md)（`POST /api/mcp` 已实现并上线）。

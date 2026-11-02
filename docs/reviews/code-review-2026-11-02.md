# 代码评审报告（2026-11-02）

- **评审日期**：2026-11-02
- **代码基线**：`dev` @ `fb644e1`（`git log --oneline -1` 实测）
- **范围**：全仓只读深度评审（161 个 git 跟踪文件），覆盖架构、正确性、安全、数据模型、错误处理、测试、依赖构建、性能、文档一致性
- **方法**：全量阅读 `apps/api`、`packages/mcp-server`、`packages/shared-schema` 关键源码 + 其余包重点抽读；实跑 `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build` / `tools/check-migrations.sh`；逐条复核 2026-09-30 上一轮审计（`docs/code-audit.md`，基线 `ff01066`）的高危项在当前代码中是否仍然成立
- **与上轮审计的关系**：上轮（高危 4 + 中 11 + 低 9）发现的大部分结构性问题**仍未修复**，本报告对复核后仍成立的条目给出当前行号证据，并新增 2 条上轮未发现的缺陷

---

## 一、仓库定位与规模概览

Work Learn 是跨 AI Agent 的个人英语语料学习系统（pnpm 10 + Node 24 monorepo，TypeScript strict + `noUncheckedIndexedAccess`）：

| 模块 | 角色 | 规模要点 |
|------|------|----------|
| `apps/api` | Hono API（Vercel Function，service-role 访问 Supabase） | 33 条 REST 路由 + OAuth 2.1 + PAT + 远程 MCP（Streamable HTTP） |
| `apps/web` | React 19 + Vite 静态前端（Cloudflare Pages） | 12 组件 + 6 hooks，**零测试** |
| `apps/cli` | `learn` CLI（本地 SQLite 优先） | 15 个子命令 |
| `apps/companion` | macOS Electron 托盘 | spawn CLI / osascript，**零测试** |
| `packages/mcp-server` | MCP 工具注册 + stdio/HTTP/direct 三种 context | 21 个工具 |
| `packages/local-store` | 本地 SQLite（better-sqlite3） | 1509 行，与 direct.ts 双实现 |
| `packages/shared-schema` | zod schema + 同步编排 + 脱敏 + 屈折匹配 | 叶子包 |
| `packages/setup` | `npx @work-learn/setup` 安装器 | 唯一公开发布包 |
| `supabase/migrations` | 19 个迁移、15 张表 | RLS 全覆盖 |

依赖方向严格单向无环：`shared-schema`（叶子）→ `local-store` / `mcp-server` → `apps/api`；`web` / `companion` / `setup` 零 workspace 依赖。

## 二、结论摘要

| 级别 | 数量 |
|------|------|
| P0 | 0 |
| P1 | 5 |
| P2 | 11 |
| P3 | 11 |

**最关键的三条**：

1. **脱敏只覆盖「保存」一条写路径**（上轮 SEC-1，仍未修）：`PATCH /api/materials/:id`、`record_practice`、`/api/sync`、`/api/import` 四条路径不做任何 `redactSecrets`，而代码注释自称脱敏是「密钥到达数据库前的最后一道关」。用户密钥/密码/绝对路径可明文落库并跨设备同步。
2. **Web 复用建议面板必然 400**（上轮 FUNC-1，仍未修）：`ReuseNudgePanel.tsx:19` 传 `limit=5`，而 `suggestReuseInputSchema` 上限 `max(1)`，zod 必拒。
3. **snooze 后的复习项永远无法完成**（本轮新发现）：`getReviewItems` 返回到期 snoozed 项，但 `markMastered` 两端都只匹配 `status='pending'`，全仓没有任何 snoozed→pending 的状态迁移，用户评分时云端 500、本地抛错。

## 三、逐条发现

### P1（严重缺陷）

#### P1-1 脱敏缺口：四条写路径绕过 `redactSecrets`（上轮 SEC-1，仍未修）

- **位置**：
  - `packages/shared-schema/src/index.ts:167-175`（`updateMaterialSchema` 无 transform，对比同文件 `:154-165` 的 `saveMaterialInputSchema` 每个文本字段都做了 `redactSecrets`）
  - `packages/shared-schema/src/index.ts:253-262`（`recordPracticeInputSchema` 无脱敏，`userAnswer` 上限 50 000 字符，实测确认）
  - `packages/shared-schema/src/index.ts:605-614`（`syncBatchInputSchema`）、`:620-630`（`portableImportSchema`）无脱敏
  - 设计承诺写在 `:150-153` 注释：「this is the last point before a leaked key or absolute path reaches the database」
- **影响**：用户粘贴到练习答案、编辑语料、离线 sync、JSON 导入中的 API key / 密码 / 私钥 / 绝对路径明文写入 Supabase 并同步到所有设备。`redaction.ts:9` 明确把绝对路径列为脱敏对象，而 `userAnswer`（50k 字符）正是用户粘贴终端输出的位置。
- **修复建议**：把 `redactSecrets` 从 schema transform 抽成独立 `redactFreeText()`，统一挂到 `updateMaterialSchema`、`recordPracticeInputSchema`、`syncBatchInputSchema`、`portableImportSchema`。

#### P1-2 Web 复用建议面板必然 400（上轮 FUNC-1，仍未修）

- **位置**：`apps/web/src/components/ReuseNudgePanel.tsx:19` 调 `fetchReuseSuggestions(session, text, 5)` → `apps/web/src/lib/api.ts:144`（默认 `limit = 5`）→ `packages/shared-schema/src/index.ts:534` `limit: z.number().int().min(1).max(1).default(1)`（实测确认 `max(1)` 仍在）
- **影响**：语料库非空、面板触发搜索时，`POST /api/reuse/suggestions` 恒返回 400，该面板功能完全不可用。
- **修复建议**：前端不传 limit（用默认 1），或后端按产品设计放宽上限。

#### P1-3 snooze 到期的复习项永远无法完成（本轮新发现）

- **位置**：
  - 云端：`packages/mcp-server/src/direct.ts:509` `getReviewItems` 返回 `.in("status", ["pending", "snoozed"])` 且 `due_at <= now`；同文件 `:517-545` `markMastered` 的 select 与两处 update 均只匹配 `.eq("status", "pending")`
  - 本地：`packages/local-store/src/index.ts:635`（队列含 snoozed）vs `:937-952`（`markMastered` 只匹配 `status = 'pending'`）
  - 全仓 grep `snoozed`（`direct.ts` / `local-store` / `apps/web` / `shared-schema` / `supabase/migrations`）确认**没有任何 snoozed→pending 迁移路径**，迁移 `018` 的 `set_updated_at()` 触发器也不涉及 status
- **影响**：用户 snooze 一条复习项 → 到期后它重新出现在复习队列（Web「每日复习」与 MCP `get_review_items`）→ 点击评分/调用 `mark_mastered` 时：云端 PostgREST 0 行 → `.single()` 报错 → HTTP 500「Could not complete review item」；本地抛 `Review item not found or already completed`。该复习项永久卡死（只能继续 snooze）。注意 Web 端 500 还会因 P2-6 的 HTTP 语义问题以 200 包装返回，前端难以分辨。
- **修复建议**：`markMastered` 的状态条件放宽为 `IN ('pending','snoozed')`（与 `snoozeReview` 一致），或在 `getReviewItems` 查询前把到期 snoozed 项批量翻回 pending；补一条「snooze → 到期 → 完成」的回归测试。

#### P1-4 OAuth 动态注册限流是全局计数 + fail-open，未鉴权可 DoS 新客户端接入（上轮 SEC-3，仍未修）

- **位置**：`apps/api/src/lib/oauth.ts:175-187`（`countRecentRegistrations` 对 `oauth_clients` 全表按 `created_at` 计数，无 IP/来源维度，出错 `return count ?? 0`）、`:164-165`（`REGISTRATION_MAX_PER_WINDOW = 10` / 1h）、`apps/api/src/routes/oauth.ts:47`（`/register` 无鉴权）
- **影响**：任何人滚动发送 10 个注册请求即可让全世界 1 小时内无法注册新 OAuth 客户端，远程 MCP 新用户接入中断；DB 出错时限流失效（fail-open 注释自承）。
- **修复建议**：按客户端 IP（`x-forwarded-for` / Vercel `x-real-ip`）维度计数；出错改 fail-closed 或至少告警。

#### P1-5 本地 MCP `mark_mastered` 丢弃 `grade`，SRS 评分静默退化为 good（上轮 FUNC-3，仍未修）

- **位置**：`packages/local-store/src/index.ts:1489`（`createLocalContext` 适配器 `markMastered: (reviewId) => store.markMastered(reviewId)`，丢弃第二个参数）；store 签名 `:937` `grade = "good"`；工具层 `packages/mcp-server/src/tools.ts:64-70` 明确接受 `grade: z.enum(["again","hard","good","easy"])` 并传给 `ctx.markMastered(reviewId, grade)`
- **影响**：本地优先是 README 宣称的默认形态（`server.ts:25-37` 无 token 走本地），用户在 Agent 里打 "again"/"hard"/"easy" 全部按 "good" 重排间隔，间隔重复算法失真且无任何报错。
- **修复建议**：适配器透传 `grade`（一行改动）；同理补 `searchCorpus` 的 filters（见 P2-5）。

### P2（质量 / 可维护性 / 性能 / 次级安全）

#### P2-1 CORS 反射任意 Origin 且允许 `Authorization` 头、缺 `Vary: Origin`（上轮 SEC-2，仍未修）

- **位置**：`apps/api/src/routes/mcp.ts:33-41`（`origin: (origin) => origin ?? "*"` + `allowHeaders` 含 `Authorization`）、`apps/api/src/routes/oauth.ts:21-28`（同模式）
- **影响**：本仓全部凭证是 Bearer token，浏览器不会自动附带，因此该配置不直接造成 token 失窃（比上轮评估的实际可利用性低）；但反射 + 无 `Vary: Origin` 经 Cloudflare Pages 代理缓存时存在跨 Origin 缓存污染面，且 `/api/oauth/register`、`/api/oauth/authorize` 未鉴权可被任意站点脚本化调用。属「与最小权限原则相悖」的加固缺口。
- **修复建议**：显式 allowlist（`*.pages.dev` / `*.vercel.app` / localhost）+ 强制 `Vary: Origin`。

#### P2-2 直连 Vercel 时 `x-work-learn-entry-host` 可被客户端伪造，污染 OAuth issuer 元数据（上轮 SEC-4，仍未修）

- **位置**：`apps/api/src/lib/origin.ts:24-27` 无条件信任该头；`apps/web/public/_worker.js:19-20` 只在 Pages 代理路径无条件覆盖它；直连 `work-learn-api.vercel.app` 的请求不经过 worker，Vercel 边缘不剥离自定义头。该 origin 用于 OAuth `issuer`（`routes/oauth.ts:31-44`）与 `authorization_servers`（`routes/mcp.ts:43-50`）
- **影响**：攻击者需诱导受害 MCP 客户端在请求里带自定义头才能投毒 issuer，利用前提苛刻；但「只信任 CF worker」的安全注释在直连路径上不成立。
- **修复建议**：校验请求确来自 Pages 代理（如共享密钥头），否则忽略该头回退到请求 origin。

#### P2-3 LLM 出站调用无超时 / 无中止，serverless 函数可挂到平台超时（上轮 SEC-5，仍未修）

- **位置**：`packages/shared-schema/src/index.ts:376-387`（`chatCompletion` 裸 `fetch`，无 `AbortSignal`）；调用点 `packages/mcp-server/src/direct.ts:640-645` 与 `packages/local-store/src/index.ts:755` 用裸 `catch {}` 折叠所有失败
- **影响**：`vercel.json:7` `maxDuration: 10`，LLM 端点挂起时 `/api/practice/adaptive` 与 MCP `generate_adaptive_practice` 阻塞至平台超时；三类失败（配置错/网络错/模型输出坏）被折叠成同一种静默降级。
- **修复建议**：`fetch(..., { signal: AbortSignal.timeout(8000) })`，降级日志区分原因。

#### P2-4 Companion 每 3 秒 spawn 一次 `tsx` CLI，无超时、无 in-flight 去重（上轮 SEC-7，仍未修）

- **位置**：`apps/companion/src/main.ts:232`（`setInterval(..., 3000)`）、`:28-39`（`runLearn` 只有 `close` 回调，无 timeout/kill/并发保护）
- **影响**：前台是受监控 Agent 应用期间无限循环 spawn `tsx`（冷启动数百 ms 级），慢执行时进程累积，持续消耗 CPU/电池。
- **修复建议**：加 in-flight 去重与超时 kill；或改成长驻进程/DB 直读。

#### P2-5 本地 MCP `search_corpus` 丢弃 `source`/`tag` 过滤（上轮 FUNC-2，仍未修）

- **位置**：`packages/local-store/src/index.ts:1487`（`searchCorpus: (query) => store.searchCorpus(query)`），而 store 方法 `:588` 与工具层 `tools.ts:55-57` 都支持 `{ source, tag }`
- **影响**：云端与本地两端同一 MCP 工具行为分叉；本地过滤被静默忽略，返回超集结果。
- **修复建议**：适配器透传 filters（一行改动）。

#### P2-6 PAT scope 拒绝（403）以 HTTP 200 返回（上轮 FUNC-8，仍未修）

- **位置**：`apps/api/src/app.ts:61-64` `errorResponse` 把 `status: 403` 放进**响应体**；各路由 `return c.json(errorResponse(...))` 只传一个参数（如 `:115`、`:124`、`:136`），Hono `c.json(object, status?)` 的第二参数才是 HTTP 状态码
- **影响**：只读 PAT 调写接口时，授权确实被阻止（`requireScope` throw），但客户端收到 HTTP 200 + body 里一个 `status: 403` 字段，HTTP 语义错误，监控/重试/客户端错误分支全部失灵。
- **修复建议**：`const r = errorResponse(...); return c.json({ error: r.error, details: r.details }, r.status)`。

#### P2-7 `list_intents` 已实现但未注册为 MCP 工具（上轮 FUNC-12，仍未修）

- **位置**：`packages/mcp-server/src/tools.ts` 共 21 个 `registerTool`（实测计数），无 `list_intents`；而 context（`direct.ts:409`）、REST（`app.ts:461`）、HTTP client（`http-client.ts:145`）三端均已实现
- **影响**：宿主 Agent 无法列出意图聚类，复用工作链缺一环；README 的工具清单（21 个）恰好不包含它，属「实现先于注册」的遗漏。
- **修复建议**：在 `tools.ts` 注册 `list_intents`。

#### P2-8 Skill 文档的 `record_practice` 字段与实际 schema 不符（上轮 FUNC-13，仍未修）

- **位置**：`skills/work-learn/SKILL.md:22` 仍写 `result/feedback/mistakes[]`；实际 schema 是 `exerciseType/userAnswer/isCorrect/status`（`packages/shared-schema/src/index.ts:253-262`、`tools.ts:96-108`）
- **影响**：Agent 按 Skill 文档拼参数调用 `record_practice` 会 zod 校验失败，练习记录写入失败。
- **修复建议**：更新 SKILL.md 字段清单，并把 `suggest_reuse_candidates` 补进工具列表。

#### P2-9 Web 与 Companion 零测试，根 `pnpm test` 静默跳过（上轮 TEST-1，仍未修）

- **位置**：`apps/web/package.json`、`apps/companion/package.json` 均无 `test` 脚本（实测）；根 `package.json:13` `"test": "pnpm -r test"` 跳过它们仍以 0 退出。全仓 14 个 `*.test.ts` 全部位于 api/cli/packages
- **影响**：主用户界面（19 个源文件、hooks、i18n 895 行）无任何自动化回归；本报告 P1-2/P1-3 这类用户可见缺陷正是零覆盖的直接后果。
- **修复建议**：至少给 `apps/web` 的 `lib/api.ts`、hooks 补 `node --import tsx --test` 单测；Companion 补 smoke。

#### P2-10 Web JSON 导出在语料存在孤儿（session 已删）材料时会产出无法导入的文件（本轮新发现）

- **位置**：`apps/web/src/lib/hooks/useImportExport.ts:22-40`：`sessions.set(material.session_id, { id: material.session_id, ... })`，`session_id` 为 null 时导出 `sessions` 数组混入 `{ id: null, ... }`；导入端 `packages/shared-schema/src/index.ts:623` 要求 `sessions: z.array(syncSessionSchema)`，而 `syncSessionSchema.id = z.string().min(1)`（`:399`）→ 整个导入 400。`apps/web/src/lib/api.ts:6` 的 `session_id: string` 类型声明还把 null 情况在类型层掩盖了
- **影响**：云端 `learning_materials.session_id` 是 `ON DELETE SET NULL`（迁移 `001:33`），schema 与 `importPortableData`（`direct.ts:1156-1158`）都明确支持孤儿材料；一旦用户的语料库出现孤儿（目前只能经手工删 session 或未来功能产生），Web「导出 JSON → 导入 JSON」闭环整体失败。**当前产品内尚无删除 session 的入口，故为潜伏缺陷**，评级 P2。
- **修复建议**：导出时跳过 `session_id === null` 的合成 session 条目（材料自身的 `sessionId: null` 已合法）；同时把 `api.ts` 的类型改为 `string | null`。

#### P2-11 同步写路径无事务 + Vercel `maxDuration: 10`，大批量 sync 存在部分写入与超时风险

- **位置**：`packages/mcp-server/src/direct.ts:1114-1136`（`syncToCloud` 顺序执行 9 组写，无事务，注释 `:916-919` 自承「the batch has no transaction」）；`vercel.json:7` `maxDuration: 10`；`upsertWithLww`（`:899-965`）每行 2 次 HTTP 往返（probe + write）
- **影响**：单行慢时整批拉长；大批量首次全量 sync 可能超过 10s 被平台中止。好在 upsert + LWW + tombstone 设计使重试收敛，客户端 `markSynced` 只在成功后打标，不会丢数据——属可用性风险而非正确性风险。**未实测**触发时长，仅按代码结构推断。
- **修复建议**：批量 upsert 合并行（`upsert(rows)` 一次多行）、或 `maxDuration` 提额、或 CLI 分批推送。

### P3（体验 / 规范 / 记录项）

| # | 位置 | 发现 |
|---|------|------|
| P3-1 | `apps/web/src/lib/api.ts:23` + `apps/web/src/lib/hooks/useCorpus.ts:167` | 手写类型声称 `learning_materials` 非空，Supabase 嵌入 join 可返回 null；当前有 FK cascade 兜底几乎不可达，但根因（无 `supabase gen types` 产物）仍在 |
| P3-2 | `apps/companion/src/main.ts:110-112`、`:292` | `saveConfig` 静默失败；`app.whenReady().then(...)` 无 `.catch()`，初始化异常变 unhandled rejection（上轮 QUAL-4，仍未修） |
| P3-3 | `apps/web/src/lib/hooks/useCorpus.ts` | 首次加载 effect 无 `cancelled` 守卫（搜索 effect 有），快速切换 session 存在乱序覆盖面（上轮 QUAL-4b，仍未修） |
| P3-4 | `apps/companion/src/main.ts:177`、`:271` | Electron `sandbox: false`（`contextIsolation: true` 仍在）（上轮 SEC-6，仍未修） |
| P3-5 | `apps/api/src/routes/mcp.ts:19` | 注释「The same twenty tools」与实际 21 个工具不符，文档性漂移 |
| P3-6 | `packages/mcp-server/src/server.ts:31` | stdio MCP 在「设了 token 但没设 `WORK_LEARN_API_URL`」时默认 `http://localhost:3000`；README/handoff 称默认入口已统一为 `https://work-learn.pages.dev`（`apps/cli/src/index.ts:14`、`packages/setup/src/index.ts:20` 均已改），仅此遗漏。setup 写入的 config 总带 apiUrl，故仅影响手写配置的用户 |
| P3-7 | `supabase/migrations/001:21-28` | `conversation_events` 表 + RLS 策略存在，但全仓代码 0 引用（grep 确认），属死 schema |
| P3-8 | `apps/web` 构建产物 | `index-*.js` 527.75 kB（gzip 150 kB），Vite >500 kB 警告（`pnpm build` 实测输出）；React 19 + supabase-js 单 chunk，可做 manualChunks |
| P3-9 | `apps/api/src/app.ts:56-64` | 所有 500 响应把内部错误消息（PostgREST/DB 细节）经 `details` 字段回给客户端，轻微信息泄露面 |
| P3-10 | `supabase/migrations/007` | `oauth_authorization_codes`（10 分钟过期）与 `oauth_tokens`（30 天 refresh 过期）无定期清理任务，长期累积膨胀；功能无影响 |
| P3-11 | `apps/companion/src/main.ts:155-157` | 手写 `escapeHtml` 未转义单引号（当前插入点非属性上下文，不可利用）；`data:` URL 无 CSP（上轮 QUAL-8，仍未修） |

### 复核后确认「已修复 / 不成立」的上轮条目

| 上轮条目 | 当前状态 |
|----------|----------|
| ARCH-7 Node 版本口径矛盾（20 vs 22） | **已修复**：根 `engines.node: ">=24 <25"`、`.nvmrc: 24`、`.node-version: 24.20.0`、CI node 24 一致（实测） |
| CI 不跑 lint / 无 linter（TEST-2） | 仍无 ESLint，但 `pnpm lint`（tsc）与 typecheck 在 CI 前已可本地跑通；维持上轮 P2 定位，本报告并入 P2-9 测试缺口不再单列 |

## 四、各维度评审记录（无实质问题的维度）

1. **架构与模块边界**：依赖方向单向无环，包划分清晰。遗留问题为上轮 ARCH-1（API 持久层寄居 `mcp-server/direct.ts`，service-role 绕过 RLS 靠逐语句 `user_id` 过滤兜底，实测每处都带过滤）、ARCH-2（Companion 跨 app spawn CLI 源码）、ARCH-3（web 手写第二份 REST client）。均为已知技术债，未新增越界。
2. **正确性**：见 P1-2/P1-3/P1-5/P2-5/P2-6/P2-10。其余路径（SRS 调度、屈折匹配、LWW 同步、tombstone 传播、原子 claim）有对应单测且通过。
3. **安全**：
   - **service-role key 未泄露进客户端**：grep `apps/web` / `apps/companion` / `apps/cli` / `packages/setup` / `_worker.js` 对 `SERVICE_ROLE` 零命中（实测命令输出）；service client 仅存在于 `apps/api/src/lib/supabase.ts:38-47` 与 `lib/oauth.ts:148-153`。
   - **RLS 真实生效**：15 张表在 001/006/007/010/013/015/016/017 迁移中全部 `enable row level security`（grep 实测）；OAuth 三表启用 RLS 且无任何策略 = 仅 service role 可达（纵深防御正确）；PAT 表按 select/insert/update/delete 拆策略且带 `auth.uid() = user_id`。
   - **注入**：云端全部走 PostgREST 查询构建器；唯一字符串拼接点 `searchQuestionTranslations` 的 `.or()` 使用 `orSearchTerm` 显式转义（`direct.ts:782-789`，注释说明威胁模型）；`009_material_search.sql:90` 对 `%`/`_`/`\` 转义；本地 SQLite 全部参数化（`:741` 的 `LIMIT ${...}` 插值是 zod 校验过的整数）。未发现可利用注入。
   - **XSS**：`dangerouslySetInnerHTML` / `innerHTML` 全仓 0 命中；React 自动转义；OAuth consent 的 `client_name` 服务端做了 trim + ≤100 字符 + 控制字符过滤（`lib/oauth.ts:107-115`）。
   - **认证授权**：所有业务路由先 `authenticate`（401 覆盖有测试 `app.test.ts:11-41`）；PAT/OAuth 均按 SHA-256 哈希查库、支持撤销与过期；PKCE S256 强制；授权码与 refresh token 用条件 UPDATE 原子领取防重放；`hasScope` 的「空 scope = 全权」是 legacy 兼容约定（`auth.ts:51-54`、`:60-64`），新签发 token 均有最小 `read` scope（`DEFAULT_OAUTH_SCOPE`，`lib/oauth.ts:32-42`），记录在案。
   - **其余**见 P1-1/P1-4/P2-1/P2-2/P2-3。
4. **数据模型与迁移一致性**：`tools/check-migrations.sh` 实测通过（19 个文件，仅 verb-first 命名警告 19 条，非阻塞）；迁移链 001→019 连续无跳号；代码中引用的表/列（`materialColumns`、`syncSavedExpressionColumns` 等）与迁移逐一核对一致；`search_learning_materials`（009）与 `increment_saved_expression_reuse`（015）两个 RPC 均为 `security invoker` / 默认 invoker，RLS 兜底，无越权调用面。
5. **错误处理与失败模式**：`ok()` 统一抛 DB 错误、ScopeError 映射、OAuth 原子失败路径清晰；缺口为 P2-6（HTTP 语义）、P2-3（LLM 无超时）、P3-2（Companion 吞错）、P3-9（details 泄露）。
6. **测试覆盖**：187 个测试全绿（见第六节）；缺口为 P2-9（web/companion 零测试）与上轮 TEST-3（401 清单漏 7 条写路由，实测 `app.test.ts:12-36` 仍未补）。
7. **依赖与构建健康**：`pnpm-lock.yaml` 与 workspace 配置一致；`pnpm install --frozen-lockfile` 在 CI 执行；`pnpm build` 全绿（唯一警告为 P3-8 的包体积）；native 依赖（better-sqlite3）经 `onlyBuiltDependencies` 白名单管理；**注意本机 Node 必须 24**——用 Node 22 跑测试会因 ABI 不匹配（`NODE_MODULE_VERSION 137 vs 127`）全灭，这不是仓内 bug 但 onboarding 时容易踩。
8. **性能**：除 P2-4（3s spawn 轮询）、P2-11（逐行 sync 往返 + 10s 上限）、P3-8（527 kB 单 chunk）外，未发现其他有证据的热点；搜索已用 pg_trgm GIN 索引（迁移 009）。
9. **文档与实现一致性**（抽查 10 处）：
   - README「二十一个 MCP 工具」✓ 与 `tools.ts` 实测 21 个 `registerTool` 一致；
   - README「PAT 只存哈希 / 可撤销 / scope」✓ 与 `pat.ts` + 迁移 006/011 一致；
   - README「OAuth opaque token 按哈希查库 + refresh 轮换」✓ 与 `lib/oauth.ts` 一致；
   - README「本地优先、无 token 默认本地 SQLite」✓ 与 `server.ts:25-37` 一致；
   - `docs/deployment.md` 的 bundle / `_worker.js` header / issuer 方案描述 ✓ 与代码一致；
   - `docs/feature-inventory.md:77`「GET /api/reviews 取到期 pending/snoozed 项」✓ 与 `direct.ts:509` 一致（但该行为正是 P1-3 的诱因，文档与 `markMastered` 的 pending-only 约束相互矛盾）；
   - `skills/work-learn/SKILL.md:22` ✗ `record_practice` 字段过期（P2-8）；
   - `apps/api/src/routes/mcp.ts:19` ✗「twenty tools」注释过期（P3-5）；
   - `docs/local-first-storage.md` §2.1 本地表清单只列 5 张，实际本地还有 intents/saved_expressions/reuse_events/sync_tombstones/user_settings 等（详尽度不足，非错误）；
   - handoff.md「云端 HTTP 路径与真实宿主客户端仍未验」等风险自评与代码状态一致 ✓。

## 五、验证门实际执行结果

| 命令 | 环境 | 结果 |
|------|------|------|
| `pnpm test` | **Node 24.20.0**（fnm，`PATH` 前置） | ✅ 全绿：api 57/57、cli 5/5、local-store 32/32、mcp-server 40/40、setup 5/5、shared-schema 48/48，共 187 通过 0 失败 |
| `pnpm test` | Node 22.23.4（系统默认 shell） | ❌ local-store 31/32 失败：`better_sqlite3.node was compiled against NODE_MODULE_VERSION 137, this version requires 127` —— Node 版本不符，非仓内缺陷 |
| `pnpm typecheck` | Node 24.20.0 | ✅ 8/8 包通过 |
| `pnpm lint`（= tsc --noEmit） | Node 24.20.0 | ✅ 通过（注意：web/companion 无 lint 脚本，被 `-r` 静默跳过） |
| `pnpm build` | Node 24.20.0 | ✅ 全部构建成功；唯一警告：web 单 chunk 527.75 kB > 500 kB |
| `bash tools/check-migrations.sh` | — | ✅ 19/19 通过，19 条 verb-first 命名警告（非阻塞） |

## 六、修复优先级建议

**第一梯队（建议立即，改动小收益大）**

1. P1-2：Web `fetchReuseSuggestions` 去掉 `limit=5`（一行）——恢复一个完全不可用的面板。
2. P1-3：`markMastered` 状态条件放宽到 `IN ('pending','snoozed')` + 回归测试——解除复习项永久卡死。
3. P1-5 + P2-5：本地适配器透传 `grade` 与 `filters`（两行）——恢复本地 SRS 与搜索过滤的正确性。
4. P2-6：`errorResponse` 拆 body/status 传给 `c.json`——修正 403/500 的 HTTP 语义。

**第二梯队（安全加固，按设计承诺补齐）**

5. P1-1：抽 `redactFreeText()` 统一挂到 update/record_practice/sync/import 四条路径。
6. P1-4：注册限流改按来源维度 + fail-closed。
7. P2-1 / P2-2：CORS allowlist + `Vary: Origin`；entry-host 加来源校验。
8. P2-3：LLM 调用加 `AbortSignal.timeout`。

**第三梯队（结构性，排期处理）**

9. P2-9：给 `apps/web` 补测试脚本与 hooks/api 单测，Companion 补 smoke；补 401 清单缺失的 7 条写路由（上轮 TEST-3）。
10. P2-7 / P2-8：注册 `list_intents` 工具；同步 SKILL.md 与真实 schema。
11. P2-10：导出跳过 null session 条目 + 类型改 `string | null`。
12. P2-11：sync 写路径合并多行 upsert / 分批；评估 `maxDuration` 提额。
13. P3 批：死表 `conversation_events` 评估下线、`twenty tools` 注释、stdio 默认 apiUrl、web chunk 拆分、OAuth 过期行清理任务。

---

*本报告所有行号均在基线 `fb644e1` 上逐一核对；标注「未实测」的条目仅为按代码结构的推断，其余结论均有文件证据或命令输出支撑。*

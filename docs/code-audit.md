# 项目级代码审计报告

- **审计日期**：2026-09-30
- **代码基线**：`dev` @ `ff01066`
- **范围**：架构与依赖边界 / 代码质量 / 安全 / 测试与质量保障 / 功能正确性
- **方法**：全仓只读代码评审 + 针对性抽样复核。本报告所有**高危**结论均已回到源码逐条复核确认，并在附录 A 给出证据索引。
- **严重级别**：本报告使用 **高危 / 中 / 低**，与 [audit-report.md](audit-report.md) 的 P0/P1/P2 不是同一套编号——后者是 2026-08-30 那一轮「发现即修复」的专项跟踪记录（P0/P1/P2 已全部闭环），本报告是**独立的新一轮全项目审计**，两者互补而非替代。

---

## 执行摘要

**核心结论：项目工程完成度很高（双端同步、SRS、OAuth 2.1、脱敏、RLS 全覆盖均已落地且有回归测试），当前最突出的风险不在「功能有没有」，而在三个结构性缺口：**

1. **脱敏只覆盖了「保存」这一条写路径**，编辑练习答案、同步、导入三条路径绕过它 —— 而代码注释明确宣称脱敏是「密钥到达数据库前的最后一道关」。
2. **CORS 与限流是「看起来加了、实际可绕过」**：CORS 反射任意 Origin 且允许携带 `Authorization`；OAuth 注册限流是全局计数、被 10 次请求即可耗尽，且 DB 出错时 fail-open。
3. **Web 与 Companion 两个「最贴近用户」的包零测试，而根 `pnpm test` 会静默跳过它们并以 0 退出**，因此流水线给人一种「有测试守护」的错觉。

另有一处**功能性中断**（Web 复用建议面板必然 400，见 FUNC-1），是本次审计中唯一「用户可见功能直接不可用」的缺陷。

| 级别 | 数量 | 说明 |
|------|------|------|
| 高危 | 4 | SEC-1 脱敏缺口、SEC-2 CORS、SEC-3 限流、TEST-1 Web/Companion 零测试被静默跳过；另含 FUNC-1 功能中断 |
| 中 | 11 | 架构越界 3、质量 4、安全 4 |
| 低 | 9 | 配置断层、硬编码、断言密集等 |

---

## 1. 架构与依赖

### 1.1 包 / 应用清单

| 路径 | 包名 | 入口 | workspace 依赖 |
|------|------|------|----------------|
| `apps/api` | `@work-learn/api` | `src/app.ts` / `src/server.ts` / `api/[[...route]].ts` | `mcp-server`、`shared-schema` |
| `apps/cli` | `@work-learn/cli`（bin `learn`） | `src/index.ts` | `local-store`、`shared-schema` |
| `apps/companion` | `@work-learn/companion`（Electron） | `src/main.ts` + `src/preload.ts` | 无 |
| `apps/web` | `@work-learn/web`（Vite + React 19） | `src/main.tsx` | 无 |
| `packages/local-store` | `@work-learn/local-store`（SQLite） | `src/index.ts` | `shared-schema` |
| `packages/mcp-server` | `@work-learn/mcp-server` | `http.ts` / `direct.ts` / `tools.ts` / `server.ts` / `http-client.ts` | `local-store`、`shared-schema` |
| `packages/setup` | `@work-learn/setup`（**唯一公开发布到 npm**） | `src/index.ts` | 无 |
| `packages/shared-schema` | `@work-learn/shared-schema`（叶子节点） | `src/index.ts` | 无（仅 zod） |

### 1.2 依赖方向

严格单向、**无循环依赖**：

```text
shared-schema (zod, 叶子)
   ↑                ↑
local-store ──→ mcp-server ──→ apps/api
   ↑                ↑
apps/cli ───────────┘
apps/web / apps/companion / packages/setup ：零 workspace 依赖
```

### 1.3 边界越界

| 编号 | 级别 | 发现 |
|------|------|------|
| **ARCH-1** | 中 | **API 的数据访问层寄居在 `mcp-server` 里。** `apps/api/src/app.ts:4` 从 `@work-learn/mcp-server/direct` 导入 `createDirectContext / syncToCloud / importPortableData` 等，并把 service-role client 注入进去。该 context 用 service role **绕过 RLS**，靠每个语句自带 `user_id` 过滤兜底（`packages/mcp-server/src/direct.ts:80-86`）。即：一个「传输层」包同时承担了领域逻辑 + Supabase 持久层 + 授权 scope 判定。 |
| **ARCH-2** | 中 | **Companion 跨 app 直接 spawn CLI 源码。** `apps/companion/src/main.ts:18` 用 `join(app.getAppPath(), "..", "cli", "src", "index.ts")` 拼路径再以 `tsx` 启动。这条耦合完全在模块图与 pnpm 依赖声明之外，`tsc` 和依赖分析都看不见。 |
| **ARCH-3** | 中 | **REST 客户端双写。** `apps/web/src/lib/api.ts`（约 19 KB，自行声明 `LearningMaterial` / `ReviewItem`）与 `packages/mcp-server/src/http-client.ts` 是同一批接口的第二份实现；因 web 不依赖 `shared-schema`，类型也重抄了一遍。 |
| ARCH-4 | 低 | `packages/learning-core` 与 `packages/learning-skill` 均已删除（两个目录只剩 `node_modules`，`git ls-files` 无跟踪文件），但 `docs/technical-architecture-v0.1.md:24-25` 的架构图仍列着它们 —— 文档过期（本次审计已顺手修正）。 |
| ARCH-5 | 低 | **构建产物不一致**：`local-store` / `shared-schema` / `apps/cli` / `apps/web` 继承 `noEmit: true`，其 `build`（`tsc -p`）实际不产出任何文件。`apps/cli` 声明 `bin → dist/index.js` 却编不出 dist（`apps/companion/src/main.ts:11-12` 注释直接证实了这点）。 |
| ARCH-6 | 低 | **strictness 断层**：`apps/companion/tsconfig.json` 完全不 `extends` base，自成 `NodeNext`，缺 `noUncheckedIndexedAccess` / `isolatedModules`；`apps/cli/tsconfig.json` 给 Node CLI 加了 `lib: ["ES2022","DOM"]`。 |
| ARCH-7 | 低 | **Node 版本口径矛盾**：根 `package.json` `engines.node: ">=20 <21"`、`.node-version: 20.20.2`、`.nvmrc: 20`，而 `apps/companion/src/main.ts:13-14` 注释称 better-sqlite3 按 **Node 22** 编译，`apps/api/src/lib/supabase.ts:4-12` 又为 **Node 20** 缺 `WebSocket` 做了 polyfill。`better-sqlite3` 是 native 模块，ABI 绑定具体版本，两种口径必有一个已过期。 |

### 1.4 构建、类型检查与 CI

- `tsconfig.base.json`：`strict` + **`noUncheckedIndexedAccess: true`** + `isolatedModules`，这是全仓类型安全的底子。
- CI（`.github/workflows/ci.yml`）：node 20 → `pnpm install --frozen-lockfile` → `pnpm test` → `pnpm typecheck` → `pnpm build`。**不跑 lint**（因为仓库根本没有 linter，见 TEST-2）。
- 部署：`deploy-api.yml`（esbuild 打包 + Vercel prebuilt + `/api/health`、`/api/config` 冒烟 + 405 方法路由检查）、`deploy-web.yml`（Cloudflare Pages + `! grep -rq 'localhost:30'` 同域守卫）。这两条冒烟设计得很好，是本仓质量保障的亮点。

### 1.5 运行时矩阵

| 运行时 | 位置 | 备注 |
|--------|------|------|
| Node serverless（Vercel） | `apps/api` | `vercel.json` `@vercel/node`，`maxDuration 10` |
| 浏览器（Vite + React 19） | `apps/web` | 部署到 Cloudflare Pages |
| Electron（macOS 菜单栏） | `apps/companion` | Electron ^33 |
| MCP stdio | `packages/mcp-server/src/server.ts` | 有 token 走 HTTP，否则本地 SQLite |
| MCP Streamable HTTP（无状态） | `packages/mcp-server/src/http.ts` | 每请求新建 server+transport，专供 Vercel |
| Node CLI | `apps/cli` | bin `learn`，被 Electron spawn |
| Node 安装器（npx 公开包） | `packages/setup` | `@work-learn/setup` |

---

## 2. 代码质量

### 2.1 双实现（最大技术债）

| 编号 | 级别 | 发现 |
|------|------|------|
| **QUAL-1** | 中 | `packages/mcp-server/src/direct.ts`（约 56 KB，Supabase）与 `packages/local-store/src/index.ts`（约 66 KB，SQLite）**各自完整实现了同一组约 21 个操作**：`createSession / saveMaterial / searchCorpus / getReviewItems / markMastered / generatePractice / generateAdaptivePractice / recordPractice / recordReuse / suggestReuse / clusterIntents / mergeIntents / splitIntent / listIntents …`。连**行映射函数都重复了一套**：`normalizeMaterial / normalizeQuestionRow / normalizeReview / normalizeIntent / normalizeSavedExpression / normalizeReuseEvent` vs `toMaterial / toQuestion / toReview / toIntent / toSavedExpression / toReuseEvent`。`generateAdaptivePractice` 的降级逻辑亦在两处逐字重复。**这是 SEC-1 的直接成因**——`direct.ts` 漏了编辑路径的脱敏，而本地端根本不存在该路径，没有任何共享抽象能阻止两边漂移。 |

> 说明：`shared-schema` 已下沉了纯算法（`runSync` 同步编排、词形还原、脱敏），上一轮审计的架构性结论也记录了「双实现收敛已收尾」。本次复核认为：编排层已共享，但**持久化与行映射层的重复仍在**，是剩余的主要债务。

### 2.2 类型安全

| 编号 | 级别 | 发现 |
|------|------|------|
| **QUAL-2** | 中 | **手写 DB 类型声称非空，实际可为 null。** `apps/web/src/lib/api.ts:23` 声明 `learning_materials: LearningMaterial`，但数据来源是 `packages/mcp-server/src/direct.ts:507` 的嵌入 join `select("*, learning_materials(...)")`——Supabase 在外键为空或行被 RLS 过滤时返回 `null`。消费点 `apps/web/src/lib/hooks/useCorpus.ts:167` 直接 `review.learning_materials.id`，删除语料时若任一 review 的 join 为 null 即 `TypeError`。**根因：全仓无 `supabase gen types` 产物**，手写类型与 `supabase/migrations/*.sql` 靠人工同步。 |
| QUAL-5 | 低 | `as` 类型断言密集：`local-store` 约 80 处、`direct.ts` 约 57 处、`web/lib/api.ts` 约 26 处。**正面**：全仓 `any` 极少且几乎全在测试中，`@ts-ignore` / `@ts-expect-error` **0 处**。 |

### 2.3 错误处理与并发

| 编号 | 级别 | 发现 |
|------|------|------|
| **QUAL-4** | 中 | 被吞掉的异常与未处理的 Promise：`apps/companion/src/main.ts:110-112`（`saveConfig` 静默失败 → 用户以为「自动采集」已开，重启后配置丢失）、`:220-222`（CLI 输出解析失败被吞 → 浮层永远空白且无提示）、`:292`（`app.whenReady().then(...)` **无 `.catch()`** → 初始化内任一 throw 变成 unhandled rejection，Electron 静默无 tray 无窗口）；`apps/web/src/lib/hooks/useCorpus.ts:86`（搜索失败被渲染成「没有结果」，与「真的没有」不可区分）。 |
| **QUAL-4b** | 中 | **`useCorpus.ts` 首次加载 effect 无 `cancelled` 守卫**：同一文件 `:77` 的搜索 effect 有守卫，这个没有；快速切换 session 或 `reload()` 会乱序覆盖。 |

### 2.4 硬编码与环境耦合

| 编号 | 级别 | 发现 |
|------|------|------|
| QUAL-6 | 低 | 同一个 `https://work-learn.pages.dev` 在 4 处字面量重复：`apps/web/public/_worker.js:4`、`apps/companion/src/main.ts:6`、`apps/api/src/routes/oauth.ts:138`、`packages/setup/src/index.ts:20`。均有注释说明为 fallback，属可接受但应集中管理。 |
| QUAL-7 | 低 | DDL 字符串插值：`packages/local-store/src/index.ts:348`、`:356`、`:412`（`` `PRAGMA table_info(${table})` ``、`` `TEXT NOT NULL DEFAULT '${now}'` ``）。入参均为内部常量，当前不可利用，但走的是无参数化通道。 |
| QUAL-8 | 低 | Companion 手写 HTML 转义漏了单引号（`apps/companion/src/main.ts:155-157` 只转义 `& < > "`）。当前插入点是 `<li>${...}</li>` 非属性上下文，暂不可利用；但手搓转义 + `data:` URL 加载（`:199`）无 CSP。 |

---

## 3. 安全

### 3.1 高危

#### SEC-1（高危）脱敏覆盖存在三条绕过路径 —— 密钥可明文落库

设计意图写在 `packages/shared-schema/src/index.ts:150-153` 的注释里：脱敏挂在 schema 上，因为「这是密钥或绝对路径到达数据库前的最后一道关」。但这条保证只对**保存**路径成立：

| 路径 | 证据 | 未脱敏字段 |
|------|------|-----------|
| `PATCH /api/materials/:id` | `shared-schema/src/index.ts:167-175` 的 `updateMaterialSchema` **无 transform、无 `redactSecrets`**（对比同文件 `:158-164` 的 `saveMaterialInputSchema`，每个文本字段都做了 `redactSecrets`） | `topic / explanation / usefulExpressions / corrections / vocabulary / practicePrompts` |
| `record_practice` | `shared-schema/src/index.ts:253-262` 纯 zod 无 transform | `focus`、`prompt`、以及上限 **50 000 字符** 的 `userAnswer` |
| `POST /api/sync`、`POST /api/import` | `shared-schema/src/index.ts:620-630` 的 `syncBatchInputSchema` / `portableImportSchema` 无脱敏 | 全部 material / question 文本字段 |

**为什么严重**：`redaction.ts:9` 明确把「绝对路径」当作要脱敏的机密，而 `userAnswer` 上限 50 000 字符正是用户粘贴终端输出、代码、配置的位置——这三条路径放行了它。同一文件内 20 行之外的不一致极易被误认为「已覆盖」。

**建议**：把 `redactSecrets` 从 `saveMaterialInputSchema` 的 transform 抽成独立 `redactFreeText(obj)`，统一挂在 `updateMaterialSchema`、`recordPracticeInputSchema`、`portableImportSchema`、`syncBatchInputSchema` 上，让那句注释变成真的。

#### SEC-2（高危）CORS 反射任意 Origin + 允许 `Authorization` 头 + 无 `Vary: Origin`

```ts
// apps/api/src/routes/mcp.ts:34-39
origin: (origin) => origin ?? "*",                                    // ← 任意 Origin 原样反射
allowHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id"],     // ← 允许跨域带 Bearer token
exposeHeaders: ["Mcp-Session-Id", "WWW-Authenticate"]                  // ← 页面 JS 可读
```

同一模式重复在 `apps/api/src/routes/oauth.ts:24-26`。

**为什么严重**：
1. `origin: (o) => o` 等价于「对全世界开放」，只是把通配符换成了回声——**没有任何 allowlist**。
2. `allowHeaders: ["Authorization"]` 允许跨域携带 Bearer token。
3. **没有 `Vary: Origin`**（Hono 的 CORS 中间件不自动加）。经 Cloudflare Pages 代理时，一个 Origin 的 `Access-Control-Allow-Origin` 可能被缓存后回给另一个 Origin。
4. `/api/oauth/register`、`/api/oauth/authorize` 是**完全未鉴权**端点 → 可跨域脚本化调用。

（`/api/config` 的 `origin: "*"` 是合理的，它只返回公开 anon key，不计入此项。）

**建议**：改为显式 allowlist（`*.pages.dev` + `*.vercel.app` + localhost），并强制 `Vary: Origin`。

#### SEC-3（高危）OAuth 动态注册限流是「全局」计数，不是按来源计数

```ts
// apps/api/src/lib/oauth.ts:175-187
const { count } = await admin.from("oauth_clients")
  .select("client_id", { count: "exact", head: true })
  .gte("created_at", since);   // ← 没有 client / IP 维度
return count ?? 0;             // ← 出错时返回 0，fail-open
```

阈值 `REGISTRATION_MAX_PER_WINDOW = 10` / 1 小时。

**为什么严重**：该端点**未鉴权**。任何攻击者发 10 个注册请求，就能让**全世界**在接下来 1 小时内无法注册新 OAuth 客户端 —— 远程 MCP 接入直接中断。且 `count ?? 0` 是 fail-open：DB 出错时限流失效。

**建议**：按 `client_ip` 或来源维度计数；出错时改为 fail-closed。

### 3.2 中 / 低

| 编号 | 级别 | 发现 |
|------|------|------|
| **SEC-4** | 中 | **`x-work-learn-entry-host` 在直连 Vercel 时可被伪造，从而控制 OAuth issuer。** `apps/api/src/lib/origin.ts:24-28` 无条件信任该头推导 origin。注释声称它由 CF Pages worker「无条件设置、覆盖客户端值」，但**直连 `work-learn-api.vercel.app` 的请求不经过 worker**，Vercel 边缘不剥离自定义头。同一个 `resolvePublicOrigin` 被用于生成 OAuth `issuer`（`lib/oauth.ts:33-36`）与 `authorization_servers[0]`（`routes/mcp.ts:46`）→ **OAuth 元数据可被攻击者指定**（RFC 8414 元数据投毒面）。建议服务端校验请求确实来自 Pages 代理，否则忽略该头。 |
| **SEC-5** | 中 | **LLM 出站调用无超时、无重试、无中止。** `packages/shared-schema/src/index.ts:376-387` 的 `chatCompletion` 直接 `fetch(...)`，**无 `signal` / `AbortController` / timeout**（已复核确认）。这是 Vercel serverless 内的出站调用，LLM 端点挂起 = 函数挂到平台超时，`/api/practice/adaptive` 与 MCP `generate_adaptive_practice` 全部阻塞。调用点 `local-store:755`、`direct.ts:640` 用裸 `catch {}` 兜底，把「配置错误 / 网络错误 / 模型返回垃圾」三类完全不同的失败折叠成同一种静默降级。 |
| **SEC-6** | 中 | **Electron 渲染进程 `sandbox: false`**（`apps/companion/src/main.ts:177`、`:271`，已复核）。`contextIsolation: true` 仍在，但关掉 Chromium sandbox 后渲染进程一旦被攻破即拥有主进程系统调用权限；该应用会 spawn `osascript`、读写 `userData` 配置、访问剪贴板，提权后影响面不小。 |
| **SEC-7** | 中 | **Companion 每 3 秒 spawn 一个 `tsx` CLI 进程，无超时、无并发保护。** `apps/companion/src/main.ts:232` `setInterval(..., 3000)` → `tickAgentNudge` → `runLearn(["expressions","--json","--limit","6"])` → `spawn(tsx, ...)`。只要前台是 10 个受监控应用之一就无限循环；`runLearn` 只有 `child.on("close")`，**没有 timeout、没有 kill、没有 in-flight 去重** → 进程可能累积，持续消耗 CPU / 电池。 |
| SEC-8 | 低 | `007_oauth.sql:60-63`：3 张 OAuth 表启用 RLS 但**无任何策略**。这是**正确的**纵深防御姿态（无策略 = 对 anon/authenticated 全拒），仅记录说明：误用 anon key 访问会拿到空结果而非报错。 |

### 3.3 经核查**未发现**问题的项（正面结论）

| 检查项 | 结论 |
|--------|------|
| **SQL 注入** | 全部 Supabase 调用走查询构建器（`.eq()` / `.insert()` / `.rpc()`），`direct.ts` 无字符串拼 SQL；本地 SQLite 全部 `prepare()` + `?` 占位；`009_material_search.sql:90` 对 `%` / `_` / `\` 做了转义 |
| **XSS** | `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` **全仓 0 命中**；Web 全走 React 自动转义；`client_name` 在 `lib/oauth.ts:107-115` 做了 trim + 长度 ≤100 + 控制字符过滤 |
| **RLS 覆盖** | 15 张表全部 `enable row level security`（001/006/007/010/013/015/016/017），**无遗漏** |
| **service role 绕过 RLS 的补偿** | `direct.ts:82-84` 声明「每个语句必须自带 `user_id` 过滤」；实测 `updateCloudMaterial:1292`、`deleteCloudMaterial:1297/1307`、`markMastered:520-521`、`snoozeReview:555-556` 等**都带了** `.eq("user_id", userId)` |
| **写操作鉴权** | 所有写路由先 `authenticate`；scope 检查在 `createDirectContext` 内每个方法首行 `requireScope(...)` |
| **PAT 存储** | 只存 SHA-256（`lib/pat.ts:14-15, 22`），明文仅在创建响应出现一次；token 文件 `mode: 0o600` + `chmodSync`（`packages/setup/src/agents.ts:89-95`） |
| **OAuth PKCE / 重定向** | `validateRedirectUris` 拒绝 fragment、通配符、非 https（loopback 除外）；授权码与 refresh token 均用条件 UPDATE **原子**领取，防重放 |
| **空 catch** | `catch { }` 模式 **0 命中**（仅有带注释的 intentional-empty catch，见 QUAL-4） |
| **TODO / FIXME** | 全仓 **0 命中** |
| **Web 竞态** | `useCorpus.ts:77-90`、`ReuseNudgePanel.tsx:12-28`、`ReuseCandidatePanel.tsx` 均有 `cancelled` 守卫 + debounce 清理（仅首次加载 effect 漏了，见 QUAL-4b） |

---

## 4. 测试与质量保障

| 编号 | 级别 | 发现 |
|------|------|------|
| **TEST-1** | 高危 | **Web 与 Companion 零测试，且根 `pnpm test` 静默跳过它们。** 全仓 14 个 `*.test.ts` **全部**位于 `apps/api`、`apps/cli`、`packages/local-store`、`packages/mcp-server`、`packages/setup`、`packages/shared-schema`；`apps/web` 与 `apps/companion` **根本没有 `test` 脚本**。根 `package.json:13` 是 `"test": "pnpm -r test"` → 跳过 2/6 个包但**退出码仍是 0**。Web 是主用户界面（19 KB 的 `lib/api.ts`、42 KB 的 `i18n/strings.tsx`、6 个 hooks、12 个组件），零自动化覆盖；`tsc --noEmit` 抓不到未处理 Promise、空 catch、竞态。 |
| TEST-2 | 中 | **仓库没有任何 linter**：`eslint` / `prettier` 配置文件 **0 命中**；每个包的 `"lint"` 实际是 `tsc --noEmit`（如 `apps/api/package.json:11`），CI 也不跑 lint。这直接导致本报告 QUAL-4 / SEC-5 类问题无法被自动拦截。 |
| TEST-3 | 低 | `apps/api/src/app.test.ts:12-36` 的 401 路由清单**漏了写路径**：`PATCH /api/materials/:id`、`DELETE /api/materials/:id`、`DELETE /api/question-translations/:id`、`POST /api/practice/record`、`POST /api/practice/adaptive`、`POST /api/patterns`、`GET /api/reuse/settings`。新增写路由不会有任何回归拦截。 |

> 上一轮审计（P2-4）已把 `pnpm test` 接入 CI，并新增 `scripts/run-tests.mjs`（零文件匹配即失败）——这个护栏设计是对的。但它只保护**有测试脚本的包**；TEST-1 揭示的正是护栏之外的盲区。

---

## 5. 功能正确性缺口（部分实现清单）

以下 14 项代码已存在但**行为不完整或与另一端不一致**。完整功能清单见 [feature-inventory.md](feature-inventory.md)。

| 编号 | 级别 | 缺口 |
|------|------|------|
| **FUNC-1** | **高危（功能中断）** | **Web 复用建议面板必然返回 400。** `apps/web/src/components/ReuseNudgePanel.tsx:19` 调用 `fetchReuseSuggestions(session, text, 5)`，而 `apps/web/src/lib/api.ts:144` 的默认 `limit = 5`；但 `packages/shared-schema/src/index.ts:534` 的 `suggestReuseInputSchema` 是 `limit: z.number().int().min(1).max(1).default(1)` → **上限 1**，传 5 直接 zod 校验失败。语料库有内容、用户搜索或选中 topic 时该面板必然报错。**修复方向：前端改为不传 limit（用默认 1），或后端放宽上限。** |
| FUNC-2 | 中 | 本地 MCP `search_corpus` 丢弃 `source` / `tag` 过滤：`packages/local-store/src/index.ts:1487` 只转发 `query`，而 store 方法 `:588` 本身支持 `{ source, tag }`。云端支持筛选 → 两端行为分叉。 |
| FUNC-3 | 中 | 本地 MCP `mark_mastered` 丢弃 `grade`：`packages/local-store/src/index.ts:1489` 只传 `reviewId`，store 签名 `:937` 默认 `"good"` → 本地 SRS 评分永远按 good 重排。 |
| FUNC-4 | 中 | 本地 `recordPractice` 写入成功但返回空 `id`（`packages/local-store/src/index.ts:710-731`）。 |
| FUNC-5 | 中 | 同步状态不统计 `practice_records`（`packages/shared-schema/src/sync.ts:34-46`）；Web 同步面板又只展示了后端统计的一部分。 |
| FUNC-6 | 中 | Web JSON 导出不含 reviews / intents / expressions / reuse events / practice records（`apps/web/src/lib/hooks/useImportExport.ts:20-74` 硬编码 `reviews: []`）。 |
| FUNC-7 | 中 | portable import v1 本身不含 practice records（`packages/shared-schema/src/index.ts:620-630`）。 |
| FUNC-8 | 中 | PAT scope 拒绝可能以 **HTTP 200** 返回带 `{status: 403}` 的错误体：`apps/api/src/app.ts:61-64` 构造了 403，但多数 catch 用 `c.json(errorResponse(...))` 未把它传成 HTTP status。授权本身仍阻止写入，仅 HTTP 语义不准。 |
| FUNC-9 | 中 | `suggest_reuse` 被标为 `read` scope，但会写入一条 `nudge` 事件 → 严格来说只读 token 产生了写副作用。 |
| FUNC-10 | 中 | Companion 面板「采集选中」的 IPC 无论内部复制/采集是否成功都返回 `{ok:true}`（`apps/companion/src/main.ts:346-349`）→ 面板显示成功但系统通知显示真实错误。 |
| FUNC-11 | 中 | Companion「自动采集」实为「打开一个被 `learn run` 包裹的录制终端」，**不是**跨应用自动监听。 |
| FUNC-12 | 中 | `listIntents` 在 REST 与 context 均已实现（`direct.ts:409-442`、`http-client.ts:145-150`），但 `tools.ts` **未注册**为 MCP 工具 → 宿主 Agent 无法调用 `list_intents`。 |
| FUNC-13 | 低 | Skill 文档滞后：`skills/work-learn/SKILL.md` 未列出已注册的 `suggest_reuse_candidates`；`record_practice` 描述仍用旧字段 `result/feedback/mistakes[]`，而实际 schema 是 `exerciseType/userAnswer/isCorrect/status`（`packages/mcp-server/src/tools.ts:96-108`）。 |
| FUNC-14 | 低 | Web 深浅模式**未实现**（无 theme state、无 `prefers-color-scheme`、无切换入口），`index.html:7` 只有固定 `theme-color`。 |

---

## 6. 建议修复顺序

### 第一优先（立即）

1. **FUNC-1** —— Web 复用建议面板必然 400，是唯一用户可见的功能中断；改动极小（前端不传 limit 或后端放宽上限）。
2. **SEC-1** —— 把脱敏抽成 `redactFreeText()`，补齐 `updateMaterialSchema` / `recordPracticeInputSchema` / `syncBatchInputSchema` / `portableImportSchema`。
3. **SEC-2** —— CORS 改显式 allowlist + 强制 `Vary: Origin`。
4. **SEC-3** —— 注册限流改为按来源维度，fail-open 改 fail-closed。
5. **TEST-1** —— 给 `apps/web` 补 `test` 脚本（`node --import tsx --test`），至少覆盖 `lib/api.ts` 与 6 个 hooks；Companion 至少补 smoke。

### 第二优先（近期）

6. **ARCH-1** —— 把 `direct.ts` 的数据访问层从 `mcp-server` 抽回 `apps/api`（或新建 `packages/store-cloud`），让「传输层」不再持有持久层。
7. **SEC-4 / SEC-5 / SEC-7** —— 校验 entry-host 来源；LLM 调用加 `AbortSignal.timeout`；Companion 轮询加超时与 in-flight 去重。
8. **FUNC-2 / FUNC-3 / FUNC-8** —— 补齐本地适配器丢的参数、修正 403 的 HTTP 语义。
9. **QUAL-4 / QUAL-4b** —— 补 `whenReady().catch()`、区分「搜索失败」与「无结果」、给首次加载 effect 加 `cancelled` 守卫。

### 第三优先（计划）

10. **QUAL-2** —— 引入 `supabase gen types typescript` 产物，消灭手写 DB 类型。
11. **TEST-2** —— 引入 ESLint（当前 `lint` 只是 `tsc` 的别名，抓不到本报告 QUAL-4 / SEC-5 类问题），并在 CI 中执行。
12. **ARCH-5 / ARCH-6 / ARCH-7** —— 统一构建产物、`companion` tsconfig 继承 base、收敛 Node 版本口径。
13. **QUAL-1** —— 双实现的行映射层收敛（可先共享 `normalize*`/`to*` 映射，再谈操作层）。
14. **FUNC-4 ~ FUNC-14** —— 按功能优先级逐项收尾。

---

## 附录 A：审计证据索引

本次审计中**经复核确认**的关键证据（其余条目来自全仓只读评审，行号同样可回溯）：

| 结论 | 证据 |
|------|------|
| 前端单体已拆分 | `apps/web/src/main.tsx` **181 行**；`apps/web/src/components/` 12 个组件、`lib/hooks/` 6 个 hooks |
| `learning-core` 已删除 | `packages/learning-core` 目录仅剩 `node_modules` |
| 脱敏缺口 | `packages/shared-schema/src/index.ts:158-164`（有）vs `:167-175`（无） |
| CORS 反射 | `apps/api/src/routes/mcp.ts:34-39`、`apps/api/src/routes/oauth.ts:24-26` |
| 限流全局计数 + fail-open | `apps/api/src/lib/oauth.ts:175-187`（`return count ?? 0`） |
| 本地适配器丢参数 | `packages/local-store/src/index.ts:1487`（`searchCorpus` 丢 filter）、`:1489`（`markMastered` 丢 grade）、`:937`（默认 `"good"`） |
| FUNC-1 必然 400 | `ReuseNudgePanel.tsx:19` → `lib/api.ts:144`（`limit = 5`）→ `shared-schema/src/index.ts:534`（`max(1)`） |
| MCP 工具 21 个、无 `list_intents` | `packages/mcp-server/src/tools.ts` 内 `registerTool("...")` 计数 21；`list_intents` 0 命中 |
| LLM 无超时 | `packages/shared-schema/src/index.ts:376-387` 内 `fetch` 无 `signal`（全文件 `AbortController`/`timeout` 0 命中） |
| Companion sandbox / 轮询 | `apps/companion/src/main.ts:177`、`:271`（`sandbox: false`）、`:232`（`setInterval(..., 3000)`）、`:292`（`whenReady().then` 无 catch） |
| 手写类型非空假设 | `apps/web/src/lib/api.ts:23`、消费点 `apps/web/src/lib/hooks/useCorpus.ts:167` |
| 首次加载无守卫 | `apps/web/src/lib/hooks/useCorpus.ts` 内 `cancelled` 仅出现在 `:77-90`（搜索 effect） |
| 测试分布 | 14 个 `*.test.ts`，路径全部在 `apps/api`、`apps/cli`、`packages/*`；`apps/web`、`apps/companion` 0 个 |
| 规模基线 | 51 处路由注册（`app.ts` 33、`oauth.ts` 11、`pats.ts` 5、`mcp.ts` 2）；19 个 migration 文件；15 张表；21 MCP 工具；15 个 CLI 命令 |

## 附录 B：本次审计未覆盖 / 需人工验证项

- 各真实 Agent 客户端（Claude Desktop / Codex / Cursor / MCP Inspector）的远程 MCP **OAuth 实测**——需真实客户端，代码评审无法替代。
- `refresh_token` 过期 / 吊销后的客户端行为（应静默重授权）。
- 生产环境 Supabase 的 RLS 实际执行效果（本报告核对的是 migration 源码）。
- `better-sqlite3` 在非 macOS 平台的编译与运行。
- 性能压测（同步大批次、搜索大数据量）。

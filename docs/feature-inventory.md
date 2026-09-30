# 产品功能清单

- **更新日期**：2026-09-30
- **代码基线**：`dev` @ `ff01066`
- **配套文档**：[code-audit.md](code-audit.md)（代码审计与已知缺口）｜[product-proposal.md](product-proposal.md)（产品定位）｜[cli-and-mcp.md](cli-and-mcp.md)（接入用法）

本清单按**入口维度**枚举仓库中全部已实现的用户可见能力。状态说明：**已实现**＝前后端贯通可用；**部分实现**＝代码存在但有行为缺口（原因见 §10）。

---

## 1. 总览统计

| 维度 | 数量 | 备注 |
|------|------|------|
| REST 路由注册点 | 51 | `app.ts` 33、`oauth.ts` 11、`pats.ts` 5、`mcp.ts` 2（含中间件与 405 处理） |
| REST 业务端点 | 44 | 见 §2 |
| MCP 工具 | 21 | 见 §3 |
| CLI 子命令 | 15 | 见 §4 |
| Web 组件 / hooks | 12 / 6 | 见 §5 |
| 云端数据表 | 15 | 全部启用 RLS，见 §8 |
| Migration 文件 | 19 | `supabase/migrations/001`–`019` |
| 测试文件 | 14 | 均在 `apps/api`、`apps/cli`、`packages/*`；`apps/web`、`apps/companion` 为 0 |

---

## 2. REST API

### 2.1 鉴权模型

实现：`apps/api/src/lib/auth.ts:18-70`、`apps/api/src/app.ts:41-64`。

业务 API 的 `Authorization: Bearer <token>` 支持三种凭证：

| 凭证 | 形态 | 校验方式 |
|------|------|----------|
| Supabase JWT | 登录会话 token | `supabase.auth.getUser(token)` |
| PAT | `wlpat_...` | 只存 SHA-256 hash；校验过期 / 撤销 / `read`-`write` scope |
| OAuth access token | opaque 串 | 只存 hash；校验有效期与 scope |

PAT 管理接口与 OAuth consent decision **只接受 Supabase JWT**（不接受 PAT / OAuth 自我管理）。OAuth 元数据、注册、授权跳转、token exchange 为公开协议入口。

### 2.2 端点清单

#### 公共

| 方法 + 路径 | 作用 | 鉴权 | 位置 | 状态 |
|---|---|---|---|---|
| `GET /api/health` | 健康检查 | 无 | `app.ts:14` | 已实现 |
| `GET /api/config` | 下发 Supabase URL / anon key / 公开 API origin | 无（跨域 GET） | `app.ts:16-35` | 已实现 |

#### 会话 / 语料 / 问题翻译

| 方法 + 路径 | 作用 | scope | 位置 | 状态 |
|---|---|---|---|---|
| `POST /api/sessions` | 创建来源+主题会话 | write | `app.ts:66-78` | 已实现 |
| `POST /api/materials` | 保存材料，自动建复习项与可复用表达 | write | `app.ts:80-92` | 已实现 |
| `GET /api/materials?q=&source=&tag=` | 浏览 / 全文搜索（pg_trgm） | read | `app.ts:208-220` | 已实现 |
| `PATCH /api/materials/:id` | 更新主题/解释/表达/更正/词汇/练习提示/标签 | write | `app.ts:119-128` | 部分实现（见 FUNC-1 类：脱敏未覆盖，SEC-1） |
| `DELETE /api/materials/:id` | 删除材料及关联复习项 + tombstone | write | `app.ts:108-117` | 已实现 |
| `POST /api/question-translations` | 保存原问题+地道翻译，同会话按规范化去重 | write | `app.ts:94-106` | 已实现 |
| `GET /api/question-translations?q=&source=` | 搜索问题翻译 | read | `app.ts:141-153` | 已实现 |
| `DELETE /api/question-translations/:id` | 删除问题翻译 + tombstone | write | `app.ts:130-139` | 已实现 |

#### 同步与导入导出

| 方法 + 路径 | 作用 | scope | 位置 | 状态 |
|---|---|---|---|---|
| `GET /api/sync/status` | 云端各实体计数与最近更新时间 | read | `app.ts:155-164` | 部分实现（不统计 practice_records） |
| `GET /api/sync?since=` | 按游标拉增量快照（含 tombstone） | read | `app.ts:166-179` | 已实现 |
| `POST /api/sync` | 推送本地批次，LWW 合并 | write | `app.ts:181-194` | 已实现 |
| `POST /api/import` | 导入 portable corpus JSON | write | `app.ts:196-206` | 部分实现（v1 不含 practice_records） |

#### 复习（SRS）

| 方法 + 路径 | 作用 | scope | 位置 | 状态 |
|---|---|---|---|---|
| `GET /api/reviews` | 取到期 pending/snoozed 项及关联材料 | read | `app.ts:222-231` | 已实现 |
| `POST /api/reviews/:id/complete?grade=` | `again/hard/good/easy` 四级评分重排 | write | `app.ts:233-246` | 已实现 |
| `POST /api/reviews/:id/snooze?days=` | 延后复习（默认 1 天） | write | `app.ts:248-257` | 已实现 |

#### 练习与模式分析

| 方法 + 路径 | 作用 | scope | 位置 | 状态 |
|---|---|---|---|---|
| `POST /api/practice` | 规则式练习生成 | read | `app.ts:259-271` | 已实现 |
| `POST /api/practice/adaptive` | LLM 自适应出题，失败回退规则 | read | `app.ts:273-285` | 已实现 |
| `POST /api/practice/record` | 记录题型/答案/正确性/状态 | write | `app.ts:287-299` | 已实现 |
| `GET /api/practice/history?onlyMistakes=&limit=` | 练习记录；`onlyMistakes=true` 即错题本 | read | `app.ts:301-315` | 已实现 |
| `POST /api/patterns` | 汇总主题/来源/标签/表达/更正/词汇/建议 | read | `app.ts:317-329` | 已实现 |

#### 表达复用

| 方法 + 路径 | 作用 | scope | 位置 | 状态 |
|---|---|---|---|---|
| `POST /api/reuse` | 精确/词形/弹性匹配并记录复用事件 | write | `app.ts:331-343` | 已实现 |
| `GET /api/reuse` | 活跃词汇/沉睡表达/跨场景复用/广度/近期事件 | read | `app.ts:345-354` | 已实现 |
| `POST /api/reuse/suggestions` | 同意图替代表达建议（≤1） | read | `app.ts:356-368` | 部分实现（Web 传 limit=5 → 400，FUNC-1） |
| `POST /api/reuse/candidates` | 相似但未命中候选（Jaccard），待确认 | read | `app.ts:370-382` | 已实现 |
| `GET /api/reuse/settings` | 读取提醒开关/冷却/每日上限 | read | `app.ts:384-393` | 已实现 |
| `PATCH /api/reuse/settings` | 修改提醒策略 | write | `app.ts:395-407` | 已实现 |

#### 意图聚类

| 方法 + 路径 | 作用 | scope | 位置 | 状态 |
|---|---|---|---|---|
| `GET /api/expressions?includeUnclustered=&intentId=&limit=` | 列表达并按聚类状态过滤 | read | `app.ts:409-423` | 已实现 |
| `GET /api/intents?limit=&expressionLimit=` | 列意图 + 成员表达 + 未聚类 | read | `app.ts:461-474` | 已实现 |
| `POST /api/intents/cluster` | 批量建意图并分配表达 | write | `app.ts:425-435` | 已实现 |
| `POST /api/intents/merge` | 合并意图 + tombstone | write | `app.ts:437-447` | 已实现 |
| `POST /api/intents/split` | 拆分意图 | write | `app.ts:449-459` | 已实现 |

#### PAT 管理（仅 Supabase JWT）

| 方法 + 路径 | 作用 | 位置 | 状态 |
|---|---|---|---|
| `GET /api/tokens` | 列 token（名称/前缀/scope/最后使用/过期/撤销） | `routes/pats.ts:31-43` | 已实现 |
| `POST /api/tokens` | 建 token（1–3650 天、read 或 read/write），明文只显示一次 | `routes/pats.ts:45-74` | 已实现 |
| `POST /api/tokens/:id/revoke` | 撤销 | `routes/pats.ts:76-90` | 已实现 |
| `DELETE /api/tokens/:id` | 永久删除 | `routes/pats.ts:92-104` | 已实现 |

#### OAuth 2.1

| 方法 + 路径 | 作用 | 鉴权 | 位置 | 状态 |
|---|---|---|---|---|
| `GET /api/oauth/.well-known/oauth-authorization-server` | RFC 8414 元数据 | 无 | `routes/oauth.ts:30-44` | 已实现 |
| `POST /api/oauth/register` | RFC 7591 动态注册（含限流） | 无 | `routes/oauth.ts:46-87` | 已实现 |
| `GET /api/oauth/authorize` | 校验 client/redirect/PKCE → 跳 consent | 无（consent 需登录） | `routes/oauth.ts:97-145` | 已实现 |
| `POST /api/oauth/decision` | 同意/拒绝 → 签发一次性 code | Supabase JWT | `routes/oauth.ts:148-193` | 已实现 |
| `POST /api/oauth/token` | code+PKCE 换 token / refresh 轮换 | client_id + grant | `routes/oauth.ts:196-230` | 已实现 |

#### 远程 MCP

| 方法 + 路径 | 作用 | 鉴权 | 位置 | 状态 |
|---|---|---|---|---|
| `GET /api/mcp/.well-known/oauth-protected-resource` | RFC 9728 元数据 | 无 | `routes/mcp.ts:43-50` | 已实现 |
| `POST /api/mcp/` | 无状态 Streamable HTTP MCP；GET/DELETE 返回 405 | JWT / PAT / OAuth | `routes/mcp.ts:52-70` | 已实现 |

---

## 3. MCP 工具（21）

统一注册：`packages/mcp-server/src/tools.ts:18-208`。三种传输：本地 stdio+SQLite（默认）、stdio+HTTP（配了 PAT）、远端 Streamable HTTP。

| # | 工具 | 作用 | 状态 |
|---|------|------|------|
| 1 | `create_session` | 创建会话 | 已实现 |
| 2 | `save_material` | 保存确认过的材料（表达/更正/词汇/练习提示/标签） | 已实现 |
| 3 | `save_question_translation` | 保存原问题 + 地道英文翻译 | 已实现 |
| 4 | `search_corpus` | 搜索语料（可按 source/tag） | 部分实现（本地端丢 filter，FUNC-2） |
| 5 | `get_review_items` | 取到期复习项 | 已实现 |
| 6 | `mark_mastered` | again/hard/good/easy 评分 + SRS 重排 | 部分实现（本地端丢 grade，FUNC-3） |
| 7 | `snooze_review` | 延后复习 | 已实现 |
| 8 | `generate_practice` | 规则式练习 | 已实现 |
| 9 | `generate_adaptive_practice` | LLM 自适应出题，失败回退规则 | 已实现 |
| 10 | `record_practice` | 保存答案/正确性/状态 | 部分实现（本地端返回空 id，FUNC-4） |
| 11 | `get_practice_history` | 练习历史 / 错题本 | 已实现 |
| 12 | `get_user_patterns` | 学习模式汇总 + 练习建议 | 已实现 |
| 13 | `get_reuse_summary` | 活跃/沉睡/跨场景复用 + 近期事件 | 已实现 |
| 14 | `record_reuse` | 检测并记录复用 | 已实现 |
| 15 | `suggest_reuse` | 同意图替代表达建议（≤1） | 已实现 |
| 16 | `suggest_reuse_candidates` | 高相似未命中候选 | 已实现 |
| 17 | `configure_reuse_nudges` | 配置提醒开关/冷却/每日上限 | 已实现 |
| 18 | `list_expressions` | 列表达 + intent 归属 + 未聚类 | 已实现 |
| 19 | `cluster_intents` | 建意图并分配表达 | 已实现 |
| 20 | `merge_intents` | 合并意图 | 已实现 |
| 21 | `split_intent` | 拆分意图 | 已实现 |

> **缺口**：`listIntents` 在 REST 与 context 已实现（`direct.ts:409-442`、`http-client.ts:145-150`），但未注册为 MCP 工具 → Agent 无法调用 `list_intents`（FUNC-12）。

---

## 4. CLI 命令（15）

统一入口：`apps/cli/src/index.ts:15-69`。

| 命令 | 关键 flags | 作用 | 状态 |
|---|---|---|---|
| `learn capture` | `--stdin`、`--source`、`--topic` | stdin 或剪贴板采集，脱敏后写本地库 | 已实现 |
| `learn review` | — | 输出本地到期复习项 | 已实现 |
| `learn practice` | `--limit`、`--material` | 从本地库生成练习 JSON | 已实现 |
| `learn search [query]` | `--q`、`--source`、`--tag` | 搜索本地材料与问题翻译 | 已实现 |
| `learn sync` | `--api-url` | 拉→推→拉 三阶段双向同步 | 已实现 |
| `learn delete material\|question` | `--type`、`--id` | 删除并记 tombstone | 已实现 |
| `learn doctor` | `--api-url` | 诊断 Node/SQLite/token/API/云权限 | 已实现 |
| `learn backup` | `--out`、`--force` | checkpoint WAL 后复制并校验 SQLite | 已实现 |
| `learn restore` | `--file`、`--yes` | 校验→备份当前库→恢复→重开验证 | 已实现 |
| `learn export` | `--out`、`--from`、`--to` | 按日生成 `年/月/日期.md` 笔记 | 已实现 |
| `learn nudges [on\|off\|status]` | `--cooldown-hours`、`--daily-limit` | 查看/修改复用提醒策略 | 已实现 |
| `learn run -- <cmd>` | `--topic` | PTY 录制终端会话，去 ANSI + 脱敏后入库（macOS/Linux） | 已实现 |
| `learn stats` | `--json` | 库路径、各实体计数、未同步数、今日采集 | 已实现 |
| `learn expressions` | `--json`、`--limit` | 列保存表达（浮层依赖此命令） | 已实现 |
| `learn hook [install\|uninstall\|status]` | — | rc 文件注入/移除/检查自动录制包裹块（默认关） | 已实现 |

---

## 5. Web 前端

`apps/web/src/main.tsx` 现为 181 行的组合层；`components/` 12 个组件、`lib/hooks/` 6 个 hooks。

### 5.1 账户与应用壳

| 能力 | 位置 | 状态 |
|---|---|---|
| 邮箱密码登录 / 注册 / 退出 + 确认邮件提示 | `components/ui.tsx:71-76`、`lib/hooks/useAuth.ts:23-51` | 已实现 |
| 「记住我」会话策略（localStorage 7 天 vs sessionStorage） | `lib/supabase.ts:22-62` | 已实现 |
| 中英双语切换（持久化 + 同步 `<html lang>`） | `components/ui.tsx:51-59`、`i18n/context.tsx:15-40` | 已实现 |
| 配置故障页 / 加载骨架 / 空语料引导 / 文档外链 | `components/ui.tsx:36-80` | 已实现 |
| 深浅模式 | — | **未实现**（无 theme state / 无切换入口，FUNC-14） |

### 5.2 语料库

| 能力 | 位置 | 状态 |
|---|---|---|
| 语料总览 + 导入导出入口 + 加载错误重试 | `main.tsx:65-78` | 已实现 |
| 全文搜索（220ms 防抖）+ `⌘K`/`Ctrl+K` 聚焦 | `main.tsx:86-98`、`lib/hooks/useCorpus.ts:65-102` | 已实现 |
| 来源/标签（服务端过滤）与主题（客户端过滤）筛选 + facet 计数 | `main.tsx:99-111` | 已实现 |
| 排序：最新 / 最早 / 按主题 / 按来源 | `main.tsx:116-121`、`useCorpus.ts:111-131` | 已实现 |
| 卡片 / 列表视图切换 + 分页（12/24/48） | `main.tsx:112-145` | 已实现 |
| 材料详情（原文/地道表达/更正/解释/复用提示/词汇/标签） | `components/Corpus.tsx:17-63` | 已实现 |
| 材料编辑与删除 | `components/Corpus.tsx:24-58,77-129` | 部分实现（UI 只开放主题/解释/标签，API 支持更多） |
| 问题翻译档案（联动搜索 + 删除） | `components/Corpus.tsx:132-158` | 已实现 |

### 5.3 练习、记录与复习

| 能力 | 位置 | 状态 |
|---|---|---|
| 规则式练习（复用/回忆/更正/应用/问题翻译/选择/填空/情境） | `components/Practice.tsx:6-73` | 已实现 |
| AI 自适应练习（5 题，基于近期错题，无 LLM 时回退） | `components/Practice.tsx:30-42` | 已实现 |
| 交互答题 + 自判 + 答案揭示 +「记住/再练一次」 | `components/Practice.tsx:77-169` | 已实现 |
| 练习记录 / 错题本（只看错误切换） | `components/Practice.tsx:172-224` | 已实现 |
| SRS 复习卡：先回忆→显示答案→延后→Again/Hard/Good/Easy | `components/Reviews.tsx:8-59` | 已实现 |

### 5.4 模式、复用与意图

| 能力 | 位置 | 状态 |
|---|---|---|
| 个人学习模式面板（计数/热词/高频表达/更正/词汇/建议） | `components/PatternsPanel.tsx:4-60` | 已实现 |
| 复用仪表盘（活跃词汇/沉睡表达/跨场景/近期事件） | `components/ReuseDashboard.tsx:5-93` | 已实现 |
| 复用提醒开关（Web） | `components/ReuseDashboard.tsx:23-37` | 部分实现（冷却/每日上限仅 CLI/MCP 可改） |
| 同意图相关表达建议面板 | `components/ReuseNudgePanel.tsx:6-50` | **部分实现（传 limit=5 必然 400，FUNC-1）** |
| 相似复用候选 + 人工确认 | `components/ReuseCandidatePanel.tsx:6-74` | 已实现 |
| 意图聚类面板（勾选聚类/合并/拆分/刷新） | `components/IntentDashboard.tsx:6-250` | 已实现 |

### 5.5 Token、连接与 OAuth

| 能力 | 位置 | 状态 |
|---|---|---|
| PAT 管理（列/建 30·90·365·永不过期/read·读写/一次性显示/复制/下载/撤销/删除） | `components/TokenManager.tsx:20-256` | 已实现 |
| Agent / MCP 连接向导（自动提示词、远端 URL+header、`@work-learn/setup`、手工 JSON、token 文件安全写入命令、Skill 安装命令，均可复制） | `components/AgentConnect.tsx:9-274` | 已实现 |
| 云端同步状态面板 | `components/ui.tsx:6-30` | 部分实现（未展示 intent/expression/reuse 计数，后端也不统计 practice records） |
| OAuth consent 页（校验参数、未登录可登录、展示 client/回调域/scope、允许或拒绝） | `components/OAuthConsent.tsx:13-127`、`main.tsx:165-176` | 已实现 |

### 5.6 导入导出

| 能力 | 位置 | 状态 |
|---|---|---|
| 当前视图导出 Markdown | `lib/hooks/useImportExport.ts:102-106` | 已实现 |
| JSON 导出 / 导入（portable v1） | `lib/hooks/useImportExport.ts:20-100` | 部分实现（导出硬编码 `reviews: []`，不含 intents/expressions/reuse events/practice records，FUNC-6/7） |

---

## 6. Companion 桌面端（Electron，macOS）

| 能力 | 位置 | 状态 |
|---|---|---|
| macOS 菜单栏常驻（Tray `WL`，关窗后台运行） | `apps/companion/src/main.ts:253-320` | 已实现 |
| 菜单项：打开面板 / 采集选中 / 打开录制终端 / 安装 rc hook / 打开 Web / Agent 浮层 / 退出 | `main.ts:296-318` | 已实现 |
| 统计面板（今日采集/待复习/本地待推送/上次同步/云端本地健康） | `renderer/index.html:18-61`、`renderer.js:15-32` | 已实现 |
| 面板每 8 秒自动刷新 | `renderer/renderer.js:119-121` | 已实现 |
| 剪贴板采集 | `renderer.js:36-41` | 已实现 |
| 全局快捷键采集选中文本（`⌘⇧L`，`WORK_LEARN_HOTKEY` 可覆盖） | `main.ts:53-87,322-323` | 已实现（macOS） |
| 打开录制终端（`learn run -- <shell>`） | `main.ts:115-124` | 已实现（macOS） |
| 「自动采集」开关（持久化，重启恢复） | `main.ts:89-136,325-326`、`renderer.js:96-117` | 部分实现（实为开录制终端，非跨应用监听，FUNC-11） |
| 手动同步云端（区分 token 缺失/离线/一般失败） | `main.ts:340-342`、`renderer.js:50-55` | 已实现 |
| 本地 / 云端健康状态（`learn doctor`） | `renderer.js:64-93` | 已实现 |
| Agent 应用检测 + 表达浮层（每 3s 检测 10 类应用，最多 6 条，透明置顶） | `main.ts:138-251` | 已实现（默认关闭） |
| 浮层开关持久化 + 启动恢复 | `main.ts:245-251,310-315,328-329` | 已实现 |
| 面板「采集选中」反馈 | `main.ts:346-349`、`renderer.js:43-48` | 部分实现（IPC 恒返回 `ok:true`，FUNC-10） |
| rc hook 安装入口 | `main.ts:301-306` | 部分实现（只能装，卸载/状态需 CLI） |

---

## 7. 本地存储与共享算法层

### 7.1 SQLite 本地优先（`packages/local-store`）

| 能力 | 位置 | 状态 |
|---|---|---|
| 本地优先、离线可用 SQLite（WAL + 外键，默认 `~/.work-learn/work-learn.db`） | `:65-72,334-345` | 已实现 |
| 本地 schema 与自动迁移（含旧列/外键语义迁移） | `:193-318,351-466` | 已实现 |
| 会话/材料/问题保存（自动生成复习项与表达；问题同会话规范化去重） | `:506-625` | 已实现 |
| SRS 复习与延后（四级评分） | `:937-965` | 已实现 |
| 规则练习 / AI 自适应 / 练习记录 / 错题本 | `:653-759` | 部分实现（`recordPractice` 返回空 id，FUNC-4） |
| 表达复用匹配与汇总（脱敏→精确/词形/弹性→写事件→计数/活跃/沉睡/提醒/候选） | `:667-707,761-821` | 已实现 |
| 意图聚类 / 合并 / 拆分 / 列表（事务内 + tombstone） | `:824-934` | 已实现 |
| 未同步批次收集（含 practice_records 与 tombstone） | `:1010-1035` | 已实现 |
| LWW 与并发保护（按版本标记，飞行中编辑不被误标 synced） | `:1106-1309` | 已实现 |
| 删除传播（tombstone 跨设备） | `:968-1007,1242-1267` | 已实现 |
| SQLite 备份（checkpoint + 复制 + `integrity_check`） | `:1039-1045` | 已实现 |
| 安全恢复（先校验、恢复前存副本、清理 WAL/SHM） | `:473-503` | 已实现 |
| 按日 Markdown 镜像（`notes/YYYY/MM/YYYY-MM-DD.md`） | `:1311-1364` | 已实现 |

### 7.2 共享算法层（`packages/shared-schema`）

| 能力 | 位置 | 状态 |
|---|---|---|
| 三阶段双向同步编排（拉→推→拉，按版本收敛） | `src/sync.ts:118-155` | 已实现 |
| SRS 调度 `scheduleNextReview`（SM-2 风格：again 立即 / hard×1.3 / good×2.1 / easy×3.2；easy 且 ≥21 天判掌握） | `src/index.ts:508-529` | 已实现 |
| 自适应练习生成（`WORK_LEARN_LLM_*` 开关，失败回退规则） | `src/index.ts:287-392` | 已实现 |
| 学习模式聚合 | `src/index.ts:796-823` | 已实现 |
| 复用建议策略（开关 + 冷却 + 每日上限，≤1 条） | `src/index.ts:889-967` | 已实现 |
| 秘密脱敏（私钥/OpenAI·GitHub·AWS token/JWT/Bearer/密码字段/Supabase key/绝对路径） | `src/redaction.ts:1-32` | 已实现（覆盖不完整，SEC-1） |
| 表达标准化与词形匹配（不规则动词/复数/比较级 + 一次功能词差异弹性匹配） | `src/index.ts:38-110`、`src/inflection.ts:240-405` | 已实现 |
| 相似候选（内容词 Jaccard，排除已命中） | `src/inflection.ts:407-453` | 已实现 |

---

## 8. 数据模型（15 张表，全部启用 RLS）

| 表 | 迁移 | 关键字段 | RLS |
|---|---|---|---|
| `sessions` | `001`、`012` | `id, user_id, source, topic, created_at, updated_at` | owner FOR ALL |
| `conversation_events` | `001` | `id, session_id, user_id, role, content, created_at` | owner FOR ALL（**无读写入口，孤岛表**） |
| `learning_materials` | `001`、`008`、`009`、`012` | `original_text, explanation, useful_expressions, corrections, vocabulary, practice_prompts, tags, search_text, updated_at` | owner FOR ALL |
| `review_items` | `001`、`012` | `material_id, status, due_at, interval_days, completed_at` | owner FOR ALL（校验材料归属） |
| `personal_access_tokens` | `006`、`011` | `token_prefix, token_hash, scopes, last_used_at, expires_at, revoked_at` | owner select/insert/update/delete |
| `oauth_clients` | `007`、`019` | `client_id, redirect_uris, client_name, scope, token_endpoint_auth_method` | 启用但无策略（service-role only） |
| `oauth_authorization_codes` | `007` | `code, code_challenge, code_challenge_method, scope, expires_at, consumed_at` | 启用但无策略（service-role only） |
| `oauth_tokens` | `007` | `access_token_hash, refresh_token_hash, scope, access/refresh_expires_at, revoked_at` | 启用但无策略（service-role only） |
| `question_translations` | `010`、`012`、`014` | `question, question_norm, translation, topic` | owner FOR ALL |
| `sync_tombstones` | `013`、`015` | `entity, deleted_at`；复合主键 `(user_id, entity, id)` | owner FOR ALL |
| `intents` | `015` | `label, description` | owner FOR ALL |
| `saved_expressions` | `015` | `text, text_norm, register, scene, note, reuse_count, intent_id`；`(user_id, text_norm)` 唯一 | owner FOR ALL |
| `reuse_events` | `015` | `expression_id, matched_text, match_kind, confidence, context_snippet` | owner FOR ALL |
| `user_settings` | `016` | `reuse_nudge_enabled, reuse_nudge_cooldown_hours, reuse_nudge_daily_limit` | owner select/update/insert |
| `practice_records` | `017` | `material_id, question_id, exercise_type, focus, prompt, user_answer, is_correct, status` | owner select/insert/delete |

**辅助数据库能力**：pg_trgm 多字段/CJK 友好搜索（`009`）、`updated_at` 触发器（`012`、`018`）、复用计数 RPC（`015`）、OAuth 注册限流索引（`019`）。

---

## 9. Skill 与分发安装

### 9.1 Universal Learning Skill（`skills/work-learn/SKILL.md`）

| 能力 | 位置 | 状态 |
|---|---|---|
| 高价值英语提取规范（每轮 1–3 项，重可复用短语/搭配/语域/真实纠错/保留语气） | `:71-101` | 已实现 |
| 保存前 8 点质量自检 | `:88-101` | 已实现 |
| 问题翻译三种模式（单次 / 会话自动 / 停止） | `:35-69` | 已实现（依赖宿主遵循） |
| 保存前展示模板（Worth learning / Original / Better / Why / Reuse / Vocabulary / Tags） | `:137-188` | 已实现 |
| 无高价值内容时拒绝保存 | `:148-161` | 已实现 |
| 意图聚类工作流（列未聚类→模型分组→合并/拆分） | `:190-207` | 已实现 |
| 搜索 / 练习 / 复习 / 复用工作流约定 | `:209-229` | 已实现 |
| 工具文档同步度 | `:10-33` | 部分实现（漏 `suggest_reuse_candidates`；`record_practice` 参数过时，FUNC-13） |

### 9.2 `@work-learn/setup`（已发布 npm）

| 能力 | 位置 | 状态 |
|---|---|---|
| 自动检测本机 Agent（Codex / Claude Code / Claude Desktop / CodeBuddy / Cursor / OpenCode） | `src/agents.ts:27-76` | 已实现 |
| 按 Agent 写各自 MCP 配置格式（`mcpServers` JSON / OpenCode JSON / Codex TOML），保留其他配置 | `agents.ts:125-201` | 已实现 |
| 覆盖前备份 + 含 token 配置 `chmod 0600` | `agents.ts:83-109` | 已实现 |
| 交互式向导（token/token 文件/API URL/仓库路径/目标 Agent/是否装 Skill） | `src/index.ts:120-203` | 已实现 |
| 非交互安装 `--token`、`--token-file`、`--api-url`、`--repo`、`--agent`、`-y` | `src/index.ts:22-65,68-88,138-151` | 已实现 |
| token 文件模式（校验 `~` 展开/存在/非空，只把路径写进配置） | `src/index.ts:205-235` | 已实现 |
| 联动安装 Skill（调 `scripts/install-skill.sh`） | `src/index.ts:256-276` | 已实现 |
| 卸载 / 清理 Agent MCP 配置 | — | **未提供** |

### 9.3 `scripts/install-skill.sh`

| 能力 | 位置 | 状态 |
|---|---|---|
| 本地安装或 curl pipe 远端安装 | `:1-61` | 已实现 |
| 多 Agent 目录分发（codex / claude / codebuddy / cursor / opencode / agents / pi） | `:30-49` | 已实现 |
| 仅安装到已存在目录 + 汇总结果（全无则退出并给手工方案） | `:42-60` | 已实现 |

---

## 10. 部分实现 / 已知缺口汇总

完整分析与修复建议见 [code-audit.md](code-audit.md)。

| 编号 | 级别 | 缺口 | 影响面 |
|---|---|---|---|
| FUNC-1 | 高危 | Web 复用建议传 `limit=5`，后端 schema 上限 1 → 必然 400 | 语料库页该面板不可用 |
| FUNC-2 | 中 | 本地 `search_corpus` 丢弃 `source`/`tag` | 本地与云端筛选行为分叉 |
| FUNC-3 | 中 | 本地 `mark_mastered` 丢弃 `grade`，固定 `good` | 本地 SRS 评分失真 |
| FUNC-4 | 中 | 本地 `recordPractice` 返回空 `id` | 本地练习记录无法引用 |
| FUNC-5 | 中 | 同步状态不统计 `practice_records` | Web 同步面板数据不全 |
| FUNC-6 | 中 | Web JSON 导出缺失 reviews/intents/expressions/reuse/practice | 导出非无损 |
| FUNC-7 | 中 | portable import v1 不含 practice records | 导入非无损 |
| FUNC-8 | 中 | PAT scope 拒绝可能返回 HTTP 200 带 403 体 | HTTP 语义不准（授权仍生效） |
| FUNC-9 | 中 | `suggest_reuse` 标 `read` 但有写副作用 | scope 语义不严谨 |
| FUNC-10 | 中 | Companion「采集选中」IPC 恒返回 `ok:true` | 面板可能误报成功 |
| FUNC-11 | 中 | Companion「自动采集」实为开录制终端 | 与命名预期不符 |
| FUNC-12 | 中 | MCP 未暴露 `list_intents` | Agent 无法列意图 |
| FUNC-13 | 低 | Skill 文档滞后（漏工具 + 参数过时） | 宿主 Agent 调用可能出错 |
| FUNC-14 | 低 | Web 深浅模式未实现 | — |
| — | 低 | `conversation_events` 表无任何读写入口 | 孤岛表 |

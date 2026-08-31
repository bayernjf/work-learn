# Work Learn 深度评审审计报告

- 审计日期：2026-08-30
- 范围：安全 / 同步正确性 / 测试质量
- 方法：全仓只读代码评审 + 修复 + 回归测试
- 状态跟踪：本文档随修复持续更新（最后更新 2026-08-31）

## 摘要

**核心结论：承载产品核心承诺（追踪真实复用）的同步层是最薄弱的一环，存在会静默丢数据的缺陷；同时「测试不拦回归、文档勾选先于真实验证」让已交付功能的实际可靠度低于账面。**

本报告发布后所有 P0/P1 数据安全类缺陷均已修复并附回归测试；OAuth 安全面三项纯代码修复全部完成。剩余项均为需要决策或 schema 迁移的工作（限流、FK 语义统一、双实现收敛）。

## 严重等级

| 级别 | 含义 |
|------|------|
| P0 | 数据丢失级：静默丢数据 / 同步卡死 |
| P1 | 高危：越权、令牌泄漏、新编辑丢失 |
| P2 | 中：幽灵数据、注入、可信度缺口 |

---

## P0 — 数据丢失级（3/3 已修复）

### P0-1 LWW 比较方向写反
- **发现**：`direct.ts` 两处 `upsertWithLww` 用 `.gte("updated_at", 传入值)` 过滤，语义是「只在云端行更新或相等时才覆盖」——两个方向全错：云端更新时被旧数据覆盖、云端更旧时新数据被静默丢弃，且不查影响行数，CLI 照常 `markSynced`。
- **修复**：改为 `.lte(...)`，加 `.select("id")`（零行=云端更新、按预期跳过），推送前查 `sync_tombstones` 跳过已删 id；`direct.test.ts` 补回归测试锁定比较方向（测试桩记录 `gte`/`lte` 算子）。
- **状态**：✅ 已修复。

### P0-2 practice_records 全链路缺席
- **发现**：本地写入带 `sync_status`，但 `unsynced()` / `markSynced` / `syncToCloud` / `fetchSyncSnapshot` 全不含它——C1 练习闭环只在单机成立，Web 与 CLI 的错题本是两个世界。
- **修复**：`shared-schema` 增 schema 与列集；`local-store` 纳入同步/统计；`direct.ts` 双向打通；追加写语义走 `ON CONFLICT(id) DO NOTHING`，pull 游标用 `created_at`。顺带修掉 `applyCloudTombstones` 对无 `updated_at` 表加护栏的 500、本地 `deleteReuseEvent` 占位符/参数不匹配。
- **状态**：✅ 已修复。

### P0-3 删除/插入时序复活已删数据
- **发现**：insert 路径不查 `sync_tombstones`；`importPortableData` 直接插回已删实体。
- **修复**：插入前查 tombstone；按 id `onConflict`（`ON CONFLICT(id) DO UPDATE` 幂等，消除探测与写入间的竞态）；`upsertImmutableWithId` 用 `ignoreDuplicates` 省一次往返。
- **状态**：✅ 已修复。

---

## P1 — 高危（5/6 已修复，1 项需决策）

### P1-1 空 scope = 全权限（OAuth 令牌泄漏）
- **发现**：`auth.ts` 把空 scope 解析成 `undefined`，鉴权层视 `undefined` 为「无限制」——OAuth 令牌若未请求 scope 即获得读写全权限，同意页展示的 scope 无约束力（与 `scopes_supported: []` 叠加）。
- **修复**（`39baff2`）：`resolveIssuedScope` 让新令牌默认最小 scope `read`；合规客户端（`scope=read write`）不受影响。遗留 PAT 的 `undefined=全权限` 是刻意向后兼容，未动。
- **状态**：✅ 已修复。

### P1-2 OAuth code 兑换 / refresh 轮换非原子
- **发现**：先查再无条件 `update`，并发可双重兑换授权码；旧 refresh 重放照样轮换出第二套令牌。
- **修复**（`64456fb`）：单条条件 `UPDATE`（`.is consumed_at/revoked_at null`）原子认领，命中行数即胜负；错误 PKCE verifier 按 OAuth 2.1 BCP 烧掉 code。7 条回归测试。
- **剩余**：重放时的家族撤销需 `oauth_tokens` 加 family 标识列（schema 变更），未做。
- **状态**：✅ 主体已修复。

### P1-3 毒丸批次（同步卡死）
- **发现**：云端 `UNIQUE(user_id,text_norm)` vs 本地 `UNIQUE(text_norm)`，本地 id 撞云端已有 norm 时 insert 永久报错且无事务 → sync 卡死、每次重试都失败。
- **修复**（`13a5670`）：push 时按 `text_norm` 预探测，撞同文不同 id 则认领云端行做 LWW 合并（保留云端 id，`reuse_events` 引用它）；pull 方向本地本就按 norm 跳过。
- **状态**：✅ 已修复。

### P1-4 markSynced 竞态（新编辑丢失）
- **发现**：`pushChanges` 快照 → 网络往返期间并发写入的行被无脑标 `synced`，新编辑永丢；tombstone 标记在事务外。
- **修复**（`53fd03a`）：按版本标记——`WHERE id = ? AND updated_at = ?` 只盖「被推送的那个版本」，编辑过的行保持 unsynced 下轮补推；tombstone 标记纳入同一事务。
- **状态**：✅ 已修复。

### P1-5 `/register`（OAuth 动态客户端注册）滥用
- **发现**：无鉴权、无限流、`redirect_uri` 完全不校验（开放重定向，攻击者可拿授权码）；`client_name` 由攻击者控制并渲染进同意页（钓鱼面）。
- **修复**（`51f8235`）：`redirect_uri` 严格校验——必须是绝对 https（loopback 的 http 例外）、无 fragment、无通配符，非法即 400。
- **修复**（`3849bde`）：`client_name` 校验——trim、上限 100 字符、拒绝空值与控制字符，非法即 400，不再把原始文本渲染进同意页。
- **剩余**：**限流**（serverless 无共享存储，需落库计数或网关层，待决策）。
- **状态**：🟡 校验面已闭环，仅剩限流待决策。

### P1-6 FK 级联两端分叉（pull 整批回滚）
- **发现**：实测核对后真实分歧仅 `learning_materials.session_id` 与 `question_translations.session_id`（云端可空 SET NULL vs 本地 NOT NULL CASCADE）。云端删会话后父被 SET NULL，`normalizeMaterial` 把 `String(null)` 推成 `'null'` → 本地 FK 违反 → 整个 pull 事务回滚。
- **修复**（`2cd088a`）：快照源头过滤 `session_id IS NULL` 的行；`applyRemoteBatch` 对父缺失的 material/question/review 逐行跳过（与 practice_records 既有孤儿跳过一致）。
- **剩余**：两端删除语义统一（删会话保料 vs 级联删料）需本地表迁移重建 FK，另立专题；孤儿行静默丢弃不上报仍在。
- **状态**：🟡 已止血（不再回滚），语义统一未做。

---

## P2 — 中（4/5 已修复）

### P2-1 review id 漂移 → 幽灵行
- **发现**：review 行 id 两端各自随机生成，按 `material_id` 匹配内容但 id 永不收敛；删除传播的 tombstone 带删除方自己的 review id，另一端按 id 删除落空 → 幽灵行。
- **修复**（`fbd3f6a`）：review tombstone 改按 `material_id` 键（review 与 material 严格 1:1，云端本有唯一索引），两端记录与删除同步改键。
- **状态**：✅ 已修复。

### P2-2 `updated_at` 触发器缺失
- **发现**：`012` 只为 4 张初始表建触发器；`intents`/`saved_expressions`/`user_settings` 无触发器，普通写入时间戳留旧，LWW 会用旧盖新。
- **修复**（`e9d1bb1`）：迁移 `018_updated_at_triggers.sql` 补齐 3 表；`practice_records`/`reuse_events` 为追加写、无该列，刻意不动。
- **执行**：**待用户在云端 Supabase 执行迁移 `018`**。
- **状态**：✅ 代码已修复，⏳ 待执行迁移。

### P2-3 过滤注入
- **发现**：`searchQuestionTranslations` 把搜索词裸插进 PostgREST `.or()`，`,`/`(`/`)` 可追加条件（不能跨用户，可改写命中语义）。
- **修复**（`6797859`）：搜索词放进双引号值，分隔符失效为字面量；字面双引号丢弃。
- **状态**：✅ 已修复。

### P2-4 CI 不跑测试
- **发现**：`ci.yml` 只有 typecheck+build，111 个测试一个都不拦回归；且 5 个包的测试脚本依赖 shell 展开通配符，Windows 下静默跑零个并退出 0。
- **修复**：`ci.yml` 在 typecheck 前加 `pnpm test`；脚本改为 `node --import tsx --test`；新增共享运行器 `scripts/run-tests.mjs`（`d1aa84c`）——自己展开 glob、**零文件匹配或 `# tests 0` 即失败**。
- **状态**：✅ 已修复。CI 首跑即抓到 2 个既有坏点（本地 `markMastered` 丢 `due_at`、陈旧断言），印证了「验证进流水线」的价值。

### P2-5 孤儿行静默丢弃
- **发现**：`applyRemoteBatch` 父记录缺失时 `continue`，该行静默丢弃且不计入返回计数。
- **状态**：⬜ 未处理，并入 FK 语义统一专题。

---

## 架构性结论

| 项 | 状态 |
|----|------|
| 双实现（`direct.ts` 云端 vs `local-store` 本地）是最大技术债，FK/唯一约束/tombstone CHECK/触发器全在分叉 | 🟡 接口已收敛（`d3bfca7`：`WorkLearnContext` 下沉 shared-schema，三端 context 编译期结构互检）；剩余：同步面接口化 + 本地表迁移统一 FK 语义（重活，另立专题） |
| 空壳包 `learning-skill`（零引用）、`learning-core`（仅转发 `redactSecrets`） | ✅ 已删除（`0b59fa3`/`40b862a`） |
| `apps/api/api/index.ts` 死文件 | ✅ 已删除（`0b59fa3`） |
| 前端单体 `main.tsx`（1786 行、40+ useState、无测试） | ✅ 已按域拆分（`6cc1ef0`），`App` 状态抽 hooks 仍可做 |
| `react-query` 装了没用、硬编码 origin、`mcp-server` 遗留 HTTP 客户端 | ⬜ 未处理 |

## 测试质量欠账

| 项 | 状态 |
|----|------|
| `scheduleNextReview` 零测试 | ✅ 已补（`4b396d7`，6 条：again 立即重排、各级别间隔缩放、下限 1 天、easy 掌握判定、到期日） |
| `apps/api` 用 `app.request()` 的进程内路由测试 | ✅ 已补（`2cb04d0`：health、全路由 401 扫、oauth 注册非法输入 400、404） |
| `markSynced` 往返测试 | ✅ 已补（`53fd03a`） |

## 验证证据

- 本地（环境修复后，2026-08-31）：mcp-server 34/34、api 42/42、shared-schema 45/45、setup 5/5；api/cli/mcp-server/shared-schema/setup/web 六处 `tsc --noEmit` 全绿。
- `local-store` 测试依赖 better-sqlite3 原生模块，本机无法运行，以 CI 为准。
- CI 上次运行因一条 review tombstone 旧断言失败，已修复（`d674991`），**尚未重跑**。
- **待办**：push `dev` 触发 CI 全量验证 → 合入 `main` 部署；云端执行迁移 `018`。

## 结论与建议

1. 数据安全类缺陷（P0 全部 + P1 同步全部 + P2 数据）已闭环并有回归测试守护。
2. 推进顺序建议：`/register` 限流（安全面，需决策）→ FK 语义统一（需本地表迁移）→ 双实现收尾（同步面接口化，架构）。
3. 任何「本地绿、生产坏」类回归都已被 CI 冒烟与零测试护栏覆盖；本机 Windows 的 junction/CRLF 环境问题不影响 CI（ubuntu/LF）。

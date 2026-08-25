# 本地优先存储方案

> 状态：已实现（本地 ↔ 云端双向同步，last-write-wins）
> 决策日期：2026-08-23

## 0. 目标与原则

**目标**：数据**优先存本地**（离线可用、无需 token），云端 Supabase 降级为「个人账号的同步副本」，由用户主动同步；本地同时提供一份**可读的 markdown 镜像**。

**三条铁律**（贯穿全文）：

1. **SQLite 是唯一真相源**；云端是同步副本；markdown 是可重生镜像。
2. **导出只读本地、覆盖式写、天然不重复**；「去重」是**入库时**的事，与导出/同步无关。
3. 线上路径（remote MCP、Web）保持云端直写，视为「已同步」状态，不动。

---

## 1. 数据流总览

```text
┌─ 本机（离线可用，无 token）────────────────────┐
│   stdio MCP ──┐                                  │
│   CLI         ┼─→ LocalStore (SQLite)            │
│                │     ~/.work-learn/work-learn.db  │
│                │     ├─ learn export → notes/*.md │
│                │     └─ learn sync   ↔ 云端        │
└────────────────┴──────────────┬──────────────────┘
                                 │ GET/POST /api/sync (PAT 鉴权，增量 + LWW)
                                 ▼
                     Supabase（个人账号，同步副本）
┌─ 云端（在线，保持直写，视为已同步）───────────────┐
│   remote MCP ──→ /api/mcp ──→ Supabase            │
│   Web ─────────→ Supabase (Auth + RLS)            │
└──────────────────────────────────────────────────┘
```

**关键收益**：本地 MCP 和 CLI **不再需要 PAT**，同步时才要账号。

---

## 2. 存储介质与数据结构

### 2.1 本地 SQLite

- 路径：`~/.work-learn/work-learn.db`
- 本地表：`sessions`、`learning_materials`、`question_translations`、`review_items`，schema 与云端一致（去掉 `user_id`，改用 `sync_status`）
- 每张业务表都有 `updated_at`，同步按它做增量游标和 last-write-wins
- 本地待推送表加：
  - `sync_status`：`local_only` / `synced`
  - `synced_at timestamptz`（可空）
- `question_translations` 额外加 `question_norm`（归一化列，用于精确去重，见 §7）
- 记录沿用云端已生成的 `uuid`（`id` 保留），保证同步幂等

### 2.2 介质选型：`better-sqlite3`

**结论：选 `better-sqlite3`。**

| 维度 | `better-sqlite3` | `node:sqlite`（内置） |
|------|------------------|----------------------|
| 生态成熟度 | 十年成熟、文档全、同步 API 简单 | Node 22.5 才稳定，API 仍在变 |
| 兼容性 | Node 20/22 都跑 | **强制 Node 22.5+** |
| 安装 | 预编译二进制，`npm i` 即可 | 无需安装 |
| 类型支持 | `@types/better-sqlite3` 完整 | 需自己补类型 |

**核心理由**：真实用户通过 `npx @work-learn/setup` 或 clone 仓库使用，**无法假设都已升级 Node 22.5**。`node:sqlite` 会让 Node 20 用户直接跑不起来；`better-sqlite3` 有预编译二进制，绝大多数平台安装即用。等 Node 22.5+ 普及后再迁移到内置版，SQL 语句通用，迁移成本极低。

---

## 3. 模块改动

### 3.1 新增 `packages/local-store`

- SQLite 封装，暴露与 `WorkLearnContext` **同构**的 `createLocalContext`
- 方法：`createSession` / `saveMaterial` / `saveQuestionTranslation` / `searchCorpus` / `getReviewItems` / `markMastered`
- 复用 `shared-schema` 的脱敏 `redactSecrets`
- **入库精确去重**：`saveQuestionTranslation` 落库前做归一化查重（见 §7）
- `exportMarkdown(range)` 纯函数：读库 → 渲染 markdown

### 3.2 `mcp-server`

- `tools.ts`：`WorkLearnContext` 接口**不变**（已够）
- `server.ts`：stdio 进程改用 `createLocalContext`，**移除 token 依赖**（未设 token 时走本地模式）

### 3.3 `apps/cli`

| 命令 | 行为 |
|------|------|
| `learn capture` | 改为写入本地库（原只打印 JSON） |
| `learn review` | 查本地 `review_items`（原占位） |
| `learn search` | 查本地库（原占位） |
| **`learn sync`** | 先拉云端增量，再推送本地增量，最后再拉一次；复习状态一起同步 |
| **`learn export`** | 本地库 → markdown（`--all` / `--from` / `--to` / `--source` / `--tag`） |

### 3.4 `apps/api`

新增 `GET /api/sync?since=` 和 `POST /api/sync`：按 `updated_at` 增量拉取/推送，使用稳定 UUID 和 last-write-wins；复习状态也同步。

### 3.5 `shared-schema`

新增 `syncBatchInputSchema`（批量 sessions / materials / question_translations）。

### 3.6 Web「设置」页

浏览器读不到本地 SQLite，所以**同步动作只能由本机进程触发**。Web 设置页只负责展示：
- 账号绑定状态、PAT 生成/管理（已有）
- 「上次同步时间」等状态展示（可选，来自 `/api/sync/status`）

---

## 4. 同步设计（`learn sync`）

- **方向**：双向。本地和云端都以稳定 UUID 作为实体身份。
- **增量**：本地保存 `last_pulled_at`；`GET /api/sync?since=` 只取更新时间更新的行。
- **冲突策略**：last-write-wins，比较 `updated_at`；时间戳相等时以写入端为准。当前不做字段级合并或 CRDT。
- **顺序**：`learn sync` = pull → push → pull，降低并发期间漏拉的概率。
- **复习队列**：同步 `review_items`，按 `material_id` 归并，因此一个设备完成复习后其他设备能看到。
- **同步范围**：sessions + learning_materials + question_translations + review_items。
- **删除**：当前版本还不做删除同步/tombstone；编辑和完成状态可以同步，删除暂不传播。

---

## 5. markdown 导出设计（`learn export`）

- **只读本地库**，与云端无关（离线可导）
- **覆盖式生成**：某天重导出 = 重写该天文件，内容恒等于「当天库内全部」，**天然不重复**
- **文件粒度**：按天 `~/.work-learn/notes/YYYY/MM/YYYY-MM-DD.md`
- **内容**：全部类型（提问翻译对 + 学习材料），用小节前缀区分

```markdown
# 2026-08-23 · Work Learn
> source: codebuddy · topic: database performance · 42 items

## [Q&A] 14:32 — 怎么优化数据库查询性能？
**地道英文**：How should I go about optimizing database query performance?
标签：database, performance

## [Material] 15:07 — decouple the validation from the persistence layer
原文：decouple the validation from the persistence layer
更正：decouple validation from persistence
为什么：more concise
词汇：decouple, persistence
标签：database, migration
```

---

## 6. 入库去重（精确去重）

针对「会话自动存」模式下的重复/低价值提问，去重在**写库时**做。

### 去重 key（怎么算「相同」）

对 `saveQuestionTranslation`，归一化 `question` 字段：

```ts
normalize(q) = q.trim().toLowerCase().replace(/\s+/g, " ")
```

即：去首尾空白 + 转小写 + 把连续空白压成一个空格。归一化后字符串相同 → 视为重复。

### 去重范围（在多大范围内查重）

不做全表扫。**入库时查「同 `session_id` 内最近 100 条」**，用归一化后的 `question` 精确匹配。覆盖「刚问过又问一遍」的绝大多数场景，无需额外索引、无全表扫。

### 重复时怎么办

命中重复 → **跳过写入**，返回原记录（或 `{ skipped: true, existingId }`），不产生新行。

### 伪代码

```ts
async saveQuestionTranslation(input) {
  const norm = normalize(input.question);
  const existing = db.prepare(
    `SELECT id FROM question_translations
     WHERE session_id = ? AND question_norm = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(input.sessionId, norm);
  if (existing) return { skipped: true, existingId: existing.id };

  // 否则写入，含 question_norm = norm
}
```

**结论**：精确去重 = 归一化 `question`（trim/小写/压空白）+ 同 session 内最近 N 条查重 + 命中即跳过。第一版**不上近似去重**（编辑距离等），避免复杂度和误判。

---

## 7. 明确不做 / 已排除

- **旧数据迁移**：真实用户从零开始、无存量数据，此问题是伪命题，**不做**。作者现有云端开发测试数据留在云端，不影响任何真实用户。
- 复习队列同步（第一版）
- 云端 → 本地反向拉取（多设备场景，第一版不做）
- 近似去重（编辑距离 / 向量相似度）

---

## 8. 实施顺序（4 个原子阶段，每阶段独立 commit）

| 阶段 | 内容 |
|------|------|
| **Phase 1** | 新增 `packages/local-store` + `better-sqlite3` + `createLocalContext` |
| **Phase 2** | stdio MCP 切到本地模式；CLI 补 `capture`/`review`/`search` 落本地 |
| **Phase 3** | `learn sync` + `POST /api/sync` + 幂等写入 |
| **Phase 4** | `learn export` markdown + 入库去重 + 文档更新 |

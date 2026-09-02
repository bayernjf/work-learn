# CLI 与 MCP 接入

> 数据策略为**本地优先**：CLI 与 stdio MCP 默认读写本地 SQLite（`~/.work-learn/work-learn.db`），无需 token；云端同步是主动行为，见 [本地优先存储方案](local-first-storage.md)。

## CLI 命令

```bash
learn capture  # 采集 stdin 或剪贴板，脱敏后写入本地库
learn review   # 查看本地待复习项
learn search   # 搜索本地语料（--q/--query，或直接跟关键词）
learn practice # 从最近材料和提问翻译生成本地练习
learn sync     # 双向同步本地与云端数据（需 WORK_LEARN_ACCESS_TOKEN）
learn doctor   # 检查本地库、token 配置和 API 健康状态
learn delete   # 删除本地材料或提问，并记录 tombstone
learn backup   # 备份本地 SQLite 数据库
learn restore  # 从 SQLite 备份恢复本地数据库（需 --file 和 --yes）
learn export   # 本地库导出为按天 markdown（--from/--to/--out）
learn run     # 在 PTY 中运行 agent 并录制终端会话，脱敏后写入本地库
learn expressions  # 列出已保存表达（供 Agent 浮层取数，C3）
learn hook      # 安装/卸载/查看 shell rc 自动录制包裹块（install|uninstall|status，C4）
```

可用 `WORK_LEARN_DB_PATH` 覆盖本地 SQLite 路径（例如隔离测试或同时维护多个库）。

### search

```bash
learn search "query"
learn search --source codex --tag auth
```

`--source` 同时筛选材料和提问；`--tag` 只筛选材料标签。

### practice

`learn practice` 不调用模型，直接从本地 SQLite 最近保存的材料和提问翻译生成结构化练习提示：

```bash
learn practice
learn practice --limit 5
learn practice --material <material-id>
```

### capture

`learn capture` 采集并脱敏后写入本地库（不再只打印 JSON）：

```bash
learn capture --stdin --source terminal --topic "API debugging"
```

macOS 可以直接读取剪贴板：

```bash
learn capture --source claude --topic "database migration"
```

API Key、Bearer Token、密码、私钥和常见云平台凭证会在本地先被替换。

### sync

执行双向同步：拉取云端增量，推送本地未同步记录，再拉取一次结果。复习完成状态也会同步：

```bash
learn sync
```

> 默认 API 入口是 `https://work-learn.pages.dev`（Cloudflare Pages 代理，中国大陆可直连）；
> 直连 `https://work-learn-api.vercel.app` 在国内会被阻断。海外/无墙环境需要直连后端时用
> `learn sync --api-url https://work-learn-api.vercel.app`，或用 `WORK_LEARN_API_URL` 覆盖。

token 通过 `WORK_LEARN_ACCESS_TOKEN` 或 `WORK_LEARN_ACCESS_TOKEN_FILE` 提供。冲突策略为 last-write-wins：两端修改同一条记录时，`updated_at` 更新的一端胜出。

成功时输出 JSON，包含本轮 `pulledBefore`、`pushed`、`pulledAfter`，以及本地库的 `local` 状态：数据库路径、最近一次 pull cursor、各类记录数量、待同步数量和最近更新时间。

### doctor

`learn doctor` 用于排查本地优先链路是否可用：检查 Node 版本、本地 SQLite 能否打开、本地记录数量与待同步队列、token 来源，以及 API `/api/health` 的状态和延迟。如果能解析到 token，还会调用 `/api/sync/status` 校验云端语料计数和最近保存时间。任何检查失败都会让命令以非零状态码退出，适合在终端或 Agent 里先做体检。

```bash
learn doctor
learn doctor --api-url https://work-learn-api.vercel.app   # 覆盖默认的 pages.dev 代理入口
```

### delete

删除一条本地材料或提问，并写入 tombstone，下次 `learn sync` 会把删除传播到云端和其他设备：

```bash
learn delete material --id <material-id>
learn delete question --id <question-id>
```

Web 端的材料卡片和提问卡片也提供了删除按钮，删除会直接写云端 tombstone。

### run

`learn run -- <command> [args...]` 通过系统 `script` 命令分配一个 PTY，运行指定 agent（如 `hermes`、`openclaw`），把整段终端会话录制下来，脱敏（API Key / 密码 / Token 等会被替换）后作为一条 `source=terminal` 的材料写入本地库，并进入复习队列。支持 `learn run -- hermes` 与 `learn run hermes` 两种写法；`--topic` 可覆盖默认主题（默认 `terminal: <command>`）。

```bash
learn run -- hermes
learn run -- openclaw "summarize this repo"
learn run -- bash -c "npm test" --topic "test run"
```

录制内容是原始终端 I/O，会去掉 ANSI 转义、退格和 caret 记号控制字符；超过 100k 字符会截断。该命令目前仅支持 macOS / Linux（依赖系统 `script`）。这是 macOS Companion 终端采集能力的第一刀：本地优先、离线可用，后续再由菜单栏应用封装全局快捷键。

### backup

把本地 SQLite 数据库复制成一个可恢复的备份文件。默认保存到 `~/.work-learn/backups/`，也可以用 `--out` 指定路径：

```bash
learn backup
learn backup --out ~/Downloads/work-learn-backup.db
```

备份前会 checkpoint WAL，并验证备份文件包含 Work Learn 的必要表。

### restore

从 `learn backup` 生成的 SQLite 文件恢复本地库：

```bash
learn restore --file ~/Downloads/work-learn-backup.db --yes
```

恢复前会自动把当前库另存为 `work-learn.db.before-restore-<timestamp>`，恢复后会重新打开数据库做一次本地统计校验。恢复不会自动 `learn sync`，确认无误后再手动同步，避免误覆盖云端。

### export

把本地库按天覆盖式导出为 markdown（`~/.work-learn/notes/YYYY/MM/YYYY-MM-DD.md`）：

```bash
learn export              # 全部
learn export --from 2026-08-01 --to 2026-08-23
```

## 支持的来源

`source` 是开放标签，任意非空字符串都可以入库，新增 Agent 无需改代码或跑迁移。
以下为 UI / CLI 建议展示的参考清单（维护在 `packages/shared-schema/src/agents.ts`）：

- Claude、ChatGPT、CodeBuddy、Hermes、OpenClaw、OpenCode、Codex、Pi
- 终端（`terminal`）与手动（`manual`）

## MCP Server

**本地优先**：stdio MCP 默认直接读写本地 SQLite，**不需要 token 也不需要起 API**。只有在设置了 token 时，才回退为调用线上 API（`WORK_LEARN_API_URL` + token）。

```env
# 可选：只有想走云端时才需要这两项
WORK_LEARN_API_URL=http://localhost:3000
WORK_LEARN_ACCESS_TOKEN=<your Work Learn personal access token>
```

在 Web 端的 “Connect an agent” 面板创建 personal access token，创建时可以选有效期（默认 90 天，
也可以选永久）。在过期或吊销之前不需要续期机制。建议每个 agent 单独发一个，这样吊销时只影响那一个。

MCP 当前提供：

- `create_session`
- `save_material`
- `save_question_translation`
- `search_corpus`
- `get_review_items`
- `mark_mastered`
- `generate_practice`
- `get_user_patterns`
- `get_reuse_summary`
- `record_reuse`
- `suggest_reuse`
- `configure_reuse_nudges`
- `list_expressions`
- `cluster_intents`
- `merge_intents`
- `split_intent`
- `snooze_review`
- `record_practice`
- `get_practice_history`
- `generate_adaptive_practice`

本地 CLI 可用 `learn nudges status` 查看设置，`learn nudges on` / `learn nudges off` 开关，或用 `--cooldown-hours`、`--daily-limit` 调整频控。

### import API

Web 端 JSON 导入调用 `POST /api/import`，需要 write scope。请求体是版本化 JSON：

```json
{
  "version": 1,
  "exportedAt": "2026-08-26T00:00:00.000Z",
  "sessions": [],
  "materials": [],
  "questionTranslations": [],
  "reviews": []
}
```

服务端按稳定 id 做 last-write-wins upsert，并为缺失复习项的材料补建 pending review。

Claude Desktop 的本地配置示例（本地优先，无需 env）：

```json
{
  "mcpServers": {
    "work-learn": {
      "command": "pnpm",
      "args": ["--filter", "@work-learn/mcp-server", "dev"],
      "cwd": "/absolute/path/to/work-learn"
    }
  }
}
```

如需走云端（remote 场景或想直接写云端），再加 `env`：

```json
{
  "mcpServers": {
    "work-learn": {
      "command": "pnpm",
      "args": ["--filter", "@work-learn/mcp-server", "dev"],
      "cwd": "/absolute/path/to/work-learn",
      "env": {
        "WORK_LEARN_API_URL": "http://localhost:3000",
        "WORK_LEARN_ACCESS_TOKEN": "<your Work Learn personal access token>"
      }
    }
  }
}
```

`WORK_LEARN_ACCESS_TOKEN` 只放在本机 Agent 配置中，不提交到 Git，也不使用 service role key 代替用户 token。
如果不想让 token 出现在配置文件里，用 `WORK_LEARN_ACCESS_TOKEN_FILE` 指向一个存着它的文件，
配置里就只留路径；两个都设时以文件为准。

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
```

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
learn sync --api-url https://work-learn-api.vercel.app
```

token 通过 `WORK_LEARN_ACCESS_TOKEN` 或 `WORK_LEARN_ACCESS_TOKEN_FILE` 提供。冲突策略为 last-write-wins：两端修改同一条记录时，`updated_at` 更新的一端胜出。

成功时输出 JSON，包含本轮 `pulledBefore`、`pushed`、`pulledAfter`，以及本地库的 `local` 状态：数据库路径、最近一次 pull cursor、各类记录数量、待同步数量和最近更新时间。

### doctor

`learn doctor` 用于排查本地优先链路是否可用：检查 Node 版本、本地 SQLite 能否打开、本地记录数量与待同步队列、token 来源，以及 API `/api/health` 的状态和延迟。如果能解析到 token，还会调用 `/api/sync/status` 校验云端语料计数和最近保存时间。任何检查失败都会让命令以非零状态码退出，适合在终端或 Agent 里先做体检。

```bash
learn doctor
learn doctor --api-url https://work-learn-api.vercel.app
```

### delete

删除一条本地材料或提问，并写入 tombstone，下次 `learn sync` 会把删除传播到云端和其他设备：

```bash
learn delete material --id <material-id>
learn delete question --id <question-id>
```

Web 端的材料卡片和提问卡片也提供了删除按钮，删除会直接写云端 tombstone。

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
- `record_reuse`

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

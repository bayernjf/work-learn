# CLI 与 MCP 接入

> 数据策略为**本地优先**：CLI 与 stdio MCP 默认读写本地 SQLite（`~/.work-learn/work-learn.db`），无需 token；云端同步是主动行为，见 [本地优先存储方案](local-first-storage.md)。

## CLI 命令

```bash
learn capture  # 采集 stdin 或剪贴板，脱敏后写入本地库
learn review   # 查看本地待复习项
learn search   # 搜索本地语料（--q 或直接跟关键词）
learn sync     # 双向同步本地与云端数据（需 WORK_LEARN_ACCESS_TOKEN）
learn delete   # 删除本地材料或提问，并记录 tombstone
learn export   # 本地库导出为按天 markdown（--from/--to/--out）
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

### delete

删除一条本地材料或提问，并写入 tombstone，下次 `learn sync` 会把删除传播到云端和其他设备：

```bash
learn delete material --id <material-id>
learn delete question --id <question-id>
```

Web 端的材料卡片和提问卡片也提供了删除按钮，删除会直接写云端 tombstone。

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

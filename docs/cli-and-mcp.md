# CLI 与 MCP 接入

## CLI capture

`learn capture` 当前只做本地采集和脱敏，不会自动上传：

```bash
learn capture --stdin --source terminal --topic "API debugging"
```

macOS 可以直接读取剪贴板：

```bash
learn capture --source claude --topic "database migration"
```

输出是结构化 JSON，包含 `source`、`topic`、脱敏后的 `content`、脱敏次数和采集时间。API Key、Bearer Token、密码、私钥和常见云平台凭证会在本地先被替换。

## 支持的来源

`source` 是开放标签，任意非空字符串都可以入库，新增 Agent 无需改代码或跑迁移。
以下为 UI / CLI 建议展示的参考清单（维护在 `packages/shared-schema/src/agents.ts`）：

- Claude、ChatGPT、CodeBuddy、Hermes、OpenClaw、OpenCode、Codex、Pi
- 终端（`terminal`）与手动（`manual`）

## MCP Server

本地运行 API 后，配置以下环境变量：

```env
WORK_LEARN_API_URL=http://localhost:3000
WORK_LEARN_ACCESS_TOKEN=<your Work Learn personal access token>
```

在 Web 端的 “Connect an agent” 面板创建 personal access token。它在你吊销之前一直有效，
所以不需要续期机制。建议每个 agent 单独发一个，这样吊销时只影响那一个。

MCP 当前提供：

- `create_session`
- `save_material`
- `search_corpus`
- `get_review_items`
- `mark_mastered`

Claude Desktop 的本地配置示例：

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

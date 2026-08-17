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

`source` 支持以下 Agent：

- Claude、ChatGPT、Hermes、OpenClaw、OpenCode、Codex、Pi
- 终端（`terminal`）与手动（`manual`）

## MCP Server

本地运行 API 后，配置以下环境变量：

```env
WORK_LEARN_API_URL=http://localhost:3000
WORK_LEARN_ACCESS_TOKEN=<Supabase user access token>
```

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
        "WORK_LEARN_ACCESS_TOKEN": "<Supabase user access token>"
      }
    }
  }
}
```

`WORK_LEARN_ACCESS_TOKEN` 只放在本机 Agent 配置中，不提交到 Git，也不使用 service role key 代替用户 token。

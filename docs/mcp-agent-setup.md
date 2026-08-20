# MCP Agent 接入配置

本文档描述的是**本地 stdio MCP**（开发者/自托管方式）：用户在本机运行 MCP 进程并手动配置 token。

面向普通用户的**远程 MCP**（在 Agent 里填一条 URL，经授权后连接，无需本地 clone 或安装）已上线第一版，方案见 [远程 MCP 方案](remote-mcp.md)。不支持远程 MCP 的客户端继续使用本文的本地 stdio 方式。

## 远程 MCP（推荐，最简单）

端点（Streamable HTTP，无状态）：

```text
https://work-learn-api.vercel.app/api/mcp
```

在支持远程 MCP 的 Agent（Claude Desktop、Cursor 等）里添加该 URL，并在请求头携带：

```text
Authorization: Bearer <your-access-token>
```

其中 `<your-access-token>` 是登录 Web 端后在 “Connect an agent” 面板里复制的 Supabase access token。

注意：该 token 是短期 JWT（约 1 小时过期）。第一版用它直接接入；长期有效的 Personal Access Token（生成/撤销）和 OAuth 自动授权将在后续版本提供。需要长期免维护的用户，目前请使用下面的本地 stdio + refresh token 方式。

远程端点与本地 MCP 提供完全相同的 5 个工具：`create_session`、`save_material`、`search_corpus`、`get_review_items`、`mark_mastered`。

把 Work Learn MCP 服务器接入本地 Agent，让 Agent 能调用 `create_session`、`save_material`、`search_corpus`、`get_review_items`、`mark_mastered`。

## 前置条件

- 仓库位于 `/Users/jiangfeng/000mycodes/work-learn`
- 本机已安装 pnpm 和 Node 20+
- Hono API 可访问（默认 `http://localhost:3000`，部署后改为线上 URL）
- 已拿到一个 Supabase 用户的 access token（从 Web 登录或脚本登录获取）

`WORK_LEARN_ACCESS_TOKEN` 是短期 JWT（约 1 小时过期）。如果同时提供 `WORK_LEARN_REFRESH_TOKEN`、
`SUPABASE_URL` 和 `SUPABASE_ANON_KEY`，MCP 服务器会在 access token 过期时自动用 refresh token
续期，并把轮换后的 refresh token 写入 `packages/mcp-server/.session-token.json`，实现长期稳定接入。

## 一键安装（推荐）

先把本仓库 clone 到本机并执行 `pnpm install`（本地 stdio MCP 仍需要这份代码来启动服务进程）。
然后在 Web 端登录后复制 access token，运行：

```bash
npx @work-learn/setup --token <your-access-token> --repo /path/to/work-learn
```

向导会自动探测 Codex、Claude Desktop、CodeBuddy、Cursor、OpenCode，把正确格式的 MCP
配置写进各自的配置文件（写入前会自动备份），并可选安装 Work Learn Skill。

想要长期免维护，带上 refresh token：

```bash
npx @work-learn/setup \
  --token <access-token> \
  --refresh-token <refresh-token> \
  --supabase-url https://<project>.supabase.co \
  --supabase-anon-key <anon-key> \
  --repo /path/to/work-learn
```

只配置指定 Agent 可重复使用 `--agent`：`--agent codex --agent codebuddy`。
非交互环境加 `-y`。其余选项见 `npx @work-learn/setup --help`。

下文的手动配置仅在你不想使用安装器或需要自定义时参考。

## 运行命令（两种方式）

方式 A：支持 `cwd` 的 Agent 使用 pnpm（推荐，路径无需写死 node_modules）

```json
{
  "command": "pnpm",
  "args": ["--filter", "@work-learn/mcp-server", "exec", "tsx", "src/server.ts"],
  "cwd": "/Users/jiangfeng/000mycodes/work-learn",
  "env": {
    "WORK_LEARN_API_URL": "http://localhost:3000",
    "WORK_LEARN_ACCESS_TOKEN": "<Supabase user access token>",
    "WORK_LEARN_REFRESH_TOKEN": "<Supabase user refresh token>",
    "SUPABASE_URL": "<supabase url>",
    "SUPABASE_ANON_KEY": "<supabase anon key>"
  }
}
```

方式 B：不支持 `cwd` 的 Agent 使用绝对路径

```json
{
  "command": "/Users/jiangfeng/000mycodes/work-learn/packages/mcp-server/node_modules/.bin/tsx",
  "args": ["/Users/jiangfeng/000mycodes/work-learn/packages/mcp-server/src/server.ts"],
  "env": {
    "WORK_LEARN_API_URL": "http://localhost:3000",
    "WORK_LEARN_ACCESS_TOKEN": "<Supabase user access token>",
    "WORK_LEARN_REFRESH_TOKEN": "<Supabase user refresh token>",
    "SUPABASE_URL": "<supabase url>",
    "SUPABASE_ANON_KEY": "<supabase anon key>"
  }
}
```

## Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "work-learn": {
      "command": "pnpm",
      "args": ["--filter", "@work-learn/mcp-server", "exec", "tsx", "src/server.ts"],
      "cwd": "/Users/jiangfeng/000mycodes/work-learn",
      "env": {
        "WORK_LEARN_API_URL": "http://localhost:3000",
        "WORK_LEARN_ACCESS_TOKEN": "<Supabase user access token>",
        "WORK_LEARN_REFRESH_TOKEN": "<Supabase user refresh token>",
        "SUPABASE_URL": "<supabase url>",
        "SUPABASE_ANON_KEY": "<supabase anon key>"
      }
    }
  }
}
```

## CodeBuddy

编辑 `~/.codebuddy/mcp.json`（CLI 终端与桌面端共用）：

```json
{
  "mcpServers": {
    "work-learn": {
      "command": "/Users/jiangfeng/000mycodes/work-learn/packages/mcp-server/node_modules/.bin/tsx",
      "args": ["/Users/jiangfeng/000mycodes/work-learn/packages/mcp-server/src/server.ts"],
      "env": {
        "WORK_LEARN_API_URL": "https://work-learn-api.vercel.app",
        "WORK_LEARN_ACCESS_TOKEN": "<Supabase user access token>",
        "WORK_LEARN_REFRESH_TOKEN": "<Supabase user refresh token>",
        "SUPABASE_URL": "<supabase url>",
        "SUPABASE_ANON_KEY": "<supabase anon key>"
      }
    }
  }
}
```

`source` 是开放标签，支持任意来源（如 `codebuddy`、`gemini`、`cursor`、`trae`……）。
参考清单维护在 `packages/shared-schema/src/agents.ts`，新增 Agent 无需改 schema、迁移或重新部署。

## Codex

编辑 `~/.codex/config.toml`（Codex 不支持 `cwd` 字段，用方式 B）：

```toml
[mcp_servers.work-learn]
command = "/Users/jiangfeng/000mycodes/work-learn/packages/mcp-server/node_modules/.bin/tsx"
args = ["/Users/jiangfeng/000mycodes/work-learn/packages/mcp-server/src/server.ts"]
env = { WORK_LEARN_API_URL = "http://localhost:3000", WORK_LEARN_ACCESS_TOKEN = "<Supabase user access token>" }
```

## Hermes / OpenClaw / OpenCode / Pi

这几个平台都支持本地命令型 MCP 服务器，字段名基本一致（`command`、`args`、`env`，部分支持 `cwd`）。请按各平台的实际配置格式套用方式 A 或方式 B，并把 `<Supabase user access token>` 换成你的 token。若某个平台不支持 `env` 字段，可先通过 shell 导出环境变量再启动服务器。

## 安装 Skill（可选）

MCP 提供工具能力，Skill 则告诉 Agent 何时保存、如何整理。两者配合使用；不装 Skill 时 MCP 工具仍然可用，只是需要你手动下指令（例如直接说"调用 save_material"）。

前提：上面的 MCP 服务器已配置并连接成功。

### 一键安装（推荐）

脚本会自动检测本机所有支持 Skill 的 Agent（Codex、Claude Code、CodeBuddy、Cursor、OpenCode、Pi 等），把 Skill 装进对应的 skills 目录：

```bash
curl -fsSL https://raw.githubusercontent.com/bayernjf/work-learn/main/scripts/install-skill.sh | bash
```

如果已 clone 仓库，也可以直接运行：

```bash
bash scripts/install-skill.sh
```

### 手动安装

把仓库里 `skills/work-learn/SKILL.md` 复制到对应 Agent 的 skills 目录：

- Codex：`~/.codex/skills/work-learn/SKILL.md`
- Claude Code：`~/.claude/skills/work-learn/SKILL.md`
- CodeBuddy：`~/.codebuddy/skills/work-learn/SKILL.md`
- 其他支持 Skill 的 Agent：查阅其文档，放入对应的 skills 目录

例如（在仓库根目录执行）：

```bash
mkdir -p ~/.codex/skills/work-learn
cp skills/work-learn/SKILL.md ~/.codex/skills/work-learn/SKILL.md
```

放置后重启 Agent。之后在对话里用自然语言触发即可：

> 整理刚才这段对话，把有用的英语保存到我的语料库。

Skill 会先挑选高价值表达、给出更自然的说法，并在你确认后才调用 `save_material` 保存。

## 验证

配置完成后，在 Agent 里说：

> 用 work-learn 新建一个 session，source 用 codebuddy，topic 用 database migration。

随后调用：

> 保存这句学习材料到我的语料库：We should decouple the validation layer from the persistence layer.

正常返回即接入成功。

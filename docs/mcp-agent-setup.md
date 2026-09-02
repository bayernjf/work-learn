# MCP Agent 接入配置

本文档描述的是**本地 stdio MCP**（开发者/自托管方式）：用户在本机运行 MCP 进程并手动配置 token。

面向普通用户的**远程 MCP**（在 Agent 里填一条 URL，经授权后连接，无需本地 clone 或安装）已上线第一版，方案见 [远程 MCP 方案](remote-mcp.md)。不支持远程 MCP 的客户端继续使用本文的本地 stdio 方式。

## 远程 MCP（推荐，最简单）

端点（Streamable HTTP，无状态）：

```text
https://work-learn.pages.dev/api/mcp
```

> 推荐走 Cloudflare Pages 代理入口（中国大陆网络可直连，实测鉴权正常）。直连后端
> `https://work-learn-api.vercel.app/api/mcp` 在部分网络（中国大陆）不可达；海外/无墙环境两者皆可。

在支持远程 MCP 的 Agent（Claude Desktop、Cursor 等）里添加该 URL，并在请求头携带：

```text
Authorization: Bearer <your-access-token>
```

其中 `<your-access-token>` 是登录 Web 端后在 “Connect an agent” 面板里创建的 **Personal Access Token**。创建时可以选有效期（默认 90 天，也可以选永久）；在过期或吊销之前不需要做任何续期。建议每个 agent 单独发一个，这样吊销时只影响那一个。支持 OAuth 的 MCP agent 也可以直接连接 Remote MCP URL，由 agent 触发浏览器授权。

远程端点与本地 MCP 提供完全相同的 21 个工具：`create_session`、`save_material`、`save_question_translation`、`search_corpus`、`get_review_items`、`mark_mastered`、`snooze_review`、`generate_practice`、`get_user_patterns`、`get_reuse_summary`、`record_reuse`、`suggest_reuse`、`suggest_reuse_candidates`、`configure_reuse_nudges`、`list_expressions`、`cluster_intents`、`merge_intents`、`split_intent`、`record_practice`、`get_practice_history`、`generate_adaptive_practice`。

把 Work Learn MCP 服务器接入本地 Agent，让 Agent 能调用上面这 21 个工具。

## 前置条件

- 已把本仓库 clone 到本机。下文示例统一用 `/path/to/work-learn` 代指这个目录，照抄时替换成你自己的路径
- 本机已安装 pnpm 和 Node 20+（Supabase JS 的 realtime 客户端原本要求 Node 22 原生 WebSocket，已由 API 端 `ws` polyfill 解决；本地 stdio MCP / CLI 走 `better-sqlite3`，按安装时所用 Node 编译原生模块即可，无需 22+）
- Hono API 可访问（默认 `http://localhost:3000`，部署后改为线上 URL）
- 已在 Web 端创建一个 personal access token

`WORK_LEARN_ACCESS_TOKEN` 只接受 personal access token。也可以改用
`WORK_LEARN_ACCESS_TOKEN_FILE` 指向一个存着 token 的文件，配置里就只留路径（见下文
「不想让 token 出现在对话里」）。两个都设时以文件为准。早期版本支持的
`WORK_LEARN_REFRESH_TOKEN` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` 已移除：它们把账号级凭证写进
agent 的配置文件，而 personal access token 本身就长期有效、可单独吊销。旧配置里如果还留着这三个
变量，删掉即可；MCP 服务器启动时会顺手清理遗留的 `packages/mcp-server/.session-token.json`。

## 一键安装（推荐）

先把本仓库 clone 到本机并执行 `pnpm install`（本地 stdio MCP 仍需要这份代码来启动服务进程）。
然后在 Web 端登录后创建 token，运行：

```bash
npx @work-learn/setup --repo /path/to/work-learn
```

安装器会问你要 token，粘贴进去即可。不要用 `--token` 传:命令行参数会进 shell 历史文件，
执行瞬间也能在 `ps` 里看到。`--token` 只留给 `-y` 非交互场景（CI 之类）。

### 不想让 token 出现在对话里

如果是让 agent 帮你装，粘贴 token 就等于把它说给 agent 听，而对话是会被记录的（发给模型
提供方，也落在本地 transcript 里）。这种情况用 `--token-file`。

第一条自己在终端里跑。它是问你要 token，所以 token 也不会进 shell 历史；`umask 077`
让文件在创建时就是 `0600`，不存在先可读再 `chmod` 的窗口：

```bash
umask 077 && printf 'Paste your token: ' && read -rs t && printf '%s' "$t" > ~/.work-learn-token && unset t && echo
```

（提示语单独 `printf`，不用 `read -p`——在 zsh 里 `-p` 表示"从协程读"，会直接报错。）

第二条可以交给 agent，因为路径不是秘密：

```bash
npx @work-learn/setup --repo /path/to/work-learn --token-file ~/.work-learn-token
```

配置文件里存的也是路径，MCP 服务器每次启动时才去读。所以整条链上没有任何环节接触到
token 本身。

注意：让 agent 去 `cat` 这个文件同样是泄漏——工具返回的内容一样进对话。有用的只是"只给路径"
这一层间接。

向导会自动探测 Codex、Claude Code、Claude Desktop、CodeBuddy、Cursor、OpenCode，把正确格式的 MCP
配置写进各自的配置文件（写入前会自动备份），并可选安装 Work Learn Skill。

只配置指定 Agent 可重复使用 `--agent`：`--agent codex --agent codebuddy`。可用的 id 是
`codex`、`claude-code`、`claude-desktop`、`codebuddy`、`cursor`、`opencode`——Claude Code 和
Claude Desktop 是两个产品、两个配置文件，要分别指定。
非交互环境加 `-y`。其余选项见 `npx @work-learn/setup --help`。

下文的手动配置仅在你不想使用安装器或需要自定义时参考。

## 运行命令（两种方式）

方式 A：支持 `cwd` 的 Agent 使用 pnpm（推荐，路径无需写死 node_modules）

```json
{
  "command": "pnpm",
  "args": ["--filter", "@work-learn/mcp-server", "exec", "tsx", "src/server.ts"],
  "cwd": "/path/to/work-learn",
  "env": {
    "WORK_LEARN_API_URL": "http://localhost:3000",
    "WORK_LEARN_ACCESS_TOKEN": "<your Work Learn personal access token>"
  }
}
```

方式 B：不支持 `cwd` 的 Agent 使用绝对路径

```json
{
  "command": "/path/to/work-learn/packages/mcp-server/node_modules/.bin/tsx",
  "args": ["/path/to/work-learn/packages/mcp-server/src/server.ts"],
  "env": {
    "WORK_LEARN_API_URL": "http://localhost:3000",
    "WORK_LEARN_ACCESS_TOKEN": "<your Work Learn personal access token>"
  }
}
```

## Claude Code / Claude Desktop

两个产品的配置文件不同，但结构一样。Claude Code 编辑 `~/.claude.json`，Claude Desktop 编辑
`~/Library/Application Support/Claude/claude_desktop_config.json`，都在顶层的 `mcpServers` 下加：

```json
{
  "mcpServers": {
    "work-learn": {
      "command": "pnpm",
      "args": ["--filter", "@work-learn/mcp-server", "exec", "tsx", "src/server.ts"],
      "cwd": "/path/to/work-learn",
      "env": {
        "WORK_LEARN_API_URL": "http://localhost:3000",
        "WORK_LEARN_ACCESS_TOKEN": "<your Work Learn personal access token>"
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
      "command": "/path/to/work-learn/packages/mcp-server/node_modules/.bin/tsx",
      "args": ["/path/to/work-learn/packages/mcp-server/src/server.ts"],
      "env": {
        "WORK_LEARN_API_URL": "https://work-learn.pages.dev",
        "WORK_LEARN_ACCESS_TOKEN": "<your Work Learn personal access token>"
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
command = "/path/to/work-learn/packages/mcp-server/node_modules/.bin/tsx"
args = ["/path/to/work-learn/packages/mcp-server/src/server.ts"]
env = { WORK_LEARN_API_URL = "http://localhost:3000", WORK_LEARN_ACCESS_TOKEN = "<your Work Learn personal access token>" }
```

## Hermes / OpenClaw / OpenCode / Pi

这几个平台都支持本地命令型 MCP 服务器，字段名基本一致（`command`、`args`、`env`，部分支持 `cwd`）。请按各平台的实际配置格式套用方式 A 或方式 B，并把 `<your Work Learn personal access token>` 换成你的 token。若某个平台不支持 `env` 字段，可先通过 shell 导出环境变量再启动服务器。

## 安装 Skill（可选）

MCP 提供工具能力，Skill 则告诉 Agent 何时保存、如何整理。两者配合使用；不装 Skill 时 MCP 工具仍然可用，只是需要你手动下指令（例如直接说"调用 save_material"）。

前提：上面的 MCP 服务器已配置并连接成功。

### 一键安装（推荐）

脚本会自动检测本机所有支持 Skill 的 Agent（Codex、Claude Code、CodeBuddy、Cursor、OpenCode、Pi 等），把 Skill 装进对应的 skills 目录：

```bash
curl -fsSL https://work-learn.pages.dev/scripts/install-skill.sh | WORK_LEARN_SKILL_BASE=https://work-learn.pages.dev bash
```

> 命令从 Work Learn 站点自身取脚本，而不是 `raw.githubusercontent.com` —— 后者在部分网络下无法访问。

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

Skill 会挑选高价值表达、给出更自然的说法，把抽取结果展示给你之后调用 `save_material` 保存。如果这段对话里没有值得保存的英语，它会直接说明并且不保存 —— 这是设计行为，不是故障。

完整的使用说明（触发语、搜索、复习、问题翻译自动模式）见[使用手册](usage.md)。

## 验证

配置完成后，在 Agent 里说：

> 用 work-learn 新建一个 session，source 用 codebuddy，topic 用 database migration。

随后调用：

> 保存这句学习材料到我的语料库：We should decouple the validation layer from the persistence layer.

正常返回即接入成功。

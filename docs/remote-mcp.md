# 远程 MCP 方案

> 状态：Remote MCP v2 已实现。`POST /api/mcp` 使用无状态 Streamable HTTP，并同时支持 Supabase JWT、Personal Access Token 与 OAuth access token。Web 端可生成/撤销 PAT；Hono 提供 MCP OAuth 2.1 动态注册、授权、code exchange、refresh token 与 consent 页面。

## 1. 背景

当前 `packages/mcp-server` 只实现了 stdio transport：用户必须在本机 clone 仓库、安装 Node/pnpm、手动获取 Supabase access token 并编辑各 Agent 的配置文件。这条路对开发者成立，但对“通过网页访问 Work Learn 的普通用户”不成立——浏览器无法在用户机器上 spawn 本地进程，也无法修改 Claude、Cursor 等客户端的 MCP 配置。

远程 MCP 把同一个工具层部署成线上 HTTP 端点，用户在 Agent 里填一条 URL（或点 deeplink），经授权后即可使用 `save_material`、`search_corpus` 等工具，无需安装任何东西。

## 2. 目标与非目标

### 目标

- 普通用户在 Web 登录后，复制一条 MCP URL 就能在支持远程 MCP 的 Agent 中连接。
- 复用现有 `McpServer` 工具注册逻辑和 Hono API，不维护两套工具实现。
- 认证基于 Supabase Auth，不向 Agent 暴露 service role key。
- 与现有本地 stdio MCP 并存：远程面向普通用户，stdio 面向开发者/自托管/终端 Agent。

### 非目标（第一版）

- 不做资源（resources）和提示词（prompts）能力，只提供 tools。
- 不做服务端推送、长连接 SSE 会话，采用无状态请求-响应模式。
- 不做多租户计费、团队配额。
- 不替代 Web 复习界面，MCP 只负责采集与查询。

## 3. 架构

```text
支持 MCP 的 Agent (Claude Desktop / Cursor / ...)
        │  HTTPS (Streamable HTTP)
        ▼
Hono API on Vercel
  └─ POST /api/mcp
        │  Bearer token 校验 (Supabase JWT / PAT / OAuth)
        ▼
packages/mcp-server  (同一套工具逻辑)
        │  service role + RLS
        ▼
Supabase
```

远程端点和现有业务 API 部署在同一个 Vercel 项目里，复用环境变量、域名和部署流水线，不新增常驻服务。

## 4. 传输层

- 使用 MCP 的 **Streamable HTTP transport**（`StreamableHTTPServerTransport`），不要使用已被取代的 SSE-only 模式。
- 在 Vercel serverless 上采用**无状态模式**：每个 HTTP 请求新建一个 transport 实例处理完即销毁，不跨请求保持 `session_id`。这避免了 serverless 环境无法维持长连接/进程内会话的问题。
- 端点只接受 `POST`，`Content-Type: application/json` 或 `application/json-seq`。
- CORS 放行浏览器 consent/metadata 请求；接口不依赖 Cookie，允许 `Authorization` 与 `Content-Type` 头。

## 5. 认证

Remote MCP 支持三种 Bearer token：

### Personal Access Token

- Web 端提供一个“MCP 连接”页面，用户可生成、查看、撤销一个长期 token。
- token 在服务端只存哈希（或直接签发 Supabase JWT 并设置较长有效期，配合撤销表）。
- Agent 连接 `https://work-learn-api.vercel.app/api/mcp` 时在 `Authorization: Bearer <token>` 头携带。
- Hono 中间件校验 token，解析出 `user_id`，再用 service-role context 调工具；所有查询都显式限定 `user_id`。

### OAuth 2.1

- 复用 Supabase Auth，在 Hono 上实现 MCP 规范的 OAuth 2.1 端点：
  - `GET /api/mcp/.well-known/oauth-protected-resource`
  - `GET /api/oauth/.well-known/oauth-authorization-server`
  - `POST /api/oauth/register`
  - `GET /api/oauth/authorize`
  - `POST /api/oauth/decision`
  - `POST /api/oauth/token`
- Agent 连接 `https://work-learn-api.vercel.app/api/mcp` 后动态注册 client，浏览器跳到 Work Learn consent 页；用户登录并批准后回调 agent。
- authorization code 必须携带 PKCE S256 `code_verifier`；access token 1 小时过期，refresh token 30 天过期并在刷新时轮转。
- access token 是 opaque 随机串（`wloat_` 前缀），只以 SHA-256 哈希存进 `oauth_tokens`，校验走一次数据库查询——和 PAT 同一条路径。因此没有 JWKS endpoint：没有 JWT 需要客户端本地验签，吊销也能立即生效。

上线前必须执行 `supabase/migrations/007_oauth.sql`，并在 Vercel 配置 `WORK_LEARN_PUBLIC_API_URL`、`WORK_LEARN_WEB_URL`。

## 6. 代码组织

把工具注册逻辑与 transport 解耦：

```text
packages/mcp-server/
  src/
    tools.ts      # createServer() 返回注册好工具的 McpServer，纯逻辑、可复用
    index.ts      # 工具函数（createSession/saveMaterial/...），HTTP 调用层
    stdio.ts      # StdioServerTransport 启动入口（现有 server.ts 内容）
    http.ts       # 导出 createMcpRequestHandler()，供 Hono 挂载
apps/api/src/
    app.ts        # app.route('/api/mcp', mcpRoute)
    routes/mcp.ts # Hono 路由：鉴权 + 调用 createMcpRequestHandler
```

- `tools.ts` 接收一个已绑定用户身份的“能力上下文”（内部调用现有 Hono service 或直接用受限 Supabase client），不感知 transport。
- stdio 和 http 两个入口都用同一个 `createServer()`。
- 远程模式下，`apiUrl`/`accessToken` 这层 HTTP 自调用消失，直接在服务端用用户上下文操作数据，减少一跳。

## 7. 工具清单

与 stdio 版本一致：

- `create_session`
- `save_material`
- `search_corpus`
- `get_review_items`
- `mark_mastered`

工具入参继续由 `@work-learn/shared-schema` 的 Zod schema 校验。

## 8. 负载与成本

- MCP 是控制面，只在用户主动让 Agent 保存/搜索/复习时触发，每次一个无状态请求。
- 不转发完整对话、不做模型推理（语料整理由 Agent 端模型完成）、不持长连接。
- 跑在现有 Vercel Functions 上，与 `/api/materials` 等路由同量级；早期调用量小，Vercel Hobby/Pro 与 Supabase 免费档可覆盖。
- 加一个按用户/IP 的简单 rate limit，防止客户端异常重试刷量。

## 9. 安全

- 所有远程请求必须鉴权，未带 token 返回 401。
- 服务端用受限用户上下文访问数据，RLS 保证用户只能读写自己的行。
- 不在工具返回里泄露 service role key、内部错误栈或其他用户数据。
- token 仅通过 HTTPS 传输；Personal Access Token 只在生成时展示一次。
- 输入经 Zod 校验后再落库，延续现有脱敏与确认原则。

## 10. 落地步骤

1. 重构 `packages/mcp-server`：抽出 `createServer()`，分离 stdio/http 入口。
2. 在 `apps/api` 增加 `/api/mcp` 路由和 Bearer token 鉴权中间件。
3. Web 增加“连接 Agent / MCP”页面，展示 URL 与 token 管理。
4. 用 MCP Inspector 或 `curl` 验证 Streamable HTTP 握手与工具调用。
5. 写 Claude Desktop / Cursor 远程连接文档。
6. 第二版补 OAuth 自动授权。

## 11. 风险与待确认

- 各 Agent 对 Streamable HTTP 与 OAuth 的支持程度不一，需要实测兼容性；不支持远程 MCP 的客户端继续走 stdio。
- Vercel serverless 对 `application/json-seq` 流式响应的表现需验证，必要时降级为纯 JSON 单响应。
- Personal Access Token 的有效期与撤销策略需产品确认。

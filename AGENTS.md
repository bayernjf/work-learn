# AGENTS.md — work-learn

供 AI coding agents（Claude Code / Codex / Cursor / Copilot 等）在本仓库工作时自动读取。

## 项目概览
Work Learn：跨 AI Agent 的个人英语语料学习系统。把用户与 Claude、ChatGPT、Hermes、OpenClaw 等 Agent
的真实工作对话，转化为可复用、可搜索、可复习的英语学习材料。

闭环：`Agent 中调用 Skill -> 整理当前对话 -> 展示抽取结果 -> MCP/API 保存 -> Web 查看和复习`
- Skill：理解和整理当前对话
- MCP / API：保存、搜索、复习、跨 Agent 同步
- CLI：终端会话与无 Skill 场景的兼容接入
- Companion：本地客户端（M1 最小壳、M2 全局快捷键、M3 离线兜底、M4 自动采集 + rc-hook 录制）

## 技术栈
- pnpm workspace（`apps/`、`api/`、`packages/`、`skills/`、`supabase/`），`packageManager: pnpm@10.12.1`
- Node >= 24 < 25（`engines` 锁定 24.x；Vercel 已下线 20.x，见 handoff.md「Node 24 升级」）
- TypeScript 5.7、wrangler 4.86（Cloudflare）、Vercel（`vercel.json`）、Supabase

## 常用命令
```bash
pnpm install
pnpm dev:web / dev:api / dev:cli / dev:companion    # 各子应用
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

## 约定
- 包管理器是 pnpm，**不要**用 npm/yarn。
- Node 版本锁在 24.x（`onlyBuiltDependencies: better-sqlite3、electron`），升级前先确认原生依赖有对应 ABI 的预编译包：`better-sqlite3` 的 GitHub release 资产名里带 `node-v<ABI>`（Node 24 = 137），npm 上已发布的版本号可能与 GitHub tag 对不上。
- 文档在 `docs/`（usage、product-proposal、brand 等），落地页仓库是 `work-learn-landing`。
- 落地页文案（MCP 工具数、接入端点、支持的 Agent 列表）依赖本仓库现状，改产品后同步更新落地页。

## 不要做的事
- 不要用 npm/yarn，也不要擅自升级 Node 主版本。
- 不要把用户对话内容用于学习材料之外的用途（隐私边界见 `docs/usage.md`）。
- 不要提交 `dist/` 与 `.env`。
- 不要跳过 `git pull --rebase` 直接 push。

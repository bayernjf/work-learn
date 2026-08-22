import type { ReactNode } from "react";

/**
 * Entries are functions when the copy carries inline markup or values, so the
 * Chinese side can reorder clauses instead of matching English word order.
 */
export const en = {
  meta: { title: "Work Learn | Your personal English learning layer" },

  common: {
    signIn: "Sign in",
    createAccount: "Create account",
    signOut: "Sign out",
    email: "Email",
    password: "Password",
    tryAgain: "Try again",
    copy: "Copy",
    copied: "Copied",
    copyUrl: "Copy URL",
    language: "Language",
  },

  header: {
    tagline: "Personal learning layer",
    account: (mail: string) => `Signed in as ${mail}`,
    unknownAccount: "unknown account",
  },

  desk: {
    skip: "Skip to your corpus",
    title: "Your corpus",
    summaryEmpty: "Nothing saved yet",
    summary: (count: number, sources: number, last: string) =>
      `${count} saved · ${sources} source${sources === 1 ? "" : "s"} · last ${last}`,
    couldNotLoad: "Could not load",
    searchPlaceholder: "Search expressions, topics, corrections…",
    searchPlaceholderEmpty: "Search opens once you save your first expression",
    searchLabel: "Search your corpus",
    loadingLabel: "Loading your corpus",
    all: "All",
    newest: "Newest",
    oldest: "Oldest",
    noMatchQuery: (query: string) => `Nothing matches “${query}” yet.`,
    noMatchTopic: "Nothing matches this topic yet.",
  },

  time: {
    minutes: (value: number) => `${value}m ago`,
    hours: (value: number) => `${value}h ago`,
    days: (value: number) => `${value}d ago`,
  },

  errors: {
    loadCorpus: "Could not load your corpus",
    completeReview: "Could not complete this review",
    config: "Could not load Work Learn configuration",
    materials: "Could not load your learning materials",
    reviews: "Could not load your review items",
    tokensLoad: "Could not load personal access tokens",
    tokenCreate: "Could not create personal access token",
    tokenRevoke: "Could not revoke personal access token",
  },

  empty: {
    heading: "Your corpus starts with one conversation.",
    body: "Connect an agent below — add the MCP server, install the Skill, then ask it to save the useful English from a conversation.",
    prompt: "“Save the useful English from this conversation.”",
    cta: "Set up your agent",
  },

  auth: {
    eyebrow: "Start with your work",
    headline: "Keep the English that moves your work forward.",
    lede: "Save useful moments from your AI conversations, then turn them into practice.",
    remember: "Keep me signed in for 7 days",
    confirmEmail: "Check your email to confirm your account, then sign in.",
  },

  config: {
    eyebrow: "Setup required",
    headline: "Connect your learning layer.",
    heading: "Work Learn could not load its configuration.",
    body: (): ReactNode => <>Refresh in a moment. If this persists, check that the Work Learn API is deployed and has <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> configured.</>,
  },

  connect: {
    summary: "Connect an agent",
    intro: (landingUrl: string): ReactNode => <>New here? Read the <a className="inline-link" href={landingUrl} target="_blank" rel="noopener noreferrer">Work Learn landing page<span className="external-icon" aria-hidden="true">↗</span></a> for the full product walkthrough.</>,
    autoLabel: "Let your agent set it up",
    autoCopy: "Paste this into the agent you want to connect. Your endpoint and token are already filled in.",
    autoNote: "The prompt carries a live token. If you have not created a personal access token below, it is your session token and expires in about an hour — create one first, then copy again.",
    autoPrompt: (endpoint: string, token: string, skillUrl: string) => `Set up the Work Learn MCP server in the agent client you are running right now.

Endpoint: ${endpoint} (remote MCP over Streamable HTTP, stateless)
Auth header: Authorization: Bearer ${token}
Server name: work-learn

Do this:
1. Work out which client this is and find its MCP config file (for example ~/.codex/config.toml, ~/.claude.json, ~/.cursor/mcp.json, ~/.config/opencode/opencode.json). Ask me if you cannot tell.
2. Back that file up, then add "work-learn" with the endpoint and auth header above. Leave every other MCP server in the file exactly as it is.
3. Use the token verbatim. Never invent, guess, or truncate one. Treat it as a secret: do not echo it back to me, log it, or write it anywhere except that config file.
4. If this client cannot speak remote MCP over Streamable HTTP, do not improvise a workaround — say so and stop, and I will use the local installer instead.
5. Recommended: also install the Work Learn skill, which tells you when to save material. Download ${skillUrl} into this client's skills folder as work-learn/SKILL.md.
6. Tell me to restart the client, then confirm these five tools are available: create_session, save_material, search_corpus, get_review_items, mark_mastered.`,
    manualLabel: "Manual setup",
    step1: "1. Connect over remote MCP (no local install needed).",
    hint1: "Create a personal access token below and use it as the Bearer token. It stays valid until you revoke it, unlike your short-lived session token.",
    hint1b: (): ReactNode => <>In agents that support remote MCP (Streamable HTTP), add the URL above and set the <code>Authorization</code> header to <code>Bearer &lt;personal-access-token&gt;</code>. For persistent local agents that only support stdio, use option 2.</>,
    step2: "2. Or run the local installer. Your access token is already filled in.",
    hint2: (): ReactNode => <>The installer detects Codex, Claude Desktop, CodeBuddy, Cursor, and OpenCode, writes the correct MCP config for each one (with a backup), and can install the Skill too. When it asks for the repo path, point it at your local <code>work-learn</code> clone. Use this for agents that only support stdio MCP.</>,
    manualSummary: "Prefer to paste the config yourself?",
    hint2b: (docsUrl: string): ReactNode => <>The token is short-lived. For long-running agents, pass <code>--refresh-token</code>, <code>--supabase-url</code>, and <code>--supabase-anon-key</code> to the installer (or set <code>WORK_LEARN_REFRESH_TOKEN</code>, <code>SUPABASE_URL</code>, and <code>SUPABASE_ANON_KEY</code>) as shown in the <a className="inline-link" href={docsUrl} target="_blank" rel="noopener noreferrer">setup docs<span className="external-icon" aria-hidden="true">↗</span></a>.</>,
    step3: "3. Install the Skill (optional). It tells your agent when to save.",
    tabsLabel: "Install Skill per agent",
    restart: (): ReactNode => <>Restart your agent, then ask: <code>&ldquo;Save the useful English from this conversation.&rdquo;</code></>,
    notes: {
      universal: "Installs into every detected skills folder.",
      codex: "Restart Codex after installing.",
      claude: "Restart Claude Code after installing.",
      codebuddy: "CLI and desktop share this folder.",
      cursor: "Restart Cursor after installing.",
      opencode: "Restart OpenCode after installing.",
      pi: "Restart Pi after installing.",
    },
  },

  tokens: {
    empty: "No personal access tokens yet. Create one to connect a remote MCP agent.",
    revoked: "Revoked",
    lastUsed: (date: string) => `Last used ${date}`,
    expires: (date: string) => ` · Expires ${date}`,
    never: "Never",
    revoke: "Revoke",
    copyNow: "Copy this token now. It will not be shown again.",
    namePlaceholder: "Token name, e.g. Claude Desktop",
    creating: "Creating…",
    create: "Create token",
    errLoad: "Could not load tokens",
    errCreate: "Could not create token",
    errRevoke: "Could not revoke token",
  },

  review: {
    eyebrow: "Today",
    heading: "Review what is still useful.",
    due: (count: number) => `${count} due`,
    empty: "No reviews due. Keep working, then save the next useful expression.",
    mark: "Mark mastered",
    fallback: "Saved expression",
  },

  material: {
    fallback: "Saved learning material",
    better: "Better",
    why: "Why",
    reuse: "Reuse",
    vocabulary: "Vocabulary",
  },

  footer: {
    landing: "Product overview",
    repo: "GitHub",
    docs: "Setup docs",
  },

  consent: {
    invalidEyebrow: "Invalid request",
    invalidHeadline: "That OAuth link is incomplete.",
    missingParams: "Missing required OAuth parameters.",
    missingParam: (name: string) => `Missing OAuth parameter: ${name}`,
    eyebrow: "MCP authorization",
    headline: "Allow Work Learn access?",
    copy: "This agent will be able to save useful English, search your corpus, and read review items through your Work Learn account.",
    defaultClient: "An AI agent",
    signInPrompt: "Sign in to approve this connection.",
    signUp: "Sign up",
    deny: "Deny",
    approve: "Approve",
    returning: "Returning…",
    authorizing: "Authorizing…",
    errComplete: "Could not complete authorization",
  },
};

export type Strings = typeof en;

export const zh: Strings = {
  meta: { title: "Work Learn｜你自己的英语学习层" },

  common: {
    signIn: "登录",
    createAccount: "注册",
    signOut: "退出",
    email: "邮箱",
    password: "密码",
    tryAgain: "重试",
    copy: "复制",
    copied: "已复制",
    copyUrl: "复制地址",
    language: "语言",
  },

  header: {
    tagline: "你自己的英语学习层",
    account: (mail: string) => `已登录：${mail}`,
    unknownAccount: "未知账号",
  },

  desk: {
    skip: "跳到语料",
    title: "你的语料",
    summaryEmpty: "还没有存过东西",
    summary: (count: number, sources: number, last: string) =>
      `${count} 条 · ${sources} 个来源 · 最近 ${last}`,
    couldNotLoad: "加载失败",
    searchPlaceholder: "搜表达、话题、纠错…",
    searchPlaceholderEmpty: "存下第一条表达后就能搜索",
    searchLabel: "搜索你的语料",
    loadingLabel: "正在加载语料",
    all: "全部",
    newest: "最新",
    oldest: "最早",
    noMatchQuery: (query: string) => `没有匹配「${query}」的内容。`,
    noMatchTopic: "这个话题下还没有内容。",
  },

  time: {
    minutes: (value: number) => `${value} 分钟前`,
    hours: (value: number) => `${value} 小时前`,
    days: (value: number) => `${value} 天前`,
  },

  errors: {
    loadCorpus: "语料加载失败",
    completeReview: "标记复习完成失败",
    config: "读取 Work Learn 配置失败",
    materials: "学习材料加载失败",
    reviews: "复习列表加载失败",
    tokensLoad: "personal access token 列表加载失败",
    tokenCreate: "personal access token 创建失败",
    tokenRevoke: "personal access token 吊销失败",
  },

  empty: {
    heading: "语料从一次对话开始。",
    body: "在下面接入一个 agent：加上 MCP server、安装 Skill，然后让它把对话里有用的英文存下来。",
    prompt: "“整理刚才这段对话”",
    cta: "配置你的 agent",
  },

  auth: {
    eyebrow: "从你的工作开始",
    headline: "留住推动你工作的那些英文。",
    lede: "把 AI 对话里有用的片段存下来，再变成练习。",
    remember: "7 天内记住我",
    confirmEmail: "去邮箱确认账号，然后回来登录。",
  },

  config: {
    eyebrow: "需要配置",
    headline: "接上你的学习层。",
    heading: "Work Learn 读不到自己的配置。",
    body: (): ReactNode => <>稍后刷新一次。如果一直这样，检查 Work Learn API 是否已部署，以及是否配了 <code>SUPABASE_URL</code> 和 <code>SUPABASE_ANON_KEY</code>。</>,
  },

  connect: {
    summary: "接入 agent",
    intro: (landingUrl: string): ReactNode => <>第一次用？先看 <a className="inline-link" href={landingUrl} target="_blank" rel="noopener noreferrer">Work Learn 介绍页<span className="external-icon" aria-hidden="true">↗</span></a>，那里有完整的产品说明。</>,
    autoLabel: "让 Agent 帮你配置",
    autoCopy: "把这段粘给你想接入的 Agent，端点和 token 都已经填好了。",
    autoNote: "这段提示里带着一个真实可用的 token。如果你还没在下面创建 personal access token，它就是你的会话 token，约 1 小时后过期 —— 建议先创建一个，再重新复制。",
    autoPrompt: (endpoint: string, token: string, skillUrl: string) => `帮我在你现在运行的这个 Agent 客户端里接入 Work Learn 的 MCP 服务器。

端点：${endpoint}（远程 MCP，Streamable HTTP，无状态）
认证请求头：Authorization: Bearer ${token}
服务器名称：work-learn

请按以下步骤做：
1. 判断这是哪个客户端，找到它的 MCP 配置文件（例如 ~/.codex/config.toml、~/.claude.json、~/.cursor/mcp.json、~/.config/opencode/opencode.json）。判断不出来就先问我。
2. 先备份该文件，再以 "work-learn" 为名写入上面的端点和认证请求头。文件里已有的其他 MCP 服务器一个都不要改。
3. token 原样使用，不要凭空编造、猜测或截断。把它当密钥对待：不要回显给我、不要写进日志，除了那个配置文件之外不要写到任何地方。
4. 如果这个客户端不支持 Streamable HTTP 的远程 MCP，不要自己想变通办法 —— 直接告诉我并停下，我改用本地安装器。
5. 建议顺便装上 Work Learn 的 skill，它会告诉你何时该保存材料：把 ${skillUrl} 下载到这个客户端的 skills 目录，路径为 work-learn/SKILL.md。
6. 告诉我需要重启客户端，然后确认这 5 个工具可用：create_session、save_material、search_corpus、get_review_items、mark_mastered。`,
    manualLabel: "手动配置",
    step1: "1. 用远程 MCP 接入（不用装任何东西）。",
    hint1: "在下面创建一个 personal access token，拿它当 Bearer token。它在你主动吊销前一直有效，不像会话 token 那样很快过期。",
    hint1b: (): ReactNode => <>在支持远程 MCP（Streamable HTTP）的 agent 里，填上面那个地址，并把 <code>Authorization</code> 请求头设成 <code>Bearer &lt;personal-access-token&gt;</code>。只支持 stdio 的常驻本地 agent 请用方式 2。</>,
    step2: "2. 或者跑本地安装器，你的 access token 已经填好了。",
    hint2: (): ReactNode => <>安装器会检测 Codex、Claude Desktop、CodeBuddy、Cursor 和 OpenCode，为每个写入正确的 MCP 配置（并留备份），也可以顺带装上 Skill。它问仓库路径时，指向你本地的 <code>work-learn</code> clone。只支持 stdio MCP 的 agent 用这个。</>,
    manualSummary: "想自己粘配置？",
    hint2b: (docsUrl: string): ReactNode => <>这个 token 很快过期。常驻运行的 agent 请给安装器传 <code>--refresh-token</code>、<code>--supabase-url</code> 和 <code>--supabase-anon-key</code>（或设置 <code>WORK_LEARN_REFRESH_TOKEN</code>、<code>SUPABASE_URL</code> 和 <code>SUPABASE_ANON_KEY</code>），具体见 <a className="inline-link" href={docsUrl} target="_blank" rel="noopener noreferrer">配置文档<span className="external-icon" aria-hidden="true">↗</span></a>。</>,
    step3: "3. 安装 Skill（可选）。它负责告诉 agent 什么时候该存。",
    tabsLabel: "按 agent 选择安装命令",
    restart: (): ReactNode => <>重启 agent，然后说：<code>“整理刚才这段对话”</code></>,
    notes: {
      universal: "装进所有检测到的 skills 目录。",
      codex: "装完重启 Codex。",
      claude: "装完重启 Claude Code。",
      codebuddy: "CLI 和桌面端共用这个目录。",
      cursor: "装完重启 Cursor。",
      opencode: "装完重启 OpenCode。",
      pi: "装完重启 Pi。",
    },
  },

  tokens: {
    empty: "还没有 personal access token。创建一个来接入远程 MCP agent。",
    revoked: "已吊销",
    lastUsed: (date: string) => `最近使用 ${date}`,
    expires: (date: string) => ` · ${date} 过期`,
    never: "从未",
    revoke: "吊销",
    copyNow: "现在就复制这个 token，它不会再显示第二次。",
    namePlaceholder: "token 名称，例如 Claude Desktop",
    creating: "创建中…",
    create: "创建 token",
    errLoad: "token 列表加载失败",
    errCreate: "token 创建失败",
    errRevoke: "token 吊销失败",
  },

  review: {
    eyebrow: "今天",
    heading: "回顾还用得上的那些。",
    due: (count: number) => `${count} 条待复习`,
    empty: "没有待复习的。继续工作，下次遇到有用的表达再存。",
    mark: "标为已掌握",
    fallback: "已保存的表达",
  },

  material: {
    fallback: "已保存的学习材料",
    better: "更自然的说法",
    why: "为什么",
    reuse: "造句练习",
    vocabulary: "词汇",
  },

  footer: {
    landing: "介绍页",
    repo: "GitHub",
    docs: "配置文档",
  },

  consent: {
    invalidEyebrow: "请求无效",
    invalidHeadline: "这个 OAuth 链接不完整。",
    missingParams: "缺少必需的 OAuth 参数。",
    missingParam: (name: string) => `缺少 OAuth 参数：${name}`,
    eyebrow: "MCP 授权",
    headline: "允许访问 Work Learn？",
    copy: "这个 agent 将能通过你的 Work Learn 账号保存有用的英文、搜索你的语料、读取复习项。",
    defaultClient: "某个 AI agent",
    signInPrompt: "登录后才能批准这次连接。",
    signUp: "注册",
    deny: "拒绝",
    approve: "批准",
    returning: "正在返回…",
    authorizing: "授权中…",
    errComplete: "授权失败",
  },
};

export const locales = { en, zh };
export type Locale = keyof typeof locales;

export const LOCALE_STORAGE_KEY = "work-learn.locale";

/** For modules that throw outside the React tree and cannot use the hook. */
export function activeStrings(): Strings {
  return localStorage.getItem(LOCALE_STORAGE_KEY) === "zh" ? zh : en;
}

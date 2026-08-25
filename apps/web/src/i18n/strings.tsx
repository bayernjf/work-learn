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

  qa: {
    heading: "Questions & translations",
    eyebrow: "Your questions, in your English",
    empty: "No questions saved yet.",
    translation: "Idiomatic English",
    question: "Your question",
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
    tokenDelete: "Could not delete personal access token",
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
    overviewLead: "Three steps, about two minutes — copy, paste, done.",
    overview: [
      ["Create a token", "One click, right below."],
      ["Pick one of three routes", "They all do the same thing. Take whichever your client supports."],
      ["Install the Skill", "One command. It is what tells your agent when to save."],
    ],
    laneToken: "Start here",
    laneRoute: "Then pick one route",
    laneFinish: "Last step, whichever route you took",
    routesLabel: "How to connect",
    routeNote: "Three ways to connect the same server — you only need one. Not sure? Take the recommended one and let the agent work out which client it is.",
    routeAuto: "Let your agent set it up",
    routeRecommended: "Recommended",
    routeRemote: "Remote MCP",
    routeInstaller: "Local installer",
    autoCopy: "Create a token above, then paste this into the agent you want to connect. Your endpoint and token are already filled in.",
    autoNote: "The prompt carries a live token. Treat it as a secret: it goes into that agent's config file and nowhere else. If it leaks, revoke that token above and issue a new one.",
    autoPrompt: (endpoint: string, token: string, skillUrl: string) => `Set up the Work Learn MCP server in the agent client you are running right now.

Endpoint: ${endpoint} (remote MCP over Streamable HTTP, stateless)
Auth header: Authorization: Bearer ${token}
Server name: work-learn

Do this:
1. Work out which client this is and find its MCP config file (for example ~/.codex/config.toml, ~/.claude.json for Claude Code, ~/.codebuddy/mcp.json, ~/.cursor/mcp.json, ~/.config/opencode/opencode.json). Ask me if you cannot tell.
2. Back that file up, then add "work-learn" with the endpoint and auth header above. Leave every other MCP server in the file exactly as it is.
3. Use the token verbatim. Never invent, guess, or truncate one. Treat it as a secret: do not echo it back to me, log it, or write it anywhere except that config file.
4. If this client cannot speak remote MCP over Streamable HTTP, do not improvise a workaround — say so and stop, and I will use the local installer instead.
5. Recommended: also install the Work Learn skill, which tells you when to save material. Download ${skillUrl} into this client's skills folder as work-learn/SKILL.md.
6. Tell me to restart the client, then confirm these five tools are available: create_session, save_material, search_corpus, get_review_items, mark_mastered.`,
    modesLabel: "Where the token goes",
    modeInline: "Token in the prompt",
    modeFile: "Token in a file",
    autoPromptFile: (tokenPath: string, skillUrl: string) => `Set up the Work Learn MCP server in the agent client you are running right now, using the local stdio installer.

My token is in this file: ${tokenPath}

Do not open, cat, or otherwise read that file. It is a password, and reading it leaks it, because tool output becomes part of this conversation. Pass the path through verbatim, and never put the token itself on a command line.

Do this:
1. Find my local work-learn clone. It needs to have had \`pnpm install\` run in it. Ask me where it is if you cannot find it.
2. From inside that clone, run: npx -y @work-learn/setup --yes --token-file ${tokenPath}
   If you run it from anywhere else, add --repo <path to the clone>.
3. That installer detects Codex, Claude Code, Claude Desktop, CodeBuddy, Cursor and OpenCode, backs up each config file before writing it, records the path instead of the token, and installs the Work Learn skill. Do not hand-edit the config files yourself.
4. If it fails, show me its output and stop. Do not fall back to putting a token in a config file.
5. Tell me to restart the client, then confirm these five tools are available: create_session, save_material, search_corpus, get_review_items, mark_mastered.

The skill it installs is the same one published at ${skillUrl}.`,
    tokenStep: "Create a personal access token. Every route below needs one.",
    tokenHint: "It only ever reaches this app's API. Issue one per agent so you can revoke that agent alone, and pick an expiry so a forgotten token stops working on its own.",
    tokenGate: "Create a token above to fill in the commands below.",
    copyGate: "Finish step 1 first — the token fills in here on its own.",
    copyGateStale: "A token is only readable once, at creation, so a reload cannot fill it back in. Create a new one above, or paste yours in by hand after copying.",
    remoteStep: "Nothing to install — paste the URL and header into your agent.",
    hint1: "Use the token you created above as the Bearer token.",
    hint1b: (): ReactNode => <>In agents that support remote MCP (Streamable HTTP), add the URL above and set the <code>Authorization</code> header to <code>Bearer &lt;personal-access-token&gt;</code>. For persistent local agents that only support stdio, switch to the <strong>Local installer</strong> tab.</>,
    installerStep: "Run one command and paste your token when it asks.",
    hint2: (): ReactNode => <>The installer asks for the token instead of taking it as a flag, so it never reaches your shell history. It detects Codex, Claude Code, Claude Desktop, CodeBuddy, Cursor, and OpenCode, writes the correct MCP config for each one (with a backup), and can install the Skill too. When it asks for the repo path, point it at your local <code>work-learn</code> clone. Use this for agents that only support stdio MCP.</>,
    manualSummary: "Prefer to paste the config yourself?",
    hint2b: (docsUrl: string): ReactNode => <>The installer writes whatever token you give it, and there is nothing to renew before it expires. Config file locations and the manual equivalent are in the <a className="inline-link" href={docsUrl} target="_blank" rel="noopener noreferrer">setup docs<span className="external-icon" aria-hidden="true">↗</span></a>.</>,
    tokenFileIntro: "Pasting the token into the installer means saying it out loud to the agent, and a conversation is recorded — it goes to the model provider and into a local transcript. Put the token in a file instead and hand over only the path. This route uses the local installer, so it needs a work-learn clone; remote MCP has no way to read a header out of a file.",
    tokenFilePathLabel: "Token file path",
    tokenFileStep1: "Run this yourself, in your own terminal. It prompts for the token, so the token never enters your shell history either.",
    tokenFileStep2: "Now this one is safe to give to an agent. A path is not a secret.",
    tokenFileNote: "The MCP server reads the file at startup, so the config stores the path and nothing on the chain touches the token. One catch: asking an agent to open or cat the file leaks it just the same, because tool output is conversation too. The prompt above tells it not to.",
    skillStep: "Install the Skill (recommended). It tells your agent when to save — without it the MCP tools are there but nothing ever calls them.",
    tabsLabel: "Install Skill per agent",
    skillUniversalLabel: "All agents",
    restart: (): ReactNode => <>Restart your agent, then ask: <code>&ldquo;Save the useful English from this conversation.&rdquo;</code></>,
    notes: {
      universal: "The one to take if you are unsure: it finds every skills folder on this machine and installs into all of them. The other tabs install for one agent only.",
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
    remove: "Remove",
    removeTitle: "Remove from this list — it is already revoked and cannot be used",
    copyNow: "Copy this token now. It will not be shown again.",
    save: "Save to file",
    saved: "Saved",
    saveHint:
      "Saving downloads work-learn-token.txt. Your download folder is the wrong home for it — the file is world-readable there and the download shows up in browser history. Move it into place, which also makes it 0600:",
    moveCommand: (path: string) =>
      `install -m 600 ~/Downloads/work-learn-token.txt ${path} && rm ~/Downloads/work-learn-token.txt`,
    lastUsedHint: "Once an agent connects, \"Last used\" turns into a timestamp. That is how you know the config took.",
    namePlaceholder: "Token name, e.g. Claude Desktop",
    expiryLabel: "Expiry",
    expiryDays: (days: number) => `Expires in ${days} days`,
    expiryNever: "No expiry",
    expiryHint: "An expiring token gives a leaked one a deadline. You can always create a new one.",
    expiryNeverHint: "This token works until you revoke it. Prefer an expiry unless you have a reason not to.",
    scopeLabel: "Permissions",
    scopeReadWrite: "Read & write",
    scopeReadOnly: "Read only",
    scopeFull: "Full access",
    scopeHint:
      "Read only lets an agent search your corpus and read review items, but it cannot save new material. Pick it when you want a search-only agent, and pick read & write only for agents that should save.",
    creating: "Creating…",
    create: "Create token",
    errLoad: "Could not load tokens",
    errCreate: "Could not create token",
    errRevoke: "Could not revoke token",
    errDelete: "Could not delete token",
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

  qa: {
    heading: "提问与翻译",
    eyebrow: "你的问题，用你的英语表达",
    empty: "还没有保存过提问。",
    translation: "地道英文",
    question: "你的提问",
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
    tokenDelete: "personal access token 删除失败",
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
    overviewLead: "一共三步，大约两分钟，复制粘贴就能搞定。",
    overview: [
      ["创建 token", "就在下面，点一下就有。"],
      ["三选一接入", "三条路做的是同一件事，挑你的客户端支持的那条。"],
      ["装上 Skill", "一条命令。它负责告诉 agent 什么时候该存。"],
    ],
    laneToken: "先做这一步",
    laneRoute: "然后三选一",
    laneFinish: "最后一步，三条路通用",
    routesLabel: "接入方式",
    routeNote: "三条路接的是同一个服务器，只需要走一条，不用都做。不确定选哪条就走推荐那条，让 agent 自己去判断你在用哪个客户端。",
    routeAuto: "让 Agent 帮你配置",
    routeRecommended: "推荐",
    routeRemote: "远程 MCP",
    routeInstaller: "本地安装器",
    autoCopy: "先在上面创建 token，然后把这段粘给你想接入的 Agent，端点和 token 都已经填好了。",
    autoNote: "这段提示里带着一个真实可用的 token。请当成密码看待：它只该进那个 agent 的配置文件，不该出现在别处。万一泄露，在上面吊销这个 token 再发一个新的。",
    autoPrompt: (endpoint: string, token: string, skillUrl: string) => `帮我在你现在运行的这个 Agent 客户端里接入 Work Learn 的 MCP 服务器。

端点：${endpoint}（远程 MCP，Streamable HTTP，无状态）
认证请求头：Authorization: Bearer ${token}
服务器名称：work-learn

请按以下步骤做：
1. 判断这是哪个客户端，找到它的 MCP 配置文件（例如 ~/.codex/config.toml、Claude Code 是 ~/.claude.json、~/.codebuddy/mcp.json、~/.cursor/mcp.json、~/.config/opencode/opencode.json）。判断不出来就先问我。
2. 先备份该文件，再以 "work-learn" 为名写入上面的端点和认证请求头。文件里已有的其他 MCP 服务器一个都不要改。
3. token 原样使用，不要凭空编造、猜测或截断。把它当密钥对待：不要回显给我、不要写进日志，除了那个配置文件之外不要写到任何地方。
4. 如果这个客户端不支持 Streamable HTTP 的远程 MCP，不要自己想变通办法 —— 直接告诉我并停下，我改用本地安装器。
5. 建议顺便装上 Work Learn 的 skill，它会告诉你何时该保存材料：把 ${skillUrl} 下载到这个客户端的 skills 目录，路径为 work-learn/SKILL.md。
6. 告诉我需要重启客户端，然后确认这 5 个工具可用：create_session、save_material、search_corpus、get_review_items、mark_mastered。`,
    modesLabel: "token 放在哪",
    modeInline: "token 写进提示词",
    modeFile: "token 存在文件里",
    autoPromptFile: (tokenPath: string, skillUrl: string) => `帮我在你现在运行的这个 Agent 客户端里接入 Work Learn 的 MCP 服务器，走本地 stdio 安装器。

我的 token 存在这个文件里：${tokenPath}

不要打开、不要 cat、不要以任何方式读取这个文件的内容。它是密码，读出来就等于泄漏——工具返回的内容一样会进这段对话。你只需要把这个路径原样传下去，也不要把 token 本身写进任何命令。

请按以下步骤做：
1. 找到本机的 work-learn clone，它必须已经执行过 \`pnpm install\`。找不到就先问我路径。
2. 在那个目录里执行：npx -y @work-learn/setup --yes --token-file ${tokenPath}
   如果你在别的目录执行，就加上 --repo <clone 的路径>。
3. 这个安装器会自己检测 Codex、Claude Code、Claude Desktop、CodeBuddy、Cursor 和 OpenCode，写入前先备份各自的配置文件，配置里记的是这个路径而不是 token，并且会顺带装上 Work Learn 的 skill。不要自己手改这些配置文件。
4. 如果它失败了，把它的输出给我看然后停下。不要退而把 token 写进配置文件。
5. 告诉我需要重启客户端，然后确认这 5 个工具可用：create_session、save_material、search_corpus、get_review_items、mark_mastered。

它装的 skill 就是 ${skillUrl} 这一份。`,
    tokenStep: "创建一个 personal access token，下面三种方式都需要它。",
    tokenHint: "它只会被这个产品的 API 认。建议一个 agent 发一个，这样要停某个 agent 时可以只吊销它那一个；并且设个有效期，忘掉的 token 会自己失效。",
    tokenGate: "先在上面创建 token，下面的命令才会填好。",
    copyGate: "先完成第一步，token 会自动填进来。",
    copyGateStale: "token 只在创建的那一刻可读，刷新后就填不回来了。可以在上面新建一个，或者复制后自己手动把 token 粘进去。",
    remoteStep: "不用装任何东西，把地址和请求头填进 agent 就行。",
    hint1: "拿你上面创建的那个 token 当 Bearer token。",
    hint1b: (): ReactNode => <>在支持远程 MCP（Streamable HTTP）的 agent 里，填上面那个地址，并把 <code>Authorization</code> 请求头设成 <code>Bearer &lt;personal-access-token&gt;</code>。只支持 stdio 的常驻本地 agent 请切到<strong>本地安装器</strong>那一栏。</>,
    installerStep: "跑一条命令，它问你要 token 时粘贴进去。",
    hint2: (): ReactNode => <>安装器是问你要 token，而不是从命令行参数拿，所以 token 不会进 shell 历史。它会检测 Codex、Claude Code、Claude Desktop、CodeBuddy、Cursor 和 OpenCode，为每个写入正确的 MCP 配置（并留备份），也可以顺带装上 Skill。它问仓库路径时，指向你本地的 <code>work-learn</code> clone。只支持 stdio MCP 的 agent 用这个。</>,
    manualSummary: "想自己粘配置？",
    hint2b: (docsUrl: string): ReactNode => <>安装器只是把你给它的 token 写进配置，在过期之前不需要做任何续期。各家配置文件的位置和手动写法见 <a className="inline-link" href={docsUrl} target="_blank" rel="noopener noreferrer">配置文档<span className="external-icon" aria-hidden="true">↗</span></a>。</>,
    tokenFileIntro: "把 token 粘给安装器就等于把它说给 agent 听，而对话是会被记录的——发给模型提供方，也落在本地 transcript 里。改成先把 token 写进一个文件，只把路径交给它。这条路走的是本地安装器，所以需要一份 work-learn clone；远程 MCP 没有「从文件读 header」这种能力。",
    tokenFilePathLabel: "token 文件路径",
    tokenFileStep1: "这条你自己在终端里跑。它是问你要 token，所以 token 也不会进 shell 历史。",
    tokenFileStep2: "这条可以放心交给 agent。路径不是秘密。",
    tokenFileNote: "MCP 服务器每次启动时才去读这个文件，配置里存的只是路径，整条链上没有环节接触到 token 本身。一个例外：让 agent 去打开或 cat 这个文件同样是泄漏，因为工具返回的内容一样进对话——上面那段提示词里已经明确要求它别这么做。",
    skillStep: "安装 Skill（推荐）。它负责告诉 agent 什么时候该存 —— 不装的话 MCP 工具在那儿，但没人会去调。",
    tabsLabel: "按 agent 选择安装命令",
    skillUniversalLabel: "所有 agent",
    restart: (): ReactNode => <>重启 agent，然后说：<code>“整理刚才这段对话”</code></>,
    notes: {
      universal: "不确定选哪个就用这条：它会找出这台机器上所有的 skills 目录，一次全装。其它几栏只装对应的那一个 agent。",
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
    remove: "删除",
    removeTitle: "从列表里删掉 —— 它已经吊销，不会再生效",
    copyNow: "现在就复制这个 token，它不会再显示第二次。",
    save: "保存到文件",
    saved: "已保存",
    saveHint:
      "保存会下载一个 work-learn-token.txt。下载目录不适合放它——文件在那里是所有人可读的，而且这次下载会留在浏览器历史里。跑下面这条把它挪到位，顺带就变成 0600：",
    moveCommand: (path: string) =>
      `install -m 600 ~/Downloads/work-learn-token.txt ${path} && rm ~/Downloads/work-learn-token.txt`,
    lastUsedHint: "agent 接通之后，上面的「最近使用」会从「从未」变成一个时间。这就是配置生效的凭据。",
    namePlaceholder: "token 名称，例如 Claude Desktop",
    expiryLabel: "有效期",
    expiryDays: (days: number) => `${days} 天后过期`,
    expiryNever: "永久有效",
    expiryNeverHint: "这个 token 在你吊销前一直有效。没有特别理由的话，建议设个有效期。",
    expiryHint: "设了有效期，万一泄漏也有个截止时间。过期了随时能再建一个。",
    scopeLabel: "权限",
    scopeReadWrite: "可读可写",
    scopeReadOnly: "只读",
    scopeFull: "完全访问",
    scopeHint:
      "只读 token 允许 agent 搜索你的语料、读取复习项，但不能保存新内容。只需要搜索的 agent 选只读；会保存材料的 agent 才选可读可写。",
    creating: "创建中…",
    create: "创建 token",
    errLoad: "token 列表加载失败",
    errCreate: "token 创建失败",
    errRevoke: "token 吊销失败",
    errDelete: "token 删除失败",
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

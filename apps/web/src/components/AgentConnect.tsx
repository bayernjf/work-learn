import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/context";
import type { SyncStatus } from "../lib/api";
import { DOCS_URL, LANDING_URL, SKILL_DIR_TABS, TOKEN_PLACEHOLDER } from "../lib/constants";
import { TokenManager } from "./TokenManager";
import { SyncStatusPanel } from "./ui";

export function AgentConnect({ session, initialOpen, syncStatus, syncStatusLoading, syncStatusError, onRefreshSyncStatus }: { session: Session; initialOpen: boolean; syncStatus: SyncStatus | null; syncStatusLoading: boolean; syncStatusError: string; onRefreshSyncStatus: (session: Session) => void }) {
  const { t } = useI18n();
  // Served by this app (see vite.config.ts) rather than raw.githubusercontent.com,
  // which is unreachable on the networks these commands get pasted into.
  const RAW_BASE = window.location.origin;
  const API_URL = "https://work-learn-api.vercel.app";
  const [remoteToken, setRemoteToken] = useState<string | null>(null);
  const [activeTokens, setActiveTokens] = useState(0);
  // No fallback to session.access_token. That JWT also authenticates straight
  // against Supabase, cannot be revoked from the token list, and would end up
  // written into an agent's config file on disk.
  const token = remoteToken ?? TOKEN_PLACEHOLDER;
  const hasToken = remoteToken !== null;
  // A token's plaintext exists only in the response that created it, so after a
  // reload the snippets cannot be filled from tokens that already exist. Say so,
  // rather than pointing at a step the user has demonstrably already done.
  const copyGate = activeTokens > 0 ? t.connect.copyGateStale : t.connect.copyGate;
  const [promptMode, setPromptMode] = useState<"inline" | "file">("inline");
  // Editable because a token kept somewhere else should not mean hand-editing
  // every command on this page.
  const [tokenFilePath, setTokenFilePath] = useState("~/.work-learn-token");

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        "work-learn": {
          command: "pnpm",
          args: ["--filter", "@work-learn/mcp-server", "exec", "tsx", "src/server.ts"],
          cwd: "/path/to/work-learn",
          env: { WORK_LEARN_API_URL: API_URL, WORK_LEARN_ACCESS_TOKEN: token },
        },
      },
    },
    null,
    2
  );

  // No --token here on purpose: a token on the command line lands in the shell
  // history file and is briefly visible in `ps`. The installer prompts for it.
  const setupCommand = "npx -y @work-learn/setup";
  // Same reasoning as above, which is why the token is read from a prompt rather
  // than written into the command: `umask 077` makes the file 0600 at creation, so
  // there is no window where it is world-readable. The prompt is printed separately
  // because `read -p` means "read from a coprocess" in zsh, which is the default
  // shell on macOS -- the bash spelling fails there rather than prompting.
  const writeTokenFileCommand = `umask 077 && printf 'Paste your token: ' && read -rs t && printf '%s' "$t" > ${tokenFilePath} && unset t && echo`;
  const remoteMcpUrl = `${API_URL}/api/mcp`;
  const authHeader = `Authorization: Bearer ${token}`;
  const skillUrl = `${RAW_BASE}/skills/work-learn/SKILL.md`;
  const agentPrompt =
    promptMode === "file"
      ? t.connect.autoPromptFile(tokenFilePath, skillUrl)
      : t.connect.autoPrompt(remoteMcpUrl, token, skillUrl);
  // Only the inline prompt carries a token, so only it has to wait for one.
  const promptReady = promptMode === "file" || hasToken;

  const universalInstall = { id: "universal", label: t.connect.skillUniversalLabel, command: `curl -fsSL ${RAW_BASE}/scripts/install-skill.sh | WORK_LEARN_SKILL_BASE=${RAW_BASE} bash`, note: t.connect.notes.universal };
  const skillInstalls: typeof universalInstall[] = [
    universalInstall,
    ...__AGENT_SKILL_DIRS__.flatMap((dir) => {
      const meta = SKILL_DIR_TABS[dir as keyof typeof SKILL_DIR_TABS];
      if (!meta) return [];
      const dest = `${dir}/work-learn`;
      return [{ id: meta.noteKey, label: meta.label, command: `mkdir -p ${dest} && curl -fsSL ${skillUrl} -o ${dest}/SKILL.md`, note: t.connect.notes[meta.noteKey] }];
    }),
  ];

  const [activeAgent, setActiveAgent] = useState<string>("universal");
  // The three routes are mutually exclusive, so they get a tablist rather than a
  // stack of numbered steps -- numbering alternatives reads as "do all of these".
  const [route, setRoute] = useState<"auto" | "remote" | "installer">("auto");
  const routes = [
    ["auto", t.connect.routeAuto, true],
    ["remote", t.connect.routeRemote, false],
    ["installer", t.connect.routeInstaller, false],
  ] as const;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [open, setOpen] = useState(initialOpen);
  const active = skillInstalls.find((item) => item.id === activeAgent) ?? universalInstall;

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <details className="agent-connect" id="connect" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t.connect.summary}</summary>
      <div className="agent-connect-body">
        <p>{t.connect.intro(LANDING_URL)}</p>

        <p className="connect-overview-lead">{t.connect.overviewLead}</p>
        <ol className="connect-overview">
          {t.connect.overview.map(([title, body]) => (
            <li key={title}>
              <span>
                <b>{title}</b> {body}
              </span>
            </li>
          ))}
        </ol>

        <p className="connect-lane">{t.connect.laneToken}</p>
        <p className="connect-step">{t.connect.tokenStep}</p>
        <p className="connect-hint">{t.connect.tokenHint}</p>
        <TokenManager session={session} onTokenSelect={setRemoteToken} onActiveTokens={setActiveTokens} tokenFilePath={tokenFilePath} />
        <SyncStatusPanel status={syncStatus} loading={syncStatusLoading} error={syncStatusError} onRefresh={() => onRefreshSyncStatus(session)} />

        <p className="connect-lane">{t.connect.laneRoute}</p>
        <p className="connect-hint">{t.connect.routeNote}</p>
        <div className="route-tabs" role="tablist" aria-label={t.connect.routesLabel}>
          {routes.map(([id, label, recommended]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={route === id}
              className={[route === id ? "route-tab active" : "route-tab", recommended ? "recommended" : ""].join(" ").trim()}
              onClick={() => setRoute(id)}
            >
              {label}
              {recommended ? <span className="route-badge">{t.connect.routeRecommended}</span> : null}
            </button>
          ))}
        </div>

        {route === "auto" ? (
          <div className="auto-setup">
            <div className="auto-setup-head">
              <div className="auto-setup-modes" role="tablist" aria-label={t.connect.modesLabel}>
                {([["inline", t.connect.modeInline], ["file", t.connect.modeFile]] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={promptMode === mode}
                    className={promptMode === mode ? "agent-tab active" : "agent-tab"}
                    onClick={() => setPromptMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="chip-gate" data-tip={promptReady ? undefined : copyGate}>
                <button type="button" className="copy-chip" disabled={!promptReady} onClick={() => copy("auto-prompt", agentPrompt)}>
                  {copiedId === "auto-prompt" ? t.common.copied : t.common.copy}
                </button>
              </span>
            </div>
            {promptMode === "file" ? (
              <>
                <p className="auto-setup-copy">{t.connect.tokenFileIntro}</p>
                <label className="token-path">
                  <span>{t.connect.tokenFilePathLabel}</span>
                  <input
                    type="text"
                    value={tokenFilePath}
                    onChange={(event) => setTokenFilePath(event.target.value)}
                    spellCheck={false}
                    maxLength={200}
                  />
                </label>
                <p className="token-file-step">{t.connect.tokenFileStep1}</p>
                <div className="code-block compact">
                  <code className="code-line">{writeTokenFileCommand}</code>
                  <button type="button" className="copy-chip" onClick={() => copy("token-file-write", writeTokenFileCommand)}>
                    {copiedId === "token-file-write" ? t.common.copied : t.common.copy}
                  </button>
                </div>
                <p className="token-file-step">{t.connect.tokenFileStep2}</p>
                <pre className="code-pre auto-setup-prompt">{agentPrompt}</pre>
                <p className="auto-setup-note">{t.connect.tokenFileNote}</p>
              </>
            ) : (
              <>
                <p className="auto-setup-copy">{t.connect.autoCopy}</p>
                <pre className="code-pre auto-setup-prompt">{agentPrompt}</pre>
                <p className="auto-setup-note">{hasToken ? t.connect.autoNote : t.connect.tokenGate}</p>
              </>
            )}
          </div>
        ) : route === "remote" ? (
          <>
            <p className="connect-step">{t.connect.remoteStep}</p>
            <p className="connect-hint">{t.connect.hint1}</p>
            <div className="code-block compact">
              <code className="code-line">{remoteMcpUrl}</code>
              <button type="button" className="copy-chip" onClick={() => copy("remote-url", remoteMcpUrl)}>
                {copiedId === "remote-url" ? t.common.copied : t.common.copyUrl}
              </button>
            </div>
            <div className="code-block compact">
              <code className="code-line">{authHeader}</code>
              <span className="chip-gate" data-tip={hasToken ? undefined : copyGate}>
                <button type="button" className="copy-chip" disabled={!hasToken} onClick={() => copy("remote-auth", authHeader)}>
                  {copiedId === "remote-auth" ? t.common.copied : t.common.copy}
                </button>
              </span>
            </div>
            <p className="connect-hint">{t.connect.hint1b()}</p>
          </>
        ) : (
          <>
            <p className="connect-step">{t.connect.installerStep}</p>
            <div className="code-block compact">
              <code className="code-line">{setupCommand}</code>
              <button type="button" className="copy-chip" onClick={() => copy("setup", setupCommand)}>
                {copiedId === "setup" ? t.common.copied : t.common.copy}
              </button>
            </div>
            <p className="connect-hint">{t.connect.hint2()}</p>
            <details className="manual-config">
              <summary>{t.connect.manualSummary}</summary>
              <div className="code-block">
                <pre className="code-pre">{mcpConfig}</pre>
                <span className="chip-gate" data-tip={hasToken ? undefined : copyGate}>
                  <button type="button" className="copy-chip" disabled={!hasToken} onClick={() => copy("mcp", mcpConfig)}>
                    {copiedId === "mcp" ? t.common.copied : t.common.copy}
                  </button>
                </span>
              </div>
            </details>
            <p className="connect-hint">{t.connect.hint2b(DOCS_URL)}</p>
          </>
        )}

        <p className="connect-lane">{t.connect.laneFinish}</p>
        <p className="connect-step">{t.connect.skillStep}</p>
        <div className="install-card">
          <div className="agent-tabs" role="tablist" aria-label={t.connect.tabsLabel}>
            {skillInstalls.map((agent) => (
              <button
                key={agent.id}
                type="button"
                role="tab"
                aria-selected={agent.id === activeAgent}
                className={agent.id === activeAgent ? "agent-tab active" : "agent-tab"}
                onClick={() => setActiveAgent(agent.id)}
              >
                {agent.label}
              </button>
            ))}
          </div>
          <div className="code-block compact">
            <code className="code-line">{active.command}</code>
            <button type="button" className="copy-chip" onClick={() => copy(`skill-${active.id}`, active.command)}>
              {copiedId === `skill-${active.id}` ? t.common.copied : t.common.copy}
            </button>
          </div>
          <p className="agent-note">{active.note}</p>
        </div>

        <p className="connect-hint">{t.connect.restart()}</p>
      </div>
    </details>
  );
}

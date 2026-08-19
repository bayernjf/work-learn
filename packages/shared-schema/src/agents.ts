// Single source of truth for the curated list of supported conversation sources.
// The runtime accepts any source label (see sourceSchema in index.ts), so adding
// a new agent here is optional and only surfaces it in UIs / CLI suggestions —
// it never requires a schema change, DB migration, or redeploy.
export const knownAgents = [
  "claude",
  "chatgpt",
  "codebuddy",
  "hermes",
  "openclaw",
  "opencode",
  "codex",
  "pi",
  "terminal",
  "manual"
] as const;

export type KnownAgent = (typeof knownAgents)[number];

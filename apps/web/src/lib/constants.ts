export const LANDING_URL = "https://work-learn.bayjf.com";
export const REPO_URL = "https://github.com/bayernjf/work-learn";
export const USAGE_URL = "https://github.com/bayernjf/work-learn/blob/main/docs/usage.md";
export const DOCS_URL = "https://github.com/bayernjf/work-learn/blob/main/docs/mcp-agent-setup.md";

// Stands in for the token until one exists, so the samples read as templates
// rather than as something ready to paste.
export const TOKEN_PLACEHOLDER = "<your-personal-access-token>";

// Tab label and note for the skills directories worth naming. Anything in
// __AGENT_SKILL_DIRS__ without an entry here is still covered by the universal
// command; it just gets no tab of its own.
export const SKILL_DIR_TABS = {
  "~/.codex/skills": { noteKey: "codex", label: "Codex" },
  "~/.claude/skills": { noteKey: "claude", label: "Claude Code" },
  "~/.codebuddy/skills": { noteKey: "codebuddy", label: "CodeBuddy" },
  "~/.cursor/skills": { noteKey: "cursor", label: "Cursor" },
  "~/.config/opencode/skills": { noteKey: "opencode", label: "OpenCode" },
  "~/.pi/agent/skills": { noteKey: "pi", label: "Pi" },
} as const;

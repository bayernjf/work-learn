#!/usr/bin/env bash
# Install the Work Learn skill into every detected AI agent's skills directory.
# Usage:
#   Local:  bash scripts/install-skill.sh
#   Remote: curl -fsSL https://raw.githubusercontent.com/bayernjf/work-learn/main/scripts/install-skill.sh | bash
set -euo pipefail

SKILL_NAME="work-learn"
TMP_DIR=""

cleanup() { [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# Resolve the source skill directory (local repo or fresh download).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SRC="$SCRIPT_DIR/../skills/$SKILL_NAME"
if [ -f "$LOCAL_SRC/SKILL.md" ]; then
  SRC_DIR="$LOCAL_SRC"
else
  echo "Downloading $SKILL_NAME skill from GitHub..."
  TMP_DIR="$(mktemp -d)"
  SRC_DIR="$TMP_DIR/$SKILL_NAME"
  curl -fsSL "https://raw.githubusercontent.com/bayernjf/work-learn/main/skills/$SKILL_NAME/SKILL.md" -o "$SRC_DIR/SKILL.md" --create-dirs
fi

# Known per-agent skills directories. Add new agents here.
AGENT_DIRS=(
  "$HOME/.codex/skills"
  "$HOME/.claude/skills"
  "$HOME/.codebuddy/skills"
  "$HOME/.cursor/skills"
  "$HOME/.opencode/skills"
  "$HOME/.config/opencode/skills"
  "$HOME/.agents/skills"
  "$HOME/.pi/agent/skills"
)

INSTALLED=()
for dir in "${AGENT_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  dest="$dir/$SKILL_NAME"
  mkdir -p "$dest"
  cp "$SRC_DIR/SKILL.md" "$dest/SKILL.md"
  INSTALLED+=("$dest")
done

if [ ${#INSTALLED[@]} -eq 0 ]; then
  echo "No supported agent skills directory found."
  echo "Create one (e.g. ~/.codex/skills) and re-run, or copy skills/$SKILL_NAME manually."
  exit 1
fi

echo "Work Learn skill installed to:"
for d in "${INSTALLED[@]}"; do echo "  - $d"; done
echo
echo "Next: make sure the Work Learn MCP server is connected, then restart your agent."
echo "Setup guide: https://github.com/bayernjf/work-learn/blob/main/docs/mcp-agent-setup.md"

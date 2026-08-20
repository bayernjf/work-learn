import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type McpEntry = {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};

export type AgentTarget = {
  id: string;
  label: string;
  /** Absolute path to the config file this writer manages. */
  configPath: string;
  kind: "json-mcpServers" | "codex-toml" | "opencode-json";
  /** Directory the skill installer should target, if known. */
  skillsDir?: string;
};

const home = homedir();

export const ALL_AGENTS: AgentTarget[] = [
  {
    id: "codex",
    label: "Codex",
    configPath: join(home, ".codex", "config.toml"),
    kind: "codex-toml",
    skillsDir: join(home, ".codex", "skills"),
  },
  {
    id: "claude",
    label: "Claude Desktop",
    configPath: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    kind: "json-mcpServers",
    skillsDir: join(home, ".claude", "skills"),
  },
  {
    id: "codebuddy",
    label: "CodeBuddy",
    configPath: join(home, ".codebuddy", "mcp.json"),
    kind: "json-mcpServers",
    skillsDir: join(home, ".codebuddy", "skills"),
  },
  {
    id: "cursor",
    label: "Cursor",
    configPath: join(home, ".cursor", "mcp.json"),
    kind: "json-mcpServers",
    skillsDir: join(home, ".cursor", "skills"),
  },
  {
    id: "opencode",
    label: "OpenCode",
    configPath: join(home, ".config", "opencode", "opencode.json"),
    kind: "opencode-json",
    skillsDir: join(home, ".config", "opencode", "skills"),
  },
];

/** Agents whose config file or parent config directory already exists. */
export function detectAgents(): AgentTarget[] {
  return ALL_AGENTS.filter((agent) => {
    if (existsSync(agent.configPath)) return true;
    // Codex/Claude have well-known app dirs even before an MCP config exists.
    if (agent.id === "codex" && existsSync(dirname(agent.configPath))) return true;
    if (agent.id === "claude" && existsSync(dirname(agent.configPath))) return true;
    return false;
  });
}

function ensureDir(file: string) {
  mkdirSync(dirname(file), { recursive: true });
}

function backup(file: string) {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`${file}.bak-${stamp}`, readFileSync(file));
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(file: string, value: unknown) {
  ensureDir(file);
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** Write into a JSON file shaped { mcpServers: { ... } } (Claude, CodeBuddy, Cursor). */
function writeJsonMcpServers(file: string, entry: McpEntry) {
  const json = readJson(file);
  const servers = (json.mcpServers as Record<string, unknown>) ?? {};
  servers["work-learn"] = { type: "stdio", ...entry };
  json.mcpServers = servers;
  writeJson(file, json);
}

/** Write into an OpenCode config file under the `mcp` key. */
function writeOpenCode(file: string, entry: McpEntry) {
  const json = readJson(file);
  const mcp = (json.mcp as Record<string, unknown>) ?? {};
  // OpenCode local servers take the command as an argv array.
  mcp["work-learn"] = {
    type: "local",
    command: [entry.command, ...entry.args],
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
    enabled: true,
    environment: entry.env,
  };
  json.mcp = mcp;
  writeJson(file, json);
}

const TOML_HEADER = "[mcp_servers.work-learn]";

function toTomlString(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function toTomlArray(values: string[]): string {
  return "[" + values.map(toTomlString).join(", ") + "]";
}

/**
 * Write the [mcp_servers.work-learn] block into a Codex config.toml.
 * Codex does not support a `cwd` field, so it is omitted here.
 */
function writeCodexToml(file: string, entry: McpEntry) {
  const lines: string[] = [
    TOML_HEADER,
    `command = ${toTomlString(entry.command)}`,
    `args = ${toTomlArray(entry.args)}`,
  ];
  const envKeys = Object.keys(entry.env);
  if (envKeys.length > 0) {
    lines.push("env = { " + envKeys.map((k) => `${k} = ${toTomlString(entry.env[k]!)}`).join(", ") + " }");
  }
  const block = lines.join("\n");

  let original = existsSync(file) ? readFileSync(file, "utf8") : "";
  // Replace an existing work-learn block (from its header up to the next [ header or EOF).
  const blockRe = /(?<=^|\n)\[mcp_servers\.work-learn\][\s\S]*?(?=\n\[|\n*$)/;
  if (blockRe.test(original)) {
    original = original.replace(blockRe, block);
  } else {
    if (original.length > 0 && !original.endsWith("\n")) original += "\n";
    original = original + "\n" + block + "\n";
  }
  ensureDir(file);
  writeFileSync(file, original);
}

export function writeAgentConfig(agent: AgentTarget, entry: McpEntry) {
  backup(agent.configPath);
  switch (agent.kind) {
    case "json-mcpServers":
      writeJsonMcpServers(agent.configPath, entry);
      break;
    case "opencode-json":
      writeOpenCode(agent.configPath, entry);
      break;
    case "codex-toml":
      writeCodexToml(agent.configPath, entry);
      break;
  }
}

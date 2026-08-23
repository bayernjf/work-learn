#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  ALL_AGENTS,
  detectAgents,
  writeAgentConfig,
  type AgentTarget,
  type McpEntry,
} from "./agents.js";

const DEFAULT_API_URL = "https://work-learn-api.vercel.app";

type CliFlags = {
  token?: string;
  apiUrl?: string;
  repo?: string;
  agents?: string[];
  yes?: boolean;
  help?: boolean;
};

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => argv[++i];
    switch (arg) {
      case "--token": flags.token = next(); break;
      case "--api-url": flags.apiUrl = next(); break;
      case "--repo": flags.repo = next(); break;
      // Removed rather than ignored: the default branch below swallows unknown flags,
      // so silently dropping these would look like they still worked.
      case "--refresh-token":
      case "--supabase-url":
      case "--supabase-anon-key":
        throw new Error(
          `${arg} is gone. It wrote an account-wide Supabase credential into your agent's config file. Use a personal access token with --token instead; it stays valid until you revoke it.`
        );
      case "--agent": {
        const id = next();
        if (id) flags.agents = [...(flags.agents ?? []), id];
        break;
      }
      case "-y":
      case "--yes": flags.yes = true; break;
      case "-h":
      case "--help": flags.help = true; break;
      default:
        if (arg.startsWith("--agent=")) {
          flags.agents = [...(flags.agents ?? []), arg.slice("--agent=".length)];
        }
    }
  }
  return flags;
}

const HELP = `work-learn-setup

Wire the Work Learn MCP server into your local AI agents.

Usage:
  npx @work-learn/setup [options]

Options:
  --token <token>            Work Learn personal access token (WORK_LEARN_ACCESS_TOKEN)
  --api-url <url>            Work Learn API URL (default: ${DEFAULT_API_URL})
  --repo <path>              Path to a local clone of work-learn
  --agent <id>               Only configure this agent (repeatable): codex, claude-code, claude-desktop, codebuddy, cursor, opencode
  -y, --yes                  Non-interactive; use provided flags and defaults
  -h, --help                 Show this help
`;

type Answers = {
  token: string;
  apiUrl: string;
  repoPath: string;
  selected: AgentTarget[];
  installSkill: boolean;
};

function detectRepoPath(): string | undefined {
  const candidates = [
    process.env.WORK_LEARN_REPO,
    process.cwd(),
    join(homedir(), "000mycodes", "work-learn"),
    join(homedir(), "work-learn"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, "packages", "mcp-server", "src", "server.ts"))
    ) {
      return candidate;
    }
  }
  return undefined;
}

function resolveTsx(repoPath: string): string | undefined {
  const candidates = [
    join(repoPath, "packages", "mcp-server", "node_modules", ".bin", "tsx"),
    join(repoPath, "node_modules", ".bin", "tsx"),
  ];
  return candidates.find((file) => existsSync(file));
}

async function prompt(rl: ReturnType<typeof createInterface>, question: string, fallback?: string): Promise<string> {
  const answer = (await rl.question(question)).trim();
  if (answer) return answer;
  if (fallback !== undefined) return fallback;
  return "";
}

function bool(value: string, fallback = false): boolean {
  if (!value) return fallback;
  return /^(y|yes)$/i.test(value);
}

async function gather(flags: CliFlags): Promise<Answers> {
  const detected = detectAgents();
  const knownIds = new Set(ALL_AGENTS.map((agent) => agent.id));

  let selected: AgentTarget[];
  if (flags.agents?.length) {
    const unknown = flags.agents.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      // Silently dropping these would configure nothing and still exit 0.
      throw new Error(
        `Unknown --agent: ${unknown.join(", ")}. Known ids: ${[...knownIds].join(", ")}`,
      );
    }
    selected = flags.agents.map((id) => ALL_AGENTS.find((agent) => agent.id === id)!);
  } else {
    selected = detected;
  }

  if (flags.yes) {
    const repoPath = flags.repo
      ? resolve(flags.repo)
      : detectRepoPath() ?? "";
    if (!flags.token) throw new Error("--token is required in --yes mode");
    if (!repoPath) throw new Error("--repo <path> is required when no local clone is detected");
    return {
      token: flags.token,
      apiUrl: flags.apiUrl ?? DEFAULT_API_URL,
      repoPath,
      selected: selected.length ? selected : ALL_AGENTS,
      installSkill: true,
    };
  }

  const rl = createInterface({ input, output });
  try {
    console.log("\n  Work Learn setup\n");
    if (detected.length === 0) {
      console.log("  No supported agent config detected. You can still create one by selecting targets below.\n");
    } else {
      console.log(`  Detected: ${detected.map((agent) => agent.label).join(", ")}\n`);
    }

    const token = flags.token ?? (await prompt(rl, "  Work Learn personal access token: "));
    if (!token) throw new Error("An access token is required. Create one in the Work Learn web app.");

    const apiUrl = flags.apiUrl ?? (await prompt(rl, `  API URL [${DEFAULT_API_URL}]: `, DEFAULT_API_URL));

    let repoPath = flags.repo ?? detectRepoPath() ?? "";
    if (!repoPath) {
      repoPath = await prompt(rl, "  Path to your local work-learn clone: ");
    } else {
      const confirmed = await prompt(rl, `  Local work-learn repo [${repoPath}] (press enter to accept): `, repoPath);
      repoPath = confirmed;
    }
    repoPath = isAbsolute(repoPath) ? repoPath : resolve(repoPath);
    if (!existsSync(join(repoPath, "packages", "mcp-server", "src", "server.ts"))) {
      throw new Error(`Could not find packages/mcp-server in ${repoPath}.`);
    }

    let chosen = selected;
    if (!flags.agents?.length) {
      const list = ALL_AGENTS.map((agent, i) => `    [${i + 1}] ${agent.label}`).join("\n");
      const defaults = detected.length
        ? detected.map((agent) => ALL_AGENTS.indexOf(agent) + 1).join(",")
        : String(ALL_AGENTS.length);
      const answer = await prompt(rl, `  Which agents?\n${list}\n  Choose [${defaults}]: `, defaults);
      const indexes = answer
        .split(/[,\s]+/)
        .map((value) => Number.parseInt(value, 10))
        .filter((n) => n >= 1 && n <= ALL_AGENTS.length);
      chosen = indexes.map((n) => ALL_AGENTS[n - 1]!);
    }

    const installSkill = bool(await prompt(rl, "  Also install the Work Learn Skill? [Y/n]: "), true);

    return { token, apiUrl, repoPath, selected: chosen, installSkill };
  } finally {
    rl.close();
  }
}

function buildEntry(answers: Answers): McpEntry {
  const tsx = resolveTsx(answers.repoPath);
  if (!tsx) {
    throw new Error(
      `Could not find tsx in ${answers.repoPath}. Run \`pnpm install\` in the work-learn repo first.`
    );
  }
  const serverTs = join(answers.repoPath, "packages", "mcp-server", "src", "server.ts");
  const env: Record<string, string> = {
    WORK_LEARN_API_URL: answers.apiUrl,
    WORK_LEARN_ACCESS_TOKEN: answers.token,
  };

  return { command: tsx, args: [serverTs], env };
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  Setup failed: ${message}\n`);
  process.exit(1);
}

function main() {
  let flags: CliFlags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error);
  }
  if (flags.help) {
    console.log(HELP);
    return;
  }

  gather(flags)
    .then((answers) => {
      const entry = buildEntry(answers);
      console.log("\n  Writing MCP config...\n");
      for (const agent of answers.selected) {
        writeAgentConfig(agent, entry);
        console.log(`  ✓ ${agent.label} -> ${agent.configPath}`);
      }

      if (answers.installSkill) {
        const script = join(answers.repoPath, "scripts", "install-skill.sh");
        console.log("\n  Installing the Work Learn Skill...");
        const result = spawnSync("bash", [script], { stdio: "inherit", cwd: homedir() });
        if (result.status !== 0) {
          console.log("  Skill install could not complete. You can run it manually:");
          console.log(`    bash ${script}`);
        }
      }

      console.log("\n  Done. Restart your agent(s), then ask:");
      console.log('    "Save the useful English from this conversation."\n');
    })
    .catch(fail);
}

main();

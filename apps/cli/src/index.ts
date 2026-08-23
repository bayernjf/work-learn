import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactSecrets } from "@work-learn/learning-core";
import { LocalStore } from "@work-learn/local-store";

const execFileAsync = promisify(execFile);
const [command, ...args] = process.argv.slice(2);

const commands = {
  capture: "Capture and save text (stdin or clipboard) to the local store.",
  review: "Show the next review items from the local store.",
  search: "Search the local corpus.",
  sync: "Push local-only data to your Work Learn cloud account.",
  export: "Export local data to markdown notes."
} as const;

if (command === "capture") {
  await capture(args);
} else if (command === "review") {
  await review();
} else if (command === "search") {
  await search(args);
} else if (command === "sync") {
  console.log("learn sync: ready for implementation (Phase 3)");
} else if (command === "export") {
  console.log("learn export: ready for implementation (Phase 4)");
} else if (!command || !(command in commands)) {
  console.log("Work Learn CLI\n");
  for (const [name, description] of Object.entries(commands)) console.log(`  learn ${name.padEnd(8)} ${description}`);
  process.exit(command ? 1 : 0);
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function openStore(): LocalStore {
  return new LocalStore();
}

async function capture(args: string[]) {
  const source = option(args, "--source") ?? "manual";
  const topic = option(args, "--topic") ?? "Untitled conversation";
  const useStdin = args.includes("--stdin");
  const content = useStdin ? await readStdin() : await readClipboard();

  if (!content.trim()) throw new Error("No text captured");
  const redacted = redactSecrets(content);

  const store = openStore();
  try {
    const session = store.createSession({ source, topic });
    store.saveMaterial({
      sessionId: session.id,
      source,
      topic,
      originalText: redacted.text,
      usefulExpressions: [],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: []
    });
    console.log(JSON.stringify({ saved: true, sessionId: session.id, redactions: redacted.replacements }, null, 2));
  } finally {
    store.close();
  }
}

async function review() {
  const store = openStore();
  try {
    console.log(JSON.stringify(store.getReviewItems(), null, 2));
  } finally {
    store.close();
  }
}

async function search(args: string[]) {
  const query = option(args, "--q") ?? option(args, "--query") ?? args.find((a) => !a.startsWith("-")) ?? "";
  const store = openStore();
  try {
    console.log(JSON.stringify(store.searchCorpus(query), null, 2));
  } finally {
    store.close();
  }
}

async function readClipboard() {
  if (process.platform === "darwin") return (await execFileAsync("pbpaste")).stdout;
  if (process.platform === "linux") return (await execFileAsync("xclip", ["-selection", "clipboard", "-o"])).stdout;
  throw new Error("Clipboard capture currently supports macOS (pbpaste) and Linux (xclip). Use --stdin on other systems.");
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

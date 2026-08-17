import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactSecrets } from "@work-learn/learning-core";

const execFileAsync = promisify(execFile);
const [command, ...args] = process.argv.slice(2);

const commands = {
  capture: "Capture and redact selected text or a clipboard entry.",
  review: "Show the next review items from Work Learn.",
  search: "Search the saved corpus.",
  run: "Run an agent command with a future PTY recorder."
} as const;

if (command === "capture") {
  await capture(args);
} else if (!command || !(command in commands)) {
  console.log("Work Learn CLI\n");
  for (const [name, description] of Object.entries(commands)) console.log(`  learn ${name.padEnd(8)} ${description}`);
  process.exit(command ? 1 : 0);
} else {
  console.log(`learn ${command}`, args.length ? args : "ready for implementation");
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function capture(args: string[]) {
  const source = option(args, "--source") ?? "manual";
  const topic = option(args, "--topic") ?? "Untitled conversation";
  const useStdin = args.includes("--stdin");
  const content = useStdin ? await readStdin() : await readClipboard();

  if (!content.trim()) throw new Error("No text captured");
  const redacted = redactSecrets(content);

  console.log(JSON.stringify({
    source,
    topic,
    content: redacted.text,
    redactions: redacted.replacements,
    capturedAt: new Date().toISOString()
  }, null, 2));
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

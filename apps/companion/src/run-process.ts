import { spawn } from "node:child_process";

/**
 * Shared child-process runner for the companion (2026-11-02 review P2-4).
 *
 * The agent-nudge loop fires every 3s and every tray/IPC action spawns the
 * `learn` CLI through tsx; a cold tsx start is hundreds of milliseconds and a
 * hung child previously lived forever, so slow ticks stacked processes and
 * burned CPU/battery. Every spawn now has a hard timeout: the child is killed
 * with SIGKILL and the promise resolves (never rejects) with `timedOut`, so a
 * stuck CLI or osascript can no longer accumulate.
 */

export interface ProcessResult {
  ok: boolean;
  output: string;
  timedOut?: boolean;
}

export interface RunProcessOptions {
  env?: NodeJS.ProcessEnv;
  /** Hard cap; the child is SIGKILLed when it expires. */
  timeoutMs?: number;
}

/** tsx cold starts are slow; 30s leaves generous headroom for `learn sync`. */
export const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;

export function runProcess(
  command: string,
  args: string[],
  options?: RunProcessOptions
): Promise<ProcessResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(command, args, { env: options?.env ?? process.env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ ok: false, output: `process timed out after ${timeoutMs}ms`, timedOut: true });
    }, timeoutMs);
    child.on("error", (e: Error) => settle({ ok: false, output: e.message }));
    child.on("close", (code) => settle({ ok: code === 0, output: (out + err).trim() }));
  });
}

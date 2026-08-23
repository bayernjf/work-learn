import { readFileSync } from "node:fs";

/**
 * Resolve the personal access token from the environment.
 *
 * WORK_LEARN_ACCESS_TOKEN_FILE exists so the token never has to be spoken aloud.
 * Asking an agent to write the config for you means pasting the token into a
 * conversation, and a conversation is recorded: it goes to the model provider and
 * into the local transcript. A path is not a secret, so handing over a path keeps
 * the token out of both. Reading the file's *contents* to an agent would leak
 * exactly like pasting -- only the indirection helps.
 *
 * The file wins over the inline variable when both are set, because the file is
 * the deliberate choice and silently preferring the weaker one would be a trap.
 */
export const readAccessToken = (env: NodeJS.ProcessEnv): string => {
  const path = env.WORK_LEARN_ACCESS_TOKEN_FILE?.trim();
  if (path) {
    let contents: string;
    try {
      contents = readFileSync(path, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`WORK_LEARN_ACCESS_TOKEN_FILE points at ${path}, which could not be read: ${reason}`);
    }
    // Trimmed because the usual way to make this file is `echo`, which appends a
    // newline, and a trailing newline in a Bearer header is rejected by the API.
    const token = contents.trim();
    if (!token) throw new Error(`WORK_LEARN_ACCESS_TOKEN_FILE points at ${path}, which is empty`);
    return token;
  }

  const inline = env.WORK_LEARN_ACCESS_TOKEN?.trim();
  if (inline) return inline;

  throw new Error("Set WORK_LEARN_ACCESS_TOKEN_FILE to a file holding your token, or WORK_LEARN_ACCESS_TOKEN to the token itself");
};

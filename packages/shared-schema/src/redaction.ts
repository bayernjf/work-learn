const secretPatterns: Array<[RegExp, string]> = [
  [/(-----BEGIN [A-Z ]+ PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+ PRIVATE KEY-----)/g, "$1 [REDACTED PRIVATE KEY] $2"],
  [/\b(sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED API KEY]"],
  [/\b(wlpat_[A-Za-z0-9_-]{20,})\b/g, "[REDACTED WORK LEARN TOKEN]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED JWT]"],
  [/\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED GITHUB TOKEN]"],
  [/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED AWS KEY]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[REDACTED TOKEN]"],
  [/\/(?:Users|home)\/[^\s"'`]+/g, "[REDACTED PATH]"],
  [/[A-Z]:\\[^\s"'`]+/g, "[REDACTED PATH]"],
  // No \b before the keyword: it would fail on WORK_LEARN_ACCESS_TOKEN, where the
  // preceding character is an underscore and so not a word boundary at all. The
  // optional quote after it is what JSON config puts between key and colon.
  [/((?:api[_-]?key|access[_-]?token|secret|password|service[_-]?role[_-]?key)["']?\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]"],
  [/(\b(?:SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*)([^\s]+)/gi, "$1[REDACTED]"]
];

export type RedactionResult = { text: string; replacements: number };

export const redactSecrets = (input: string): RedactionResult => {
  let text = input;
  let replacements = 0;

  for (const [pattern, replacement] of secretPatterns) {
    text = text.replace(pattern, (...args: unknown[]) => {
      replacements += 1;
      return replacement.replace(/\$(\d+)/g, (_placeholder, group) => String(args[Number(group)] ?? ""));
    });
  }

  return { text, replacements };
};

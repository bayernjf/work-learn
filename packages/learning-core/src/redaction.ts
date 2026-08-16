const secretPatterns: Array<[RegExp, string]> = [
  [/(-----BEGIN [A-Z ]+ PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+ PRIVATE KEY-----)/g, "$1 [REDACTED PRIVATE KEY] $2"],
  [/\b(sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED API KEY]"],
  [/\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED GITHUB TOKEN]"],
  [/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED AWS KEY]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[REDACTED TOKEN]"],
  [/(\b(?:api[_-]?key|access[_-]?token|secret|password|service[_-]?role[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]"],
  [/(\b(?:SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*)([^\s]+)/gi, "$1[REDACTED]"]
];

export type RedactionResult = { text: string; replacements: number };

export const redactSecrets = (input: string): RedactionResult => {
  let text = input;
  let replacements = 0;

  for (const [pattern, replacement] of secretPatterns) {
    text = text.replace(pattern, () => {
      replacements += 1;
      return replacement;
    });
  }

  return { text, replacements };
};

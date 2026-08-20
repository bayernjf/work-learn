import { createHash, randomBytes } from "node:crypto";

export const PAT_PREFIX = "wlpat_";

export type GeneratedPat = {
  /** The raw token, shown to the user exactly once. */
  token: string;
  /** Short non-secret prefix for display in the token list. */
  prefix: string;
  /** SHA-256 hash stored in the database. */
  hash: string;
};

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Generate a new personal access token. Format: wlpat_<40 base32-ish chars>. */
export const generatePat = (): GeneratedPat => {
  const secret = randomBytes(24).toString("base64url");
  const token = `${PAT_PREFIX}${secret}`;
  const prefix = token.slice(0, 10);
  return { token, prefix, hash: hashToken(token) };
};

export const isPat = (token: string): boolean => token.startsWith(PAT_PREFIX);

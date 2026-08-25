import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  createPersonalAccessToken,
  deletePersonalAccessToken,
  fetchPersonalAccessTokens,
  revokePersonalAccessToken,
  type CreatedPersonalAccessToken,
  type PersonalAccessToken
} from "../lib/api";
import { useI18n } from "../i18n/context";

type Props = {
  session: Session;
  onTokenSelect: (token: string | null) => void;
  onActiveTokens: (count: number) => void;
  tokenFilePath: string;
};

export function TokenManager({ session, onTokenSelect, onActiveTokens, tokenFilePath }: Props) {
  const { t, formatDate: formatIso } = useI18n();
  const formatDate = (value: string | null) => (value ? formatIso(value) : t.tokens.never);
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [name, setName] = useState("");
  // Days, or 0 for no expiry. Defaults to 90 so the common case is a token that
  // stops working on its own; a leaked one then has a deadline.
  const [expiresInDays, setExpiresInDays] = useState(90);
  // Default to full access so the common case is unchanged; "read only" is the
  // downgrade for a search-only agent.
  const [scopes, setScopes] = useState<string[]>(["read", "write"]);
  const [created, setCreated] = useState<CreatedPersonalAccessToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const scopeLabelFor = (scopes: string[]) =>
    !scopes || scopes.length === 0
      ? t.tokens.scopeFull
      : scopes.includes("write")
        ? t.tokens.scopeReadWrite
        : t.tokens.scopeReadOnly;

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1800);
    } catch {
      // The value is on screen either way, so a failed copy is not worth an error.
    }
  };

  /**
   * A download, because a token shown once is a token you can lose between
   * reading it and reaching a terminal.
   *
   * No trailing newline: it matches what the terminal recipe writes, and the MCP
   * server trims anyway.
   */
  const saveCreated = (token: string) => {
    const url = URL.createObjectURL(new Blob([token], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "work-learn-token.txt";
    link.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  const load = async () => {
    try {
      const result = await fetchPersonalAccessTokens(session);
      setTokens(result.data);
      onActiveTokens(result.data.filter((token) => !token.revoked_at).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.tokens.errLoad);
    }
  };

  useEffect(() => {
    void load();
  }, [session]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await createPersonalAccessToken(session, name.trim(), expiresInDays || undefined, scopes);
      setCreated(result.data);
      setCopiedId(null);
      setSaved(false);
      setName("");
      onTokenSelect(result.data.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.tokens.errCreate);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setError("");
    try {
      await revokePersonalAccessToken(session, id);
      if (created?.id === id) {
        setCreated(null);
        onTokenSelect(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.tokens.errRevoke);
    }
  };

  const handleDelete = async (id: string) => {
    setError("");
    try {
      await deletePersonalAccessToken(session, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.tokens.errDelete);
    }
  };

  return (
    <div className="token-manager">
      <div className="token-list">
        {tokens.length === 0 ? (
          <p className="token-empty">{t.tokens.empty}</p>
        ) : (
          tokens.map((token) => (
            <div key={token.id} className={token.revoked_at ? "token-row revoked" : "token-row"}>
              <div>
                <strong>{token.name}</strong>
                <code>{token.token_prefix}…</code>
                <span className="token-meta">
                  {scopeLabelFor(token.scopes)}
                  {token.revoked_at ? ` · ${t.tokens.revoked}` : ` · ${t.tokens.lastUsed(formatDate(token.last_used_at))}`}
                  {token.expires_at ? t.tokens.expires(formatDate(token.expires_at)) : ""}
                </span>
              </div>
              {token.revoked_at ? (
                <button
                  type="button"
                  className="token-revoke"
                  title={t.tokens.removeTitle}
                  onClick={() => handleDelete(token.id)}
                >
                  {t.tokens.remove}
                </button>
              ) : (
                <button type="button" className="token-revoke" onClick={() => handleRevoke(token.id)}>
                  {t.tokens.revoke}
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {tokens.some((token) => !token.revoked_at && !token.last_used_at) && (
        <p className="token-hint">{t.tokens.lastUsedHint}</p>
      )}

      {created && (
        <div className="token-created">
          <p>
            {t.tokens.copyNow}
          </p>
          <div className="token-row created-row">
            <code className="token-raw">{created.token}</code>
            <button type="button" className="copy-chip" onClick={() => void copy("token", created.token)}>
              {copiedId === "token" ? t.common.copied : t.common.copy}
            </button>
            <button type="button" className="copy-chip" onClick={() => saveCreated(created.token)}>
              {saved ? t.tokens.saved : t.tokens.save}
            </button>
          </div>
          {saved && (
            <>
              <p className="token-save-hint">{t.tokens.saveHint}</p>
              <div className="code-block compact">
                <code className="code-line">{t.tokens.moveCommand(tokenFilePath)}</code>
                <button
                  type="button"
                  className="copy-chip"
                  onClick={() => void copy("move", t.tokens.moveCommand(tokenFilePath))}
                >
                  {copiedId === "move" ? t.common.copied : t.common.copy}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <form className="token-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder={t.tokens.namePlaceholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
        />
        <select
          aria-label={t.tokens.expiryLabel}
          value={expiresInDays}
          onChange={(event) => setExpiresInDays(Number(event.target.value))}
        >
          {[30, 90, 365].map((days) => (
            <option key={days} value={days}>
              {t.tokens.expiryDays(days)}
            </option>
          ))}
          <option value={0}>{t.tokens.expiryNever}</option>
        </select>
        <select
          aria-label={t.tokens.scopeLabel}
          value={scopes.join(",")}
          onChange={(event) => setScopes(event.target.value.split(","))}
        >
          <option value="read,write">{t.tokens.scopeReadWrite}</option>
          <option value="read">{t.tokens.scopeReadOnly}</option>
        </select>
        <button type="submit" disabled={loading || !name.trim()}>
          {loading ? t.tokens.creating : t.tokens.create}
        </button>
      </form>
      <p className="token-hint">{expiresInDays ? t.tokens.expiryHint : t.tokens.expiryNeverHint}</p>
      <p className="token-hint">{t.tokens.scopeHint}</p>
      {error && <p className="token-error">{error}</p>}
    </div>
  );
}

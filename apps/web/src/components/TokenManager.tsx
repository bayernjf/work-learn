import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  createPersonalAccessToken,
  fetchPersonalAccessTokens,
  revokePersonalAccessToken,
  type CreatedPersonalAccessToken,
  type PersonalAccessToken
} from "../lib/api";

type Props = {
  session: Session;
  onTokenSelect: (token: string | null) => void;
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString() : "Never";

export function TokenManager({ session, onTokenSelect }: Props) {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedPersonalAccessToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const result = await fetchPersonalAccessTokens(session);
      setTokens(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tokens");
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
      const result = await createPersonalAccessToken(session, name.trim());
      setCreated(result.data);
      setName("");
      onTokenSelect(result.data.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create token");
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
      setError(err instanceof Error ? err.message : "Could not revoke token");
    }
  };

  return (
    <div className="token-manager">
      <div className="token-list">
        {tokens.length === 0 ? (
          <p className="token-empty">No personal access tokens yet. Create one to connect a remote MCP agent.</p>
        ) : (
          tokens.map((token) => (
            <div key={token.id} className={token.revoked_at ? "token-row revoked" : "token-row"}>
              <div>
                <strong>{token.name}</strong>
                <code>{token.token_prefix}…</code>
                <span className="token-meta">
                  {token.revoked_at ? "Revoked" : `Last used ${formatDate(token.last_used_at)}`}
                  {token.expires_at ? ` · Expires ${formatDate(token.expires_at)}` : ""}
                </span>
              </div>
              {!token.revoked_at && (
                <button type="button" className="token-revoke" onClick={() => handleRevoke(token.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {created && (
        <div className="token-created">
          <p>
            Copy this token now. It will not be shown again.
          </p>
          <div className="token-row created-row">
            <code className="token-raw">{created.token}</code>
          </div>
        </div>
      )}

      <form className="token-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="Token name, e.g. Claude Desktop"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
        />
        <button type="submit" disabled={loading || !name.trim()}>
          {loading ? "Creating…" : "Create token"}
        </button>
      </form>
      {error && <p className="token-error">{error}</p>}
    </div>
  );
}

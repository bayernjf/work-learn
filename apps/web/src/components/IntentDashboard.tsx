import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/context";
import { clusterIntents, fetchIntents, mergeIntents, splitIntent, type IntentListResult } from "../lib/api";

export function IntentDashboard({ session }: { session: Session }) {
  const { t } = useI18n();
  const [data, setData] = useState<IntentListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ mode: "create" | "split"; intentId?: string } | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIntents(session);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const openCreate = () => {
    setLabel("");
    setDescription("");
    setDialog({ mode: "create" });
  };

  const openSplit = (intentId: string) => {
    setLabel("");
    setDescription("");
    setDialog({ mode: "split", intentId });
  };

  const submitDialog = async () => {
    if (!dialog || !label.trim()) return;
    setBusy(true);
    try {
      if (dialog.mode === "create") {
        await clusterIntents(session, [{ label: label.trim(), description: description.trim() || null, expressionIds: [...selected] }]);
      } else if (dialog.intentId) {
        const group = data?.intents.find((g) => g.intent.id === dialog.intentId);
        if (!group) return;
        const picked = group.expressions.filter((e) => selected.has(e.id)).map((e) => e.id);
        const rest = group.expressions.filter((e) => !selected.has(e.id)).map((e) => e.id);
        if (picked.length === 0 || rest.length === 0) return;
        await splitIntent(session, dialog.intentId, [
          { label: label.trim(), description: description.trim() || null, expressionIds: picked },
          { label: group.intent.label, description: group.intent.description, expressionIds: rest }
        ]);
      }
      setSelected(new Set());
      setDialog(null);
      setLabel("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setBusy(true);
    try {
      await mergeIntents(session, sourceId, targetId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="intents">
        <h2>{t.intents.title}</h2>
        <p className="muted">{t.intents.loading}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="intents">
        <h2>{t.intents.title}</h2>
        <p className="error-text">{error}</p>
        <button type="button" className="btn" onClick={() => void load()}>{t.intents.refresh}</button>
      </section>
    );
  }

  const intents = data?.intents ?? [];
  const unclustered = data?.unclustered ?? [];
  const hasData = intents.length > 0 || unclustered.length > 0;
  const selectedCount = selected.size;

  return (
    <section className="intents">
      <div className="intents-head">
        <div>
          <h2>{t.intents.title}</h2>
          <p className="muted">{t.intents.subtitle}</p>
        </div>
        <div className="intents-actions">
          <button type="button" className="btn" onClick={() => void load()} disabled={busy}>{t.intents.refresh}</button>
          <button type="button" className="btn btn-primary" onClick={openCreate} disabled={busy || selectedCount === 0}>{t.intents.createIntent}</button>
        </div>
      </div>

      {selectedCount > 0 && (
        <p className="intents-selection">
          {t.intents.selectedCount(selectedCount)}
          <button type="button" className="link-btn" onClick={clearSelection}>{t.intents.clearSelection}</button>
        </p>
      )}

      {!hasData && <p className="intents-empty">{t.intents.empty}</p>}

      {unclustered.length > 0 && (
        <div className="intent-card intent-unclustered">
          <div className="intent-card-head">
            <h3>{t.intents.unclustered}</h3>
            <span className="muted">{t.intents.memberCount(unclustered.length)}</span>
          </div>
          <p className="intents-hint">{t.intents.createHint}</p>
          <div className="expr-list">
            {unclustered.map((expr) => (
              <label key={expr.id} className={`expr-chip${selected.has(expr.id) ? " selected" : ""}`}>
                <input type="checkbox" checked={selected.has(expr.id)} onChange={() => toggle(expr.id)} />
                <span className="expr-text">{expr.text}</span>
                {expr.scene && <span className="expr-scene">{expr.scene}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {intents.map((group) => {
        const pickedInThis = group.expressions.filter((e) => selected.has(e.id)).length;
        const canSplit = pickedInThis > 0 && pickedInThis < group.expressions.length;
        return (
          <div key={group.intent.id} className="intent-card">
            <div className="intent-card-head">
              <div>
                <h3>{group.intent.label}</h3>
                {group.intent.description && <p className="muted">{group.intent.description}</p>}
              </div>
              <span className="muted">{t.intents.memberCount(group.expressions.length)}</span>
            </div>
            <div className="intent-card-actions">
              <button
                type="button"
                className="btn"
                onClick={() => openSplit(group.intent.id)}
                disabled={busy || !canSplit}
                title={t.intents.splitHint}
              >
                {t.intents.split}
              </button>
              <label className="intent-merge">
                {t.intents.mergeInto}
                <select
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const target = e.target.value;
                    if (target) void handleMerge(group.intent.id, target);
                  }}
                >
                  <option value="">—</option>
                  {intents
                    .filter((other) => other.intent.id !== group.intent.id)
                    .map((other) => (
                      <option key={other.intent.id} value={other.intent.id}>{other.intent.label}</option>
                    ))}
                </select>
              </label>
            </div>
            <div className="expr-list">
              {group.expressions.map((expr) => (
                <label key={expr.id} className={`expr-chip${selected.has(expr.id) ? " selected" : ""}`}>
                  <input type="checkbox" checked={selected.has(expr.id)} onChange={() => toggle(expr.id)} />
                  <span className="expr-text">{expr.text}</span>
                  {expr.scene && <span className="expr-scene">{expr.scene}</span>}
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {dialog && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>{dialog.mode === "create" ? t.intents.createIntent : t.intents.split}</h3>
            <p className="muted">{dialog.mode === "create" ? t.intents.createHint : t.intents.splitHint}</p>
            <label className="field">
              <span>{t.intents.label}</span>
              <input
                type="text"
                value={label}
                autoFocus
                placeholder={t.intents.labelPlaceholder}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{t.intents.description}</span>
              <input
                type="text"
                value={description}
                placeholder={t.intents.descriptionPlaceholder}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setDialog(null)} disabled={busy}>{t.intents.cancel}</button>
              <button type="button" className="btn btn-primary" onClick={() => void submitDialog()} disabled={busy || !label.trim()}>{t.intents.confirm}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

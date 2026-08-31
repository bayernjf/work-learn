import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { fetchSyncStatus, SyncStatus } from "../api";
import { useI18n } from "../../i18n/context";

export function useSyncStatus(session: Session | null, reloadKey: number) {
  const { t } = useI18n();
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  const [syncStatusError, setSyncStatusError] = useState("");

  const refreshSyncStatus = async (currentSession: Session) => {
    setSyncStatusLoading(true);
    setSyncStatusError("");
    try {
      const result = await fetchSyncStatus(currentSession);
      setSyncStatus(result.data);
    } catch (error) {
      setSyncStatus(null);
      setSyncStatusError(error instanceof Error ? error.message : t.errors.syncStatus);
    } finally {
      setSyncStatusLoading(false);
    }
  };

  useEffect(() => {
    if (!session) {
      setSyncStatus(null);
      return;
    }
    void refreshSyncStatus(session);
  }, [session, reloadKey]);

  return { syncStatus, syncStatusLoading, syncStatusError, refreshSyncStatus };
}

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { fetchReuseNudgeSettings, fetchReuseSummary, updateReuseNudgeSettings, ReuseNudgeSettings, ReuseSummary } from "../api";
import { useI18n } from "../../i18n/context";

export function useReuse(session: Session | null, reloadKey: number) {
  const { t } = useI18n();
  const [reuseSummary, setReuseSummary] = useState<ReuseSummary | null>(null);
  const [reuseSettings, setReuseSettings] = useState<ReuseNudgeSettings | null>(null);
  const [reuseLoading, setReuseLoading] = useState(false);
  const [reuseError, setReuseError] = useState("");
  const [reuseSettingsError, setReuseSettingsError] = useState("");
  const [reuseSettingsSaving, setReuseSettingsSaving] = useState(false);

  useEffect(() => {
    if (!session) {
      setReuseSummary(null);
      setReuseSettings(null);
      return;
    }
    setReuseLoading(true);
    setReuseError("");
    setReuseSettingsError("");
    void Promise.all([fetchReuseSummary(session), fetchReuseNudgeSettings(session)])
      .then(([summaryResult, settingsResult]) => {
        setReuseSummary(summaryResult.data);
        setReuseSettings(settingsResult.data);
      })
      .catch((error: unknown) => setReuseError(error instanceof Error ? error.message : t.errors.reuseSummary))
      .finally(() => setReuseLoading(false));
  }, [session, reloadKey]);

  const handleToggleReuseNudges = async (enabled: boolean) => {
    if (!session || !reuseSettings) return;
    setReuseSettingsSaving(true);
    setReuseSettingsError("");
    try {
      const result = await updateReuseNudgeSettings(session, { enabled });
      setReuseSettings(result.data);
    } catch (error) {
      setReuseSettingsError(error instanceof Error ? error.message : t.errors.reuseSettings);
    } finally {
      setReuseSettingsSaving(false);
    }
  };

  return {
    reuseSummary,
    reuseSettings,
    reuseLoading,
    reuseError,
    reuseSettingsError,
    reuseSettingsSaving,
    handleToggleReuseNudges
  };
}

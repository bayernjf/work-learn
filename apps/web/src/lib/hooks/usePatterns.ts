import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getUserPatterns, UserPatterns } from "../api";
import { useI18n } from "../../i18n/context";

export function usePatterns(session: Session | null, reloadKey: number) {
  const { t } = useI18n();
  const [patterns, setPatterns] = useState<UserPatterns | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState("");

  const loadPatterns = async (currentSession: Session) => {
    setPatternsLoading(true);
    setPatternsError("");
    try {
      const result = await getUserPatterns(currentSession);
      setPatterns(result.data);
    } catch (error) {
      setPatterns(null);
      setPatternsError(error instanceof Error ? error.message : t.errors.patterns);
    } finally {
      setPatternsLoading(false);
    }
  };

  useEffect(() => {
    if (!session) {
      setPatterns(null);
      return;
    }
    void loadPatterns(session);
  }, [session, reloadKey]);

  return { patterns, patternsLoading, patternsError, loadPatterns };
}

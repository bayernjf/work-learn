import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { locales, LOCALE_STORAGE_KEY as STORAGE_KEY, type Locale, type Strings } from "./strings";

const DATE_LOCALES: Record<Locale, string> = { en: "en-US", zh: "zh-CN" };

type I18n = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Strings;
  formatDate: (iso: string) => string;
};

const I18nContext = createContext<I18n | null>(null);

function readStored(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "zh" || stored === "en" ? stored : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStored);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = locales[locale].meta.title;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: locales[locale],
      formatDate: (iso: string) => new Date(iso).toLocaleDateString(DATE_LOCALES[locale]),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside LocaleProvider");
  return value;
}

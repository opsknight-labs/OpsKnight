'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, normalizeLocale, type StatusLocale, type Translator } from './index';

const LocaleContext = createContext<StatusLocale>('en');

export function StatusLocaleProvider({
  locale,
  children,
}: {
  locale?: string;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={normalizeLocale(locale)}>{children}</LocaleContext.Provider>
  );
}

export function useStatusLocale(): StatusLocale {
  return useContext(LocaleContext);
}

export function useT(): Translator {
  const locale = useContext(LocaleContext);
  return useMemo(() => createTranslator(locale), [locale]);
}

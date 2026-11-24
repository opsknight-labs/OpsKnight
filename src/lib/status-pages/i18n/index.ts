import { en, type I18nKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { de } from './de';
import { pt } from './pt';
import { ja } from './ja';
import type { PublicServiceStatus } from '../public-contract';

export type { I18nKey };
export const STATUS_LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'ja'] as const;
export type StatusLocale = (typeof STATUS_LOCALES)[number];
export const DEFAULT_STATUS_LOCALE: StatusLocale = 'en';

export const STATUS_LOCALE_LABELS: Record<StatusLocale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  ja: '日本語',
};

export const DICTIONARIES: Record<StatusLocale, Record<I18nKey, string>> = {
  en,
  es,
  fr,
  de,
  pt,
  ja,
};

export function normalizeLocale(value: unknown): StatusLocale {
  return typeof value === 'string' && (STATUS_LOCALES as readonly string[]).includes(value)
    ? (value as StatusLocale)
    : DEFAULT_STATUS_LOCALE;
}

export type Translator = (key: I18nKey, values?: Record<string, string | number>) => string;

export function createTranslator(locale: unknown): Translator {
  const dictionary = DICTIONARIES[normalizeLocale(locale)];
  return (key, values) =>
    (dictionary[key] ?? en[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
      values && name in values ? String(values[name]) : match
    );
}

export const STATUS_LABEL_KEYS: Record<PublicServiceStatus, I18nKey> = {
  OPERATIONAL: 'status.operational',
  DEGRADED: 'status.degraded',
  MAINTENANCE: 'status.maintenance',
  PARTIAL_OUTAGE: 'status.partialOutage',
  MAJOR_OUTAGE: 'status.majorOutage',
  UNKNOWN: 'status.unknown',
};

/** Intl-backed date/time in the viewer's time zone and the page locale. */
export function formatLocalizedDateTime(
  value: string | Date,
  locale: unknown,
  timeZone = 'UTC',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(normalizeLocale(locale), { timeZone, ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { timeZone: 'UTC', ...options }).format(date);
  }
}

export function formatLocalizedNumber(
  value: number,
  locale: unknown,
  options?: Intl.NumberFormatOptions
) {
  return new Intl.NumberFormat(normalizeLocale(locale), options).format(value);
}

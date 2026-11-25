'use client';

import { STATUS_LOCALES, STATUS_LOCALE_LABELS, normalizeLocale } from '@/lib/status-pages/i18n';

/** Language select for the public status page chrome. Mount in the admin presentation settings. */
export default function StatusPageLocaleSetting({
  value,
  onChange,
  id = 'status-page-locale',
}: {
  value?: string | null;
  onChange: (locale: (typeof STATUS_LOCALES)[number]) => void;
  id?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        Public page language
      </label>
      <select
        id={id}
        value={normalizeLocale(value)}
        onChange={event => onChange(normalizeLocale(event.target.value))}
        className="w-full rounded border px-2 py-1.5 text-sm"
      >
        {STATUS_LOCALES.map(locale => (
          <option key={locale} value={locale}>
            {/* eslint-disable-next-line security/detect-object-injection -- key is a closed typed union / internal name, never request input */}
            {STATUS_LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Translates page chrome only. Incident and maintenance text stays as written.
      </p>
    </div>
  );
}

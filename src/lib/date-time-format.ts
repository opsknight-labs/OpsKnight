/** Reuse immutable Intl definitions with bounded memory. No policy, timezone
 * selection or classification result is cached; callers pass the current zone.
 * Each fixed formatting shape owns at most64 zone-specific formatters.
 */
export function createDateTimeFormatterCache(
  locale: string,
  options: Readonly<Omit<Intl.DateTimeFormatOptions, 'timeZone'>>
): (timeZone: string) => Intl.DateTimeFormat {
  const definition = Object.freeze({ ...options });
  const cache = new Map<string, Intl.DateTimeFormat>();
  return timeZone => {
    const existing = cache.get(timeZone);
    if (existing) return existing;
    const formatter = Object.freeze(new Intl.DateTimeFormat(locale, { ...definition, timeZone }));
    if (cache.size >= 64) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(timeZone, formatter);
    return formatter;
  };
}

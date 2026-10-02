/** Normalize an operator-supplied canonical application URL to an origin. */
export function normalizePublicOrigin(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_PUBLIC_ORIGIN');
  if (url.username || url.password) throw new Error('INVALID_PUBLIC_ORIGIN');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('INVALID_PUBLIC_ORIGIN');
  return url.origin;
}


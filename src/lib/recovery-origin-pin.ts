/** Pure parser shared by Node handlers and the Edge host-routing boundary. */
export function recoveryOriginPin(value = process.env.AUTH_RECOVERY_ORIGIN): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          process.env.NODE_ENV !== 'production' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)
        ))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

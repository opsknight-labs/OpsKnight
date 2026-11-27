/**
 * An id that only has to be unique inside one page (a React identity, a new row's key). Browsers
 * only expose crypto.randomUUID on secure origins, so a self-hosted install served over plain
 * http would throw a TypeError; fall back to a UUID-shaped string from Math.random. Never use it
 * for anything that must be unguessable.
 */
export function localId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const digit = Math.floor(Math.random() * 16);
    return (char === 'x' ? digit : (digit & 0x3) | 0x8).toString(16);
  });
}

/**
 * Timeline messages sit in the idx_event_ack_search btree (incidentId, message, createdAt). A
 * Postgres btree entry has to fit in about 2.7 KB, and long text that does not compress (a pasted
 * stack trace or token) makes the insert fail. Text that is also stored unindexed elsewhere (a
 * note's full content lives on IncidentNote) is clipped to this many UTF-8 bytes in the event.
 */
export const MAX_EVENT_MESSAGE_BYTES = 1500;

/** Cuts to the byte budget without splitting a character; the cut is marked with an ellipsis. */
export function clipEventMessage(message: string, max: number = MAX_EVENT_MESSAGE_BYTES): string {
  if (Buffer.byteLength(message, 'utf8') <= max) return message;
  let out = '';
  let bytes = 0;
  for (const char of message) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > max - 3) break;
    out += char;
    bytes += size;
  }
  return `${out}…`;
}

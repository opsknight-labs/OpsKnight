export const MCP_ABSOLUTE_SESSION_DAYS = 90;
export const MCP_DEFAULT_IDLE_DAYS = 30;
const DAY_MS = 86_400_000;

export function mcpSessionDates(now: Date, idleDays: number | undefined) {
  const idle = Math.min(Math.max(idleDays ?? MCP_DEFAULT_IDLE_DAYS, 1), MCP_ABSOLUTE_SESSION_DAYS);
  return {
    expiresAt: new Date(now.getTime() + idle * DAY_MS),
    absoluteExpiresAt: new Date(now.getTime() + MCP_ABSOLUTE_SESSION_DAYS * DAY_MS),
  };
}

/** Next expiry after use: slide by the idle window, never past the absolute cap. */
export function slideMcpExpiry(
  now: Date,
  idleDays: number | undefined,
  current: Date,
  absolute: Date | null
) {
  const { expiresAt } = mcpSessionDates(now, idleDays);
  const next = expiresAt > current ? expiresAt : current;
  // The absolute cap always wins, even if a stored expiry somehow already exceeds it.
  return absolute && next > absolute ? absolute : next;
}

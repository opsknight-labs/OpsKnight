/**
 * Pure helpers shared by the server graph loader and the client graph view.
 */

export type GraphFocus = { kind: 'bs' | 'svc'; id: string };

const FOCUS_PATTERN = /^(bs|svc):([A-Za-z0-9_-]{1,100})$/;

/** `bs:<id>` or `svc:<id>`; anything else is no focus. */
export function parseGraphFocus(raw: unknown): GraphFocus | null {
  if (typeof raw !== 'string') return null;
  const match = FOCUS_PATTERN.exec(raw.trim());
  return match ? { kind: match[1] as GraphFocus['kind'], id: match[2] } : null;
}

export const formatGraphFocus = (focus: GraphFocus) => `${focus.kind}:${focus.id}`;

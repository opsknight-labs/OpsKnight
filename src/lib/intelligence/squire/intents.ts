export type SquireIntent =
  | 'HELP'
  | 'ACTIVE_INCIDENTS'
  | 'SIMILAR'
  | 'CAUSES'
  | 'RUNBOOKS'
  | 'ON_CALL'
  | 'INCIDENT_SUMMARY'
  | 'UNKNOWN';

const has = (text: string, pattern: RegExp) => pattern.test(text);

/**
 * Maps a message to an intent with plain keyword rules, so Squire is useful with no AI configured and
 * its behaviour is predictable and testable. Page context (`onIncident`) disambiguates "why did this
 * happen?" from a general question. The patterns are literal alternations, so they cannot backtrack.
 */
export function routeIntent(message: string, onIncident: boolean): SquireIntent {
  const text = message.toLowerCase();
  if (has(text, /\b(help|what can you do|how do you work|commands?)\b/)) return 'HELP';
  if (has(text, /\bon[- ]?call\b|\bwho('?s| is) (up|available|responding)\b/)) return 'ON_CALL';
  if (has(text, /\b(on fire|what'?s (broken|down|happening)|active incidents?|open incidents?|incidents? (now|right now|today))\b/)) {
    return 'ACTIVE_INCIDENTS';
  }
  if (onIncident) {
    if (has(text, /\b(similar|seen (this )?before|happened before|precedent|past incidents?|history)\b/)) return 'SIMILAR';
    if (has(text, /\b(cause|why|root|deploy|change|changed|broke|regress)/)) return 'CAUSES';
    if (has(text, /\b(runbook|fix|resolve|remediat|mitigat|what (do|should) i do|next step)/)) return 'RUNBOOKS';
    return 'INCIDENT_SUMMARY';
  }
  return 'UNKNOWN';
}

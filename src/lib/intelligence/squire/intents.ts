export type SquireIntent =
  | 'WORK_QUEUE'
  | 'ALERT_STATS'
  | 'INCIDENT_STATS'
  | 'SERVICE_HEALTH'
  | 'RUNBOOK_SEARCH'
  | 'RECENT_CHANGES'
  | 'FOLLOWUPS'
  | 'POSTMORTEMS'
  | 'RESPONDERS'
  | 'HELP'
  | 'GREETING'
  | 'THANKS'
  | 'GUIDANCE'
  | 'SEARCH_INCIDENTS'
  | 'TIMELINE'
  | 'ACTIVE_INCIDENTS'
  | 'SIMILAR'
  | 'CAUSES'
  | 'RUNBOOKS'
  | 'ON_CALL'
  | 'INCIDENT_SUMMARY'
  | 'UNKNOWN';

const INCIDENT_PATTERNS: ReadonlyArray<readonly [SquireIntent, RegExp]> = [
  [
    'SIMILAR',
    /\b(similar|seen (this )?before|happened before|precedent|past incidents?|history)\b/,
  ],
  ['CAUSES', /\b(caus|why\b|root|deploy|change|changed|broke|regress)/],
  ['RUNBOOKS', /\b(runbook|fix|resolv|remediat|mitigat|what (do|should|can) (i|we) do|next step)/],
];

export function incidentIntents(message: string): SquireIntent[] {
  const text = message.toLowerCase();
  const summary = /\b(summar(?:y|i[sz]e)|overview|brief)\b/.test(text);
  const matched = INCIDENT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([intent]) => intent
  );
  return summary ? ['INCIDENT_SUMMARY', ...matched] : matched;
}

/** Small, bounded intent rules select fresh actor-scoped reads; user text never supplies facts. */
export function routeIntent(message: string, onIncident: boolean): SquireIntent {
  const text = message.toLowerCase().trim();
  if (/^(hi|hey|hello|hello there|good morning|good evening|good afternoon)[\s!.,?]*$/.test(text))
    return 'GREETING';
  if (/^(thanks|thank you|thankyou|cheers|got it|okay|ok)[\s!.,?]*$/.test(text)) return 'THANKS';
  if (/^help[\s!.,?]*$|\b(what can you do|how do you work|commands?)\b/.test(text)) return 'HELP';
  if (
    /\b(how (do|can|to|does|should|long)|what (is|are)|explain|where (do|can)|difference between|help|guide|instructions|configure|set up|enable|disable|understand|^does)\b/.test(
      text
    ) &&
    /\b(opsknight|acknowledge|ack|create|assign|escalate|snooze|resolve|runbooks?|on[- ]?call|schedule|rotation|overrides?|handoff|urgency|priority|severity|integration|dedup|webhook|notifications?|status pages?|postmortem|history|retention|privacy|permission|roles?|sso|scim|oidc|mcp|api key|basic mode|squire|ai|provider|quota|budget|timezone|time zone)\b/.test(
      text
    ) &&
    !/\b(health|status|owner|owns|on[- ]?call|assigned) (of|for|to)\b/.test(text)
  )
    return 'GUIDANCE';
  if (/\b(action items?|follow[- ]?ups?|overdue tasks?|my tasks)\b/.test(text)) return 'FOLLOWUPS';
  if (/\bpostmortems?\b/.test(text)) return 'POSTMORTEMS';
  if (
    /\balerts?\b/.test(text) &&
    /\b(how many|number of|count|statistics|stats|list|show|find|recent)\b/.test(text)
  )
    return 'ALERT_STATS';
  if (
    /\b(how many|number of|count|statistics|stats|analytics|trend|noisiest|noisy|most incidents?|mttr|mean time|average.*(resolution|resolve))\b/.test(
      text
    ) &&
    /\b(incidents?|outages?|services?|noisy|noisiest|mttr|mean time|resolution)\b/.test(text) &&
    !/\b(how many|count|number of) services?\b/.test(text)
  )
    return 'INCIDENT_STATS';
  if (
    /\b(assigned to me|my (?:(?:open|resolved|acknowledged|high urgency) )?(incidents?|queue|work|workload)|unassigned|unacknowledged|unacked|unresolved)\b/.test(
      text
    )
  )
    return 'WORK_QUEUE';
  if (
    onIncident &&
    /\b(assignee|assigned|responders?|who.*(?:owns|working).*(?:this|incident|it)|escalation status|next escalation)\b/.test(
      text
    )
  )
    return 'RESPONDERS';
  if (/\bon[- ]?call\b|\bwho('?s| is) (up|available|responding)\b/.test(text)) return 'ON_CALL';
  if (
    /\b(service (health|status|owner|ownership|dependencies|routing)|who (owns|maintains)|owning team|which team|dependencies|upstream|downstream|escalation policy|list services|show services|services? overview)\b/.test(
      text
    ) ||
    /\b(health|status) (of|for)\b/.test(text) ||
    (/\bservices?\b/.test(text) &&
      !/\b(incidents?|alerts?|runbooks?|changes?|postmortems?)\b/.test(text))
  )
    return 'SERVICE_HEALTH';
  if (
    /\b(recent|latest|list|show|find|what)\b/.test(text) &&
    /\b(changes?|changed|deploys?|deployments?|releases?)\b/.test(text) &&
    (!onIncident || !/\b(before|caus|broke|this started)\b/.test(text))
  )
    return 'RECENT_CHANGES';
  if (
    /\b(runbooks?|playbooks?)\b/.test(text) &&
    (!onIncident || /\b(search|find|list|catalog|all)\b/.test(text))
  )
    return 'RUNBOOK_SEARCH';
  if (
    /\b(on fire|what'?s (broken|down|happening)|active incidents?|open incidents?|incidents? (now|right now))\b/.test(
      text
    )
  )
    return 'ACTIVE_INCIDENTS';
  if (
    /\b(search|find|list|show|recent|resolved|yesterday|today|last week|past week)\b/.test(text) &&
    /\b(incidents?|outages?)\b/.test(text) &&
    !/\b(similar|related)\b/.test(text)
  )
    return 'SEARCH_INCIDENTS';
  if (onIncident) {
    if (/\b(timeline|sequence|chronolog|when did|what happened|what has happened)\b/.test(text))
      return 'TIMELINE';
    const matched = incidentIntents(text);
    if (matched.length) return matched[0];
    if (
      /\b(summar(?:y|i[sz]e)|overview|brief|status|tell me about|explain this|describe|what is this|what's this)\b/.test(
        text
      ) ||
      /\bsummari[sz]e\b/.test(text)
    )
      return 'INCIDENT_SUMMARY';
  }
  if (
    /\b(search|find|list|show|recent|resolved|yesterday|today|last week|past week)\b/.test(text) &&
    /\b(incidents?|outages?|alerts?)\b/.test(text)
  )
    return 'SEARCH_INCIDENTS';
  return 'UNKNOWN';
}

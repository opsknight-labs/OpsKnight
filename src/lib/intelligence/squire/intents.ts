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
  | 'CATCH_UP'
  | 'IDENTITY'
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

const GREETING_WORDS =
  "hi|hey|hello|hiya|howdy|yo|good (?:morning|evening|afternoon|day)|what(?:'?s| is) up|sup|how are you(?: doing)?|how(?:'?s| is) it going";
/** Who a greeting may be addressed to; any other word after it is the start of a question. */
const ADDRESSEE = 'there|all|team|folks|everyone|everybody|squire';
/** A whole message that only greets, optionally naming the assistant ("hey squire!", "hey 👋"). */
const GREETING = new RegExp(
  `^(?:${GREETING_WORDS}|morning|evening)(?: (?:${ADDRESSEE}))?[^a-z0-9]*$`
);
/**
 * One greeting at the sticky position, with its separator: "hey, " in "hey, any open incidents?", or a
 * final "hey squire 👋". Never "what's up with checkout" or "morning briefing", which are questions.
 */
const GREETING_AT = new RegExp(
  `(?:${GREETING_WORDS})(?! with\\b)(?: (?:${ADDRESSEE})\\b)?(?:[\\s!.,?]+|[^a-z0-9]*$)`,
  'y'
);
const THANKS_WORD =
  '(?:thanks|thank you|thankyou|thx|ty|cheers|got it|okay|ok|great|perfect|awesome|nice|cool|bye|goodbye|see you)(?: (?:so much|a lot|very much|again|mate|everyone))?';
/** "thanks", "cool, thanks!", "ok great": only acknowledgement words, each after a separator. */
const THANKS = new RegExp(`^${THANKS_WORD}(?:[\\s!.,]+${THANKS_WORD})*[^a-z0-9]*$`);

/**
 * Removes every leading greeting ("hey hi there, …"), and the assistant's configured name after one, in a
 * single left-to-right pass. `rest` is what is left to answer; empty when the message only greets.
 */
export function stripGreeting(
  message: string,
  name = 'Squire'
): { greeted: boolean; rest: string } {
  const lower = message.toLowerCase();
  const own = name.trim().toLowerCase();
  let at = lower.length - lower.trimStart().length;
  let greeted = false;
  for (;;) {
    GREETING_AT.lastIndex = at;
    const match = GREETING_AT.exec(lower);
    if (!match || !match[0]) break;
    greeted = true;
    at += match[0].length;
    if (own && lower.startsWith(own, at) && !/[a-z0-9]/.test(lower.charAt(at + own.length))) {
      at += own.length;
      while (at < lower.length && /[\s!.,?]/.test(lower.charAt(at))) at += 1;
    }
  }
  return { greeted, rest: message.slice(at).trim() };
}

/** A question about the asker's own on-call shift, answered from their catch-up. */
export const SHIFT_QUESTION =
  /\b(am i (?:on-call|on call|oncall)|when am i (?:next )?(?:on-call|on call|oncall)|my (?:next )?(?:on-call |on call |oncall )?shift)\b/;

/** Small, bounded intent rules select fresh actor-scoped reads; user text never supplies facts. */
export function routeIntent(message: string, onIncident: boolean): SquireIntent {
  const text = message.toLowerCase().trim();
  if (GREETING.test(text)) return 'GREETING';
  if (THANKS.test(text)) return 'THANKS';
  if (
    /^help[\s!.,?]*$|\b(what can you do|how do you work|commands?|who are you|what are you)\b/.test(
      text
    )
  )
    return 'HELP';
  // About the person asking: "who am I", "what's my role", "what permissions do I have", "list my teams".
  if (
    /\b(who am i|what (?:is|are) my (?:role|permissions?|access|access level|teams?)|what (?:permissions?|access|roles?) do i have|(?:which|what) teams? (?:am i|do i belong)|am i an? (?:admin|administrator|responder|auditor|stakeholder))\b|^(?:please )?(?:list|show|list me|show me) my teams[\s?!.]*$/.test(
      text
    )
  )
    return 'IDENTITY';
  // The person's own shift ("am I on call?", "when is my next shift?") is part of their catch-up.
  if (SHIFT_QUESTION.test(text)) return 'CATCH_UP';
  // Definitions of severity labels and response metrics: "what does SEV1 mean", "what is MTTR".
  if (
    /^what (?:is|does) (?:a |an )?(?:sev[0-5]|sev [0-5]|p[0-5]|mttr|mtta)(?: mean| stand for)?[\s?!.]*$/.test(
      text
    )
  )
    return 'GUIDANCE';
  // About the incident on screen: its state ("is it resolved?") and who moved it ("who resolved it").
  if (
    onIncident &&
    /\b(?:is|was|has) (?:it|this|this incident|the incident) (?:been |still )?(?:resolved|acknowledged|acked|closed|open|snoozed)\b/.test(
      text
    )
  )
    return 'INCIDENT_SUMMARY';
  if (onIncident && /\bwho (?:resolved|acknowledged|acked|closed|snoozed) (?:it|this)\b/.test(text))
    return 'TIMELINE';
  // Product how-to questions; a question about a record ("the priority of INC-42", "the escalation policy
  // for checkout"), a statistic ("on average") or a search ("help me find runbooks") is a data question.
  if (
    /\b(how (do|can|to|does|should|long)|what (is|are|does)|explain|where (do|can)|difference between|guide|instructions|configure|set up|enable|disable|understand|^does)\b/.test(
      text
    ) &&
    /\b(opsknight|acknowledge|ack|create|assign|escalate|escalation(?: polic(?:y|ies))?|snooze|resolve|runbooks?|on[- ]?call|schedules?|rotation|overrides?|handoff|urgency|priority|severity|integration|dedup|webhook|notifications?|status pages?|postmortem|history|retention|privacy|permission|roles?|sso|scim|oidc|mcp|api key|basic mode|squire|ai|provider|quota|budget|timezone|time zone|sev[0-5]|sev [0-5]|silenc\w*|mute|suppress\w*|maintenance)\b/.test(
      text
    ) &&
    !/\b(health|status|owner|owns|on[- ]?call|assigned|assignee|priority|severity|urgency|history|timeline|escalation polic(?:y|ies)) (of|for|to|on) (?!(?:an?|incidents|each|every|new)\b)/.test(
      text
    ) &&
    !/\b(average|on average|avg|mttr|mtta|mean time|how long (?:does|do|did) it (?:usually )?take|(?:resolve|resolution|ack|acknowledge) times?)\b/.test(
      text
    ) &&
    !/^(?:please )?(?:help me |can you |could you )?(?:find|search|show|list)\b/.test(text)
  )
    return 'GUIDANCE';
  if (
    /^what (?:is|are) (?:a |an )?(?:services?|teams?|incidents?|alerts?|schedules?|runbooks?|postmortems?|escalation polic(?:y|ies)|status pages?|overrides?|integrations?|change events?|business services?)[\s?!.]*$/.test(
      text
    )
  )
    return 'GUIDANCE';
  // A shift hand-off for the person asking: "catch me up", "what did I miss", "since my last shift".
  if (
    /\b(catch(?:ing)? me up|catch[- ]?up|what (?:did|have) i miss(?:ed)?|while i was (?:away|out|off|asleep)|since my (?:last )?shift|what happened overnight|shift hand-?off summary|(?:morning|daily|shift) briefing)\b/.test(
      text
    )
  )
    return 'CATCH_UP';
  if (/\b(action items?|follow[- ]?ups?|overdue tasks?|my tasks)\b/.test(text)) return 'FOLLOWUPS';
  if (/\bpostmortems?\b/.test(text)) return 'POSTMORTEMS';
  if (
    /\balerts?\b/.test(text) &&
    /\b(how many|number of|count|statistics|stats|list|show|find|recent)\b/.test(text)
  )
    return 'ALERT_STATS';
  if (
    /\b(how many|number of|count|statistics|stats|analytics|trend|noisiest|noisy|most incidents?|mttr|mean time|average.*(resolution|resolve)|(?:resolve|resolution|acknowledge).*\baverage|how long (?:does|do|did) it (?:usually )?take|(?:resolve|resolution|ack|acknowledge) times?)\b/.test(
      text
    ) &&
    /\b(incidents?|outages?|services?|noisy|noisiest|mttr|mean time|resolution|(?:resolve|ack|acknowledge) times?)\b/.test(
      text
    ) &&
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
    ) &&
    // "show incidents assigned to Alice" is a search, not this incident's responders.
    !/\bincidents\b/.test(text)
  )
    return 'RESPONDERS';
  if (/\bon[- ]?call\b|\bwho('?s| is) (up|available|responding)\b/.test(text)) return 'ON_CALL';
  if (
    /\b(service (health|status|owner|ownership|dependencies|routing)|who (owns|maintains)|owning team|which team|dependencies|upstream|downstream|escalation policy|list services|show services|services? overview)\b/.test(
      text
    ) ||
    /\b(health|status) (of|for)\b(?! (?:this|that|the) incident\b| it\b)/.test(text) ||
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
    if (
      /\b(timeline|sequence|chronolog|when did|what happened|what has happened|history of (?:this|the) incident|incident history)\b/.test(
        text
      )
    )
      return 'TIMELINE';
    const matched = incidentIntents(text);
    if (matched.length) return matched[0];
    if (
      /\b(summar(?:y|i[sz]e)|overview|brief|status|(?:priority|severity|urgency) (?:of|for) (?:this|that|it|the incident|inc)|what is the (?:priority|severity|urgency)|tell me about|explain this|describe|what is this|what's this)\b/.test(
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
    // A question about alerts alone is about alert records, not incidents.
    return /\balerts?\b/.test(text) && !/\b(incidents?|outages?)\b/.test(text)
      ? 'ALERT_STATS'
      : 'SEARCH_INCIDENTS';
  return 'UNKNOWN';
}

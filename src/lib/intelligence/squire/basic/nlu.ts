/* eslint-disable security/detect-unsafe-regex, security/detect-object-injection -- every pattern here is a fixed literal with bounded quantifiers run over a message capped at 2,000 characters (see the ReDoS timing test), and indexes are numeric or come from closed tables */
import { routeIntent, type SquireIntent } from '../intents';

/**
 * Deterministic understanding for basic mode: no model, no network. Text is normalised, obvious typos are
 * corrected against a small domain vocabulary, the intent is chosen by the existing rules first and by a
 * weighted keyword score when the rules abstain, and slots (limits, grouping, people, teams, incident
 * references, page requests) are extracted. Every step is bounded and linear in the message length.
 */

export const SLASH_COMMANDS = [
  'ack',
  'resolve',
  'note',
  'assign',
  'snooze',
  'oncall',
  'incidents',
  'help',
] as const;
export type SlashCommand = (typeof SLASH_COMMANDS)[number];

export interface ParsedSlashCommand {
  command: SlashCommand;
  args: string;
}

export function parseSlashCommand(message: string): ParsedSlashCommand | null {
  const match = message.trim().match(/^\/([a-z]{2,12})(?:\s+([\s\S]{0,1800}))?$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const alias: Record<string, SlashCommand> = {
    acknowledge: 'ack',
    on_call: 'oncall',
    'on-call': 'oncall',
    reassign: 'assign',
    comment: 'note',
    search: 'incidents',
    find: 'incidents',
  };
  const command = (SLASH_COMMANDS as readonly string[]).includes(name)
    ? (name as SlashCommand)
    : alias[name];
  return command ? { command, args: (match[2] ?? '').trim() } : null;
}

/** Words the assistant understands; misspellings within edit distance 1–2 are corrected to these. */
export const DOMAIN_VOCABULARY: readonly string[] = [
  'incident',
  'incidents',
  'alert',
  'alerts',
  'service',
  'services',
  'runbook',
  'runbooks',
  'playbook',
  'playbooks',
  'postmortem',
  'postmortems',
  'change',
  'changes',
  'changed',
  'deploy',
  'deploys',
  'deployment',
  'deployments',
  'release',
  'releases',
  'schedule',
  'schedules',
  'rotation',
  'override',
  'overrides',
  'escalation',
  'policy',
  'assigned',
  'assignee',
  'unassigned',
  'acknowledged',
  'unacknowledged',
  'acknowledge',
  'resolved',
  'unresolved',
  'resolve',
  'open',
  'snoozed',
  'snooze',
  'suppressed',
  'urgency',
  'priority',
  'severity',
  'high',
  'medium',
  'low',
  'critical',
  'timeline',
  'similar',
  'cause',
  'causes',
  'summary',
  'summarize',
  'summarise',
  'overview',
  'briefing',
  'responders',
  'responder',
  'owner',
  'owns',
  'owning',
  'team',
  'teams',
  'health',
  'status',
  'dependencies',
  'dependency',
  'upstream',
  'downstream',
  'followups',
  'action',
  'items',
  'tasks',
  'overdue',
  'today',
  'yesterday',
  'week',
  'month',
  'hours',
  'days',
  'weeks',
  'months',
  'recent',
  'latest',
  'count',
  'statistics',
  'analytics',
  'report',
  'trend',
  'noisy',
  'noisiest',
  'average',
  'resolution',
  'search',
  'find',
  'list',
  'show',
  'help',
  'assign',
  'reassign',
  'note',
  'related',
  'active',
  'queue',
  'workload',
  'people',
  'person',
  'oncall',
  'tomorrow',
  'between',
  'since',
  'notifications',
  'integration',
  'webhook',
  'permission',
  'history',
  'retention',
  'privacy',
  'provider',
  'budget',
  'quota',
  'timezone',
];

/** Ordinary words that must never be "corrected" into a domain word (e.g. last→list, thanks→tasks). */
const PROTECTED_WORDS = new Set(
  'there their these those which where while about after again should could would please thanks thank hello right still first going doing being having every other things thing maybe sure issue issues problem problems anything something nothing everything happening happened ongoing burning broken working shipped released covering depend depends pending outstanding firing triggered total volume outage outages current previous tonight morning evening afternoon minutes minute years really quite rather since until under through across within without during before behind above below where there whose which whom shall might must never often always usually around about again least last past this next week'.split(
    ' '
  )
);
const VOCABULARY = new Set([...DOMAIN_VOCABULARY, ...PROTECTED_WORDS, 'stats', 'call', 'calls']);

/** Restricted Damerau–Levenshtein distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous2: number[] | null = null;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const current = new Array<number>(cols);
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (previous2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, previous2[j - 2] + 1);
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous2 = previous;
    previous = current;
  }
  return previous[cols - 1];
}

const CONTRACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bwhat'?s\b/g, 'what is'],
  [/\bwho'?s\b/g, 'who is'],
  [/\bwhere'?s\b/g, 'where is'],
  [/\bhow'?s\b/g, 'how is'],
  [/\bthere'?s\b/g, 'there is'],
  [/\bcan'?t\b/g, 'cannot'],
  [/\bdoesn'?t\b/g, 'does not'],
  [/\bisn'?t\b/g, 'is not'],
  [/\bwasn'?t\b/g, 'was not'],
  [/\bpls\b|\bplz\b/g, 'please'],
  [/\bu\b/g, 'you'],
  [/\bur\b/g, 'your'],
  [/\bthx\b|\bty\b/g, 'thanks'],
];

/** Lower-case, expanded contractions, time shorthand spelled out (`24h` → `past 24 hours`), tidy spaces. */
export function normalizeMessage(message: string): string {
  let text = message.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const [pattern, replacement] of CONTRACTIONS) text = text.replace(pattern, replacement);
  text = text
    .replace(/\b(?:last|past) (\d{1,3})\s?h(?:rs?|ours?)?\b/g, 'past $1 hours')
    .replace(/\b(?:last|past) (\d{1,3})\s?d(?:ays?)?\b/g, 'past $1 days')
    .replace(/\b(?:last|past) (\d{1,2})\s?w(?:ks?|eeks?)?\b/g, 'past $1 weeks')
    .replace(/\b(\d{1,3})\s?h(?:rs?|ours?)?\b(?!\s?(?:ago|before))/g, 'past $1 hours')
    .replace(/\b(\d{1,3})\s?d(?:ays?)?\b(?!\s?(?:ago|before))/g, 'past $1 days')
    .replace(/\b(\d{1,2})\s?w(?:ks?|eeks?)?\b(?!\s?(?:ago|before))/g, 'past $1 weeks')
    .replace(/\b(?:last|past) hour\b/g, 'past 1 hours')
    .replace(/\b(?:last|past) day\b/g, 'past 1 days')
    .replace(/\bpast past\b/g, 'past')
    .replace(/\bon[- ]?cal\b/g, 'on-call')
    .replace(/\bon[- ]call\b/g, 'on-call')
    .replace(/\bfollow[- ]ups?\b/g, 'follow-ups')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

export interface SpellingCorrection {
  from: string;
  to: string;
}

/**
 * Corrects tokens that are one or two edits away from a vocabulary word. Quoted text, numbers, identifiers
 * and anything that already matches a known name (a service, team or person) is never touched.
 */
export function correctSpelling(
  text: string,
  knownNames: readonly string[] = []
): { text: string; corrections: SpellingCorrection[] } {
  const known = new Set(
    knownNames.flatMap(name => name.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean)
  );
  const corrections: SpellingCorrection[] = [];
  const segments = text.split(/(["“][^"”]{1,120}["”])/);
  const out = segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(/[a-z][a-z-]{4,}/g, token => {
        if (VOCABULARY.has(token) || known.has(token) || /[0-9]/.test(token)) return token;
        // Short words tolerate one edit, long ones two; the first letter must agree, which rules out most
        // accidental rewrites of ordinary English into domain words.
        const max = token.length <= 7 ? 1 : 2;
        let best: string | null = null;
        let bestDistance = max + 1;
        let ties: string[] = [];
        for (const word of DOMAIN_VOCABULARY) {
          if (word[0] !== token[0]) continue;
          const distance = editDistance(token, word, max);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = word;
            ties = [];
          } else if (distance === bestDistance && distance <= max) ties.push(word);
        }
        // Equally close candidates: prefer the one of the same length (a transposition over a deletion).
        if (best && ties.length) {
          const sameLength = [best, ...ties].filter(word => word.length === token.length);
          if (sameLength.length === 1) {
            best = sameLength[0];
            ties = [];
          }
        }
        if (!best || bestDistance > max || ties.length > 0 || corrections.length >= 6) return token;
        corrections.push({ from: token, to: best });
        return best;
      });
    })
    .join('');
  return { text: out, corrections };
}

/** Weighted keyword features per intent, used only when the first-match rules abstain. */
const FEATURES: ReadonlyArray<[SquireIntent, ReadonlyArray<[RegExp, number]>]> = [
  [
    'WORK_QUEUE',
    [
      [
        /\b(mine|my work|my queue|my incidents|assigned to me|what am i (on|working on|assigned)|i am assigned|on my plate|i own|owned by me|my plate)\b/,
        2,
      ],
      [/\b(unassigned|nobody|no one|without an? (assignee|owner))\b/, 2],
      [/\b(incidents?|work|queue)\b/, 0.5],
    ],
  ],
  [
    'ACTIVE_INCIDENTS',
    [
      [
        /\b(on fire|burning|broke|broken|down|happening|going on|ongoing|live|current(?:ly)? (?:open|active|outages?|incidents?|problems?)|right now)\b/,
        2,
      ],
      [/\b(active|open|unresolved)\b/, 1],
      [/\b(incidents?|problems?|issues?|outages?)\b/, 0.5],
    ],
  ],
  [
    'INCIDENT_STATS',
    [
      [
        /\b(how many|number of|count|total|volume|statistics|stats|analytics|trend|trends|report|breakdown|busiest|noisiest|noisy|most|compare|comparison|versus|vs)\b/,
        2.5,
      ],
      [/\b(?:per|by)\s+(team|teams|service|services|urgency|day|hour|status|priority|week)\b/, 3.5],
      [/\b(mttr|mtta|mean time|average|avg|time to (resolve|acknowledge|resolution|ack))\b/, 3],
      [/\b(incidents?|outages?|services?|alerts?)\b/, 0.5],
    ],
  ],
  [
    'ALERT_STATS',
    [
      [/\balerts?\b/, 2],
      [/\b(how many|count|number of|recent|list|show|triggered|firing)\b/, 1],
    ],
  ],
  [
    'SERVICE_HEALTH',
    [
      [
        /\b(who (owns|is responsible for|maintains|looks after)|owner of|ownership|owning team|responsible team|which team)\b/,
        2.5,
      ],
      [
        /\b(health|status|healthy|dependencies|depend(?:s|ent)? (?:on|upon)|upstream|downstream|escalation policy)\b/,
        2,
      ],
      [/\bservices?\b/, 1],
    ],
  ],
  [
    'RUNBOOK_SEARCH',
    [
      [/\b(runbooks?|playbooks?|procedures?|how to fix)\b/, 2.5],
      [/\b(search|find|list|show|about|for)\b/, 0.5],
    ],
  ],
  [
    'RECENT_CHANGES',
    [
      [
        /\b(changes?|changed|deploy(s|ed|ment|ments)?|releas(?:e|es|ed)|rollouts?|shipped|config changes?|feature flags?)\b/,
        2.5,
      ],
      [/\b(recent|latest|today|yesterday|last|past|what)\b/, 0.5],
    ],
  ],
  [
    'FOLLOWUPS',
    [
      [/\b(follow-?ups?|action items?|tasks?|to-?dos?|overdue|remediation items?)\b/, 2.5],
      [/\b(my|open|pending|outstanding)\b/, 0.5],
    ],
  ],
  [
    'POSTMORTEMS',
    [
      [
        /\b(postmortems?|post-mortems?|retros?|retrospectives?|rca|root cause analys[ie]s|incident reviews?|lessons learned)\b/,
        3,
      ],
    ],
  ],
  [
    'ON_CALL',
    [
      [
        /\b(on-call|oncall|who is (up|available|responding|covering|paged)|who do i page|who should i (page|call|contact)|coverage|shift|rotation)\b/,
        3,
      ],
      [/\b(tomorrow|tonight|in \d+ hours?|now|currently)\b/, 0.5],
    ],
  ],
  [
    'SEARCH_INCIDENTS',
    [
      [
        /\b(search|find|look up|lookup|list|show|any|were there|have there been|did we have)\b/,
        1.5,
      ],
      [/\b(incidents?|outages?|tickets?)\b/, 1.5],
      [/\b(?:incidents?|outages?)\b.{0,40}\b(?:for|of|on|assigned to|owned by|about)\b/, 1],
      [
        /\b(resolved|closed|last week|past week|yesterday|today|this (week|month)|past \d+ (hours|days|weeks|months)|since|between|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(last |this )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/,
        1,
      ],
    ],
  ],
  [
    'HELP',
    [[/\b(what can you do|capabilities|commands?|how do you work|usage|what do you know)\b/, 3]],
  ],
];

const INCIDENT_FEATURES: ReadonlyArray<[SquireIntent, ReadonlyArray<[RegExp, number]>]> = [
  [
    'SIMILAR',
    [
      [
        /\b(similar|seen (this|it) before|happened before|precedent|history of this|again|recurring|like this)\b/,
        3,
      ],
    ],
  ],
  [
    'CAUSES',
    [
      [
        /\b(cause|causes|why|root|what (broke|changed|triggered)|culprit|reason|blame|because)\b/,
        3,
      ],
    ],
  ],
  [
    'RUNBOOKS',
    [
      [
        /\b(runbook|fix|fix it|resolve this|remediat|mitigat|what (do|should|can) (i|we) do|next steps?|playbook|how do i fix)\b/,
        3,
      ],
    ],
  ],
  [
    'TIMELINE',
    [
      [
        /\b(timeline|sequence|chronolog(?:y|ical)?|when did|what happened|history of events|events so far|so far)\b/,
        3,
      ],
    ],
  ],
  [
    'RESPONDERS',
    [
      [
        /\b(who is (working|on this|handling|assigned)|assignee|responders?|who owns this|escalat(ed|ion status))\b/,
        3,
      ],
    ],
  ],
  [
    'INCIDENT_SUMMARY',
    [
      [
        /\b(summar(y|ise|ize)|overview|brief(?:ing)?|tl;?dr|catch me up|what is this|explain this|describe)\b/,
        3,
      ],
    ],
  ],
];

/**
 * Phrasings the first-match rules get wrong (a metric question that mentions "acknowledge" reads as product
 * guidance; "briefing" is not "brief"). Checked before the rules; deliberately short.
 */
const OVERRIDES: ReadonlyArray<[SquireIntent, RegExp, boolean | null]> = [
  [
    'INCIDENT_STATS',
    /\b(mttr|mtta|mean time to (?:resolve|acknowledge|resolution|ack)|average time to (?:resolve|acknowledge))\b/,
    null,
  ],
  ['INCIDENT_SUMMARY', /\b(briefing|tl;?dr|catch me up)\b/, true],
];

export interface IntentPrediction {
  intent: SquireIntent;
  /** 1 when the first-match rules decided; otherwise the share of the winning score (0–1). */
  confidence: number;
  /** Next-best readings, for clarification chips when the message is ambiguous. */
  alternatives: Array<{ intent: SquireIntent; confidence: number }>;
  /** True when the rules abstained and the keyword score decided. */
  scored: boolean;
}

function scoreIntents(
  text: string,
  onIncident: boolean
): Array<{ intent: SquireIntent; score: number }> {
  const table = onIncident ? [...INCIDENT_FEATURES, ...FEATURES] : FEATURES;
  return table
    .map(([intent, features]) => ({
      intent,
      score: features.reduce(
        (sum, [pattern, weight]) => sum + (pattern.test(text) ? weight : 0),
        0
      ),
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** The intent the rules choose, or the best-scoring one when the rules abstain and the score is clear. */
export function classifyIntent(text: string, onIncident: boolean): IntentPrediction {
  const override = OVERRIDES.find(
    ([, pattern, incidentOnly]) =>
      (incidentOnly === null || incidentOnly === onIncident) && pattern.test(text)
  );
  const ruled = override ? override[0] : routeIntent(text, onIncident);
  const scored = scoreIntents(text, onIncident);
  const [top, second] = scored;
  // Confidence compares the two best readings; a long tail of weak matches must not dilute a clear winner.
  const share = (score: number) => score / ((top?.score ?? 0) + (second?.score ?? 0) || 1);
  const alternatives = scored
    .filter(entry => entry.intent !== ruled)
    .slice(0, 2)
    .map(entry => ({ intent: entry.intent, confidence: share(entry.score) }));
  if (ruled !== 'UNKNOWN') return { intent: ruled, confidence: 1, alternatives, scored: false };
  if (!top || top.score < 2)
    return { intent: 'UNKNOWN', confidence: 0, alternatives, scored: true };
  const confidence = share(top.score);
  const clear = !second || top.score >= second.score * 1.5 || top.score - second.score >= 1.5;
  return clear
    ? {
        intent: top.intent,
        confidence,
        alternatives: alternatives.filter(a => a.intent !== top.intent),
        scored: true,
      }
    : {
        intent: 'UNKNOWN',
        confidence,
        alternatives: scored
          .slice(0, 2)
          .map(entry => ({ intent: entry.intent, confidence: share(entry.score) })),
        scored: true,
      };
}

export interface Slots {
  /** Row limit asked for ("top 10", "show 20"), capped by the reader. */
  limit?: number;
  groupBy?: 'service' | 'team' | 'urgency' | 'status' | 'priority' | 'day' | 'hour';
  team?: string;
  /** A person's name or handle, or 'me'. */
  person?: string;
  /** 'current' for "this incident"/"it"; otherwise an identifier mentioned in the text. */
  incidentRef?: 'current' | string;
  /** The person asked for the next page of the previous list. */
  more: boolean;
  /** Explicit action verbs that may become a proposal in basic mode. */
  action?: 'acknowledge' | 'resolve' | 'note' | 'reassign' | 'snooze' | 'link';
  actionText?: string;
  /** Snooze duration in minutes when an action is snooze. */
  snoozeMinutes?: number;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const QUESTION =
  /\b(how (do|can|to|does|should)|what (is|are|does)|explain|where (do|can)|^does|\?$)/;

/** Slots other than the status/urgency/time filters that `parseBasicQuery` already handles. */
export function extractSlots(normalized: string, original: string): Slots {
  const slots: Slots = { more: false };
  const text = normalized.replace(/["“][^"”]{1,120}["”]/g, ' ');
  const limit =
    text.match(/\b(?:top|first|show|list|latest|last)\s+(\d{1,2})\b/)?.[1] ??
    text.match(
      /\b(\d{1,2})\s+(?:incidents?|services?|alerts?|runbooks?|changes?|postmortems?|results?|rows?)\b/
    )?.[1];
  if (limit) slots.limit = Math.min(20, Math.max(1, Number(limit)));
  const group = text.match(
    /\b(?:by|per|grouped by|group by|breakdown by)\s+(team|urgency|service|status|priority|day|hour|week)\b/
  )?.[1];
  if (group) slots.groupBy = group === 'week' ? 'day' : (group as Slots['groupBy']);
  const team =
    text.match(/\b(?:for|of|in|on)\s+(?:the\s+)?([a-z0-9][a-z0-9 _.-]{1,40}?)\s+team\b/)?.[1] ??
    text.match(/\bteam\s+([a-z0-9][a-z0-9_.-]{1,40})\b/)?.[1];
  if (team && !/^(my|our|your|the|a|this|that|which|what)$/.test(team)) slots.team = team.trim();
  const handle = original.match(/@([a-z0-9._-]{2,40})/i)?.[1];
  if (handle) slots.person = handle;
  else if (/\b(assigned to me|for me|mine|my)\b/.test(text)) slots.person = 'me';
  else {
    const name = original.match(
      /\b(?:assigned to|owned by|reassign(?: it| this)? to|assign(?: it| this)? to|hand(?: it)? to)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/
    )?.[1];
    if (name) slots.person = name;
  }
  if (/\b(this|that|current) (incident|one|ticket)\b|\bit\b/.test(text))
    slots.incidentRef = 'current';
  const id = text.match(/\bincidents?\s+([a-z0-9]{20,32})\b/)?.[1];
  if (id) slots.incidentRef = id;
  slots.more =
    /^(?:show |see |give me )?(?:more|next(?: \d{1,2})?|next page|continue|the rest|others)\b[\s!.]*$/.test(
      text
    );
  if (!QUESTION.test(text)) {
    const action = text.match(
      /^(?:please |pls |ok |can you |could you |go ahead and )?(?:(ack(?:nowledge)?)|(resolve|close|mark (?:as )?resolved)|(add (?:a )?note|note|comment|log)|(assign|reassign|hand(?: it)? to)|(snooze|pause|silence|mute)|(link|mark (?:as )?related|relate))\b/
    );
    if (action) {
      slots.action = action[1]
        ? 'acknowledge'
        : action[2]
          ? 'resolve'
          : action[3]
            ? 'note'
            : action[4]
              ? 'reassign'
              : action[5]
                ? 'snooze'
                : 'link';
      const rest = original
        .replace(/^(?:please |pls |ok |can you |could you |go ahead and )/i, '')
        .replace(
          /^(?:ack(?:nowledge)?|resolve|close|mark (?:as )?resolved|add (?:a )?note|note|comment|log|assign|reassign|hand(?: it)? to|snooze|pause|silence|mute|link|mark (?:as )?related|relate)\b\s*(?:this incident|this|it|the incident|incident)?\s*(?:[:\-–]\s*|with\s+|as\s+|to\s+|for\s+|saying\s+)?/i,
          ''
        )
        .trim();
      if (rest) slots.actionText = rest.slice(0, 1000);
      if (slots.action === 'snooze') {
        const duration = text.match(/\b(\d{1,3})\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/);
        if (duration) {
          const unit = duration[2];
          const factor = /^d/.test(unit) ? 1440 : /^h/.test(unit) ? 60 : 1;
          slots.snoozeMinutes = Math.min(7 * 1440, Math.max(5, Number(duration[1]) * factor));
        } else if (/\b(an hour|one hour)\b/.test(text)) slots.snoozeMinutes = 60;
        else if (/\b(tomorrow|a day|one day)\b/.test(text)) slots.snoozeMinutes = 1440;
      }
    }
  }
  return slots;
}

/** Day of week index for a lowercase name, or -1. */
export function weekdayIndex(name: string): number {
  const prefix = name.slice(0, 3);
  return WEEKDAYS.findIndex(day => day.startsWith(prefix));
}

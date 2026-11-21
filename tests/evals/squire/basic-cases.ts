import type { SquireIntent } from '@/lib/intelligence/squire/intents';

/**
 * Structural evaluation cases for the assistant that need no model: each names the intent a deterministic
 * answer must be built for, text it must or must not contain, and whether it must propose, cite or ask.
 * They run against a seeded database on every pull request (`squire-evals-contract.test.ts`), so a change
 * that makes basic mode guess, leak or stop citing fails the build.
 */
export interface SquireBasicEvalCase {
  id: string;
  question: string;
  /** Asked on the seeded incident page when true. */
  onIncident?: boolean;
  /** Asked on the seeded service page when true. */
  onService?: boolean;
  expectIntent: SquireIntent;
  mustContain?: string[];
  mustNotContain?: string[];
  /** Expect at least one proposal card of this action. */
  expectProposal?: string;
  /** Expect no proposal at all. */
  forbidProposal?: boolean;
  /** Expect at least one citation. */
  mustCite?: boolean;
  /** Expect a clarifying question (chips are the choices). */
  expectClarification?: boolean;
  /** A follow-up to send after `question`, with its own expectations. */
  then?: {
    question: string;
    expectIntent: SquireIntent;
    mustContain?: string[];
    expectProposal?: string;
  };
}

export const BASIC_CASES: readonly SquireBasicEvalCase[] = [
  // Work queue and search
  {
    id: 'queue-mine',
    question: 'My open incidents',
    expectIntent: 'WORK_QUEUE',
    mustContain: ['Your incident work', 'Pool exhausted'],
    mustNotContain: ['Hidden payroll'],
    mustCite: true,
  },
  {
    id: 'queue-typo',
    question: 'my open incidnets',
    expectIntent: 'WORK_QUEUE',
    mustContain: ['Your incident work'],
  },
  {
    id: 'queue-unassigned',
    question: 'Show unassigned incidents',
    expectIntent: 'WORK_QUEUE',
    mustContain: ['no person or team assigned'],
  },
  {
    id: 'search-week',
    question: 'Show checkout incidents from last week',
    expectIntent: 'SEARCH_INCIDENTS',
    mustContain: ['Matching incidents'],
    mustNotContain: ['Hidden payroll'],
  },
  {
    id: 'search-since',
    question: 'find incidents since monday',
    expectIntent: 'SEARCH_INCIDENTS',
    mustContain: ['since'],
  },
  {
    id: 'search-page',
    question: 'list open incidents',
    expectIntent: 'ACTIVE_INCIDENTS',
    mustContain: ['show more'],
    then: { question: 'show more', expectIntent: 'ACTIVE_INCIDENTS', mustContain: ['Showing 6'] },
  },
  {
    id: 'search-team',
    question: 'incidents for the checkout team',
    expectIntent: 'SEARCH_INCIDENTS',
    mustContain: ['Matching incidents'],
  },
  {
    id: 'search-person',
    question: 'incidents assigned to Eval Responder',
    expectIntent: 'SEARCH_INCIDENTS',
    mustContain: ['assigned to Eval Responder'],
  },
  {
    id: 'active',
    question: 'What is on fire right now?',
    expectIntent: 'ACTIVE_INCIDENTS',
    mustContain: ['Matching incidents'],
  },
  // Reports
  {
    id: 'stats-week',
    question: 'How many incidents this week?',
    expectIntent: 'INCIDENT_STATS',
    mustContain: ['Incident report', 'Mean time to acknowledge'],
    mustNotContain: ['Hidden payroll'],
  },
  {
    id: 'stats-team',
    question: 'incidents by team this week',
    expectIntent: 'INCIDENT_STATS',
    mustContain: ['By team'],
  },
  {
    id: 'stats-urgency',
    question: 'breakdown of incidents by urgency this month',
    expectIntent: 'INCIDENT_STATS',
    mustContain: ['By urgency'],
  },
  {
    id: 'stats-day',
    question: 'incidents per day this week',
    expectIntent: 'INCIDENT_STATS',
    mustContain: ['By day'],
  },
  {
    id: 'stats-mttr',
    question: 'What is our MTTR this month?',
    expectIntent: 'INCIDENT_STATS',
    mustContain: ['Mean time to resolution'],
  },
  {
    id: 'alerts',
    question: 'How many alerts today?',
    expectIntent: 'ALERT_STATS',
    mustContain: ['alert record'],
  },
  // Services, on-call, changes, runbooks
  {
    id: 'service-owner',
    question: 'Who owns Checkout API?',
    expectIntent: 'SERVICE_HEALTH',
    mustContain: ['Owning team'],
    mustCite: true,
  },
  {
    id: 'service-fuzzy',
    question: 'who owns chekout api',
    expectIntent: 'SERVICE_HEALTH',
    mustContain: ['Showing results for Checkout API'],
  },
  {
    id: 'service-ambiguous',
    question: 'who owns pay',
    expectIntent: 'SERVICE_HEALTH',
    expectClarification: true,
    then: {
      question: 'Payments Worker',
      expectIntent: 'SERVICE_HEALTH',
      mustContain: ['Payments Worker'],
    },
  },
  {
    id: 'service-context',
    question: 'who is on call for this service',
    onService: true,
    expectIntent: 'ON_CALL',
    // The seeded service has no escalation policy: the answer names it and substitutes nothing.
    mustContain: ['Checkout API', 'not substituted unrelated schedules'],
    mustNotContain: ['Several services match'],
  },
  {
    id: 'service-context-incidents',
    question: 'open incidents',
    onService: true,
    expectIntent: 'ACTIVE_INCIDENTS',
    mustContain: ['Matching incidents'],
  },
  {
    id: 'oncall',
    question: 'Who is on call for Checkout API?',
    expectIntent: 'ON_CALL',
    mustContain: ['Checkout API', 'not substituted unrelated schedules'],
  },
  {
    id: 'changes',
    question: 'Recent deployments for Checkout API',
    expectIntent: 'RECENT_CHANGES',
    mustContain: ['Recorded changes'],
  },
  {
    // The evaluated person is a team-scoped user without runbook access: the answer says so, and lists nothing.
    id: 'runbooks-scope',
    question: 'List database runbooks',
    expectIntent: 'RUNBOOK_SEARCH',
    mustContain: ['do not have permission'],
    mustNotContain: ['Database pool reset'],
  },
  {
    id: 'followups',
    question: 'Show overdue action items',
    expectIntent: 'FOLLOWUPS',
    mustContain: ['Follow-up action items'],
  },
  {
    id: 'postmortems',
    question: 'Find database postmortems',
    expectIntent: 'POSTMORTEMS',
    mustContain: ['Recorded postmortems'],
  },
  // Guidance, help, greetings
  {
    id: 'guidance',
    question: 'How do on-call overrides work?',
    expectIntent: 'GUIDANCE',
    mustContain: ['Schedules and overrides'],
    forbidProposal: true,
  },
  {
    id: 'help',
    question: '/help',
    expectIntent: 'HELP',
    mustContain: ['/ack'],
    forbidProposal: true,
  },
  { id: 'greeting', question: 'hi', expectIntent: 'GREETING', forbidProposal: true },
  { id: 'ambiguous', question: 'recent', expectIntent: 'UNKNOWN', expectClarification: true },
  // Incident page
  {
    id: 'incident-brief',
    question: 'Give me a briefing',
    onIncident: true,
    expectIntent: 'INCIDENT_SUMMARY',
    mustContain: ['Suggested checks'],
    mustCite: true,
  },
  {
    id: 'incident-similar',
    question: 'Have we seen this before?',
    onIncident: true,
    expectIntent: 'SIMILAR',
  },
  {
    id: 'incident-causes',
    question: 'What changed before this started?',
    onIncident: true,
    expectIntent: 'CAUSES',
    mustContain: ['cause'],
  },
  {
    id: 'incident-runbooks',
    question: 'Which runbook fits?',
    onIncident: true,
    expectIntent: 'RUNBOOKS',
    mustContain: ['Suggested checks'],
  },
  {
    id: 'incident-timeline',
    question: 'show the timeline',
    onIncident: true,
    expectIntent: 'TIMELINE',
    mustContain: ['Recorded timeline'],
  },
  {
    id: 'incident-responders',
    question: 'Who is assigned to this incident?',
    onIncident: true,
    expectIntent: 'RESPONDERS',
    mustContain: ['Responders for'],
  },
  // Proposals (basic mode, confirmation required)
  {
    id: 'propose-ack',
    question: 'acknowledge this',
    onIncident: true,
    expectIntent: 'RESPONDERS',
    expectProposal: 'acknowledge_incident',
    mustContain: ['Nothing happens until you confirm'],
  },
  {
    id: 'propose-ack-slash',
    question: '/ack',
    onIncident: true,
    expectIntent: 'RESPONDERS',
    expectProposal: 'acknowledge_incident',
  },
  {
    id: 'propose-resolve',
    question: '/resolve rolled back release 42 and verified recovery',
    onIncident: true,
    expectIntent: 'RESPONDERS',
    expectProposal: 'resolve_incident',
  },
  {
    id: 'propose-resolve-short',
    question: 'resolve this',
    onIncident: true,
    expectIntent: 'RESPONDERS',
    forbidProposal: true,
    mustContain: ['What fixed it'],
    then: {
      question: 'rolled back release 42 and verified recovery',
      expectIntent: 'RESPONDERS',
      expectProposal: 'resolve_incident',
    },
  },
  {
    id: 'propose-note',
    question: 'add a note: customer impact confirmed by support',
    onIncident: true,
    expectIntent: 'RESPONDERS',
    expectProposal: 'add_incident_note',
  },
  {
    id: 'propose-assign',
    question: 'assign this to Eval Responder',
    onIncident: true,
    expectIntent: 'RESPONDERS',
    expectProposal: 'reassign_incident',
  },
  {
    id: 'propose-off-incident',
    question: 'acknowledge this',
    expectIntent: 'UNKNOWN',
    forbidProposal: true,
    mustContain: ['Open the incident'],
  },
  {
    id: 'guidance-not-action',
    question: 'how do I acknowledge an incident?',
    onIncident: true,
    expectIntent: 'GUIDANCE',
    forbidProposal: true,
  },
  // Scope
  {
    id: 'scope-hidden',
    question: 'Find payroll incidents',
    expectIntent: 'SEARCH_INCIDENTS',
    mustNotContain: ['Hidden payroll'],
  },
  // Injection and multi-turn (no model: third-party text is never echoed as instructions or secrets)
  {
    id: 'injection-timeline-basic',
    question: 'show the timeline',
    onIncident: true,
    expectIntent: 'TIMELINE',
    mustContain: ['Recorded timeline'],
    mustNotContain: ['Ignore previous instructions', 'Payroll secret'],
    forbidProposal: true,
  },
  {
    id: 'injection-brief-basic',
    question: 'Give me a briefing',
    onIncident: true,
    expectIntent: 'INCIDENT_SUMMARY',
    mustNotContain: ['Ignore previous instructions', 'Payroll secret'],
    forbidProposal: true,
  },
  {
    id: 'multi-turn-service-followup',
    question: 'Who owns Checkout API?',
    expectIntent: 'SERVICE_HEALTH',
    mustContain: ['Owning team'],
    then: {
      question: 'recent deployments for it',
      expectIntent: 'RECENT_CHANGES',
      mustContain: ['Checkout release 42'],
    },
  },
  {
    id: 'scope-service-hidden',
    question: 'Who owns Hidden Payroll?',
    expectIntent: 'SERVICE_HEALTH',
    mustContain: ['No matching service'],
    mustNotContain: ['Payroll secret'],
  },
];

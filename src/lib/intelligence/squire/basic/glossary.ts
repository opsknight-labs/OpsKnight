/** Plain-language definitions for newcomers: what it is, one concrete example, then where to see it live. */
const TERMS: ReadonlyArray<{
  names: string;
  title: string;
  text: string;
  example: string;
  ask: string;
}> = [
  {
    names: 'incidents?',
    title: 'Incident',
    text: 'An incident is a record that something is wrong with a service and someone needs to deal with it. It tracks who owns it, what happened and when it was fixed.',
    example:
      'Checkout is returning errors, so an incident called "Checkout latency high" is opened.',
    ask: 'Ask “What is on fire right now?” to see the open incidents in your workspace',
  },
  {
    names: 'alerts?',
    title: 'Alert',
    text: 'An alert is a single signal from a monitoring tool that something crossed a threshold. Several alerts about the same problem are grouped into one incident, so you are not paged ten times.',
    example:
      'Your monitoring tool sends “CPU above 90%” every minute; they all land on one incident.',
    ask: 'Ask “How many alerts came in this week?” to see the volume',
  },
  {
    names: 'on.?call',
    title: 'On call',
    text: 'Being on call means you are the person who gets notified first when something breaks during your shift. Teams take turns, so nobody is available around the clock.',
    example: 'Priya is on call for Checkout this week, so a new Checkout incident pages her first.',
    ask: 'Ask “Who is on call?” to see it for your workspace',
  },
  {
    names: 'escalation polic(?:y|ies)',
    title: 'Escalation policy',
    text: 'An escalation policy is the plan for who gets notified and in what order. If the first person does not respond in time, it moves on to the next person or team.',
    example:
      'Page the on-call engineer; after 10 minutes without an acknowledgement, page their manager.',
    ask: 'Ask “What is the escalation policy for Checkout?” to see it for your workspace',
  },
  {
    names: 'acknowledg(?:e|ing|ement)|ack',
    title: 'Acknowledge',
    text: 'Acknowledging an incident tells the team that you have seen it and are looking into it. Escalation stops, so nobody else is paged for it. It does not mean the problem is fixed.',
    example:
      'You get paged, open the incident and press Acknowledge; your teammates see you own it.',
    ask: 'Ask “Which incidents are not acknowledged?” to see what still needs an owner',
  },
  {
    names: 'resolv(?:e|ing|ed)',
    title: 'Resolve',
    text: 'Resolving an incident closes it once the problem is really fixed. Add a short note on what fixed it, so the next person can find the answer quickly.',
    example:
      'After rolling back a bad release you confirm checkout works, then resolve with "rolled back v42".',
    ask: 'Ask “How was this fixed?” on an incident to see recorded fixes',
  },
  {
    names: 'run ?books?',
    title: 'Runbook',
    text: 'A runbook is a written, step-by-step guide for handling a known problem, such as restarting a stuck worker. It saves you from working out the fix under pressure.',
    example: '"Database pool reset": check connections, restart the pool, confirm queries recover.',
    ask: 'Ask “Show runbooks” to browse the ones in your workspace',
  },
  {
    names: 'post.?mortems?',
    title: 'Postmortem',
    text: 'A postmortem is a short review written after an incident. It records what happened, why, and what the team will change so it does not happen again, without blaming anyone.',
    example:
      'After an outage, the team writes the timeline and adds "Add a pool alert" with an owner and due date.',
    ask: 'Ask “Show postmortems” to see them in your workspace',
  },
  {
    names: 'status ?pages?',
    title: 'Status page',
    text: 'A status page is a public or private web page that tells customers what is working and what is not. It stops people asking support whether you are down.',
    example: 'Checkout shows “Degraded performance” while the team investigates.',
    ask: 'Ask “How do I publish a status update?” for the steps',
  },
  {
    names: 'slos?|service level objectives?|slas?|service level agreements?',
    title: 'SLA and SLO',
    text: 'An SLO is a target you set for how well a service should perform, such as 99.9% uptime. An SLA is that target as a promise, including response times for incidents, such as acknowledging within 15 minutes.',
    example:
      'A high-urgency incident must be acknowledged within 15 minutes; if nobody does, it breaches its SLA.',
    ask: 'Ask “Which incidents breached SLA?” to see what is past its target',
  },
  {
    names: 'mttr|mean time to (?:resolve|resolution|recover\\w*)',
    title: 'MTTR',
    text: 'MTTR is mean time to resolve: the average time from an incident opening to it being resolved. A falling MTTR means problems are being fixed faster. MTTA is the same idea for how long it takes someone to acknowledge.',
    example: 'Three incidents were fixed in 20, 40 and 60 minutes, so MTTR is 40 minutes.',
    ask: 'Ask “What is our MTTR this week?” to see it for your workspace',
  },
  {
    names: 'mtta|mean time to ack\\w*',
    title: 'MTTA',
    text: 'MTTA is mean time to acknowledge: the average time from an incident opening to someone acknowledging it. It shows how quickly the team reacts when paged.',
    example: 'Incidents were acknowledged after 2, 4 and 6 minutes, so MTTA is 4 minutes.',
    ask: 'Ask “What is our MTTA this week?” to see it for your workspace',
  },
  {
    names: 'urgency|priority|severity',
    title: 'Urgency and priority',
    text: 'Urgency says how fast someone must react: high, medium or low. High urgency pages people right away; low waits for working hours. Priority (such as P1) is a separate label your team uses for business importance.',
    example: 'A checkout outage is high urgency and P1; a typo on an internal page is low.',
    ask: 'Ask “Show high urgency incidents” to see the urgent ones',
  },
];

const ASKING = '(?:what is|what are|what does|what do|whats|define|explain|meaning of)';
const MATCHERS = TERMS.map(
  term =>
    [
      // eslint-disable-next-line security/detect-non-literal-regexp -- built from the fixed TERMS table above, never from input
      new RegExp(
        `^${ASKING}\\s+(?:an?\\s+|the\\s+)?(?:${term.names})(?:\\s+(?:mean|means|stand for))?[\\s?!.]*$`
      ),
      term,
    ] as const
);

/** "What is an incident?", "what does on call mean?": a short definition, an example and where to look it up live. */
export function glossaryAnswer(text: string): string | null {
  const normalized = text.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
  const term = MATCHERS.find(([pattern]) => pattern.test(normalized));
  return term
    ? `## ${term[1].title}\n\n${term[1].text}\n\nExample: ${term[1].example}\n\n${term[1].ask}.`
    : null;
}

export const STARTER_PATTERN =
  /\b(?:i am|i'?m|i m|im) (?:new|a beginner|just starting)\b|\bwhere (?:do|should|can) i (?:start|begin)\b|\bnew here\b|\b(?:get(?:ting)? started|how (?:do|can) i (?:use|get started with) (?:this|you|squire|opsknight|it))\b|^how (?:does|do) this work[\s?!.]*$/;

export const STARTER = [
  '## Getting started',
  'Here are five steps to get comfortable:',
  '1. See what needs attention: ask “What is on fire right now?” or open Incidents.',
  '2. Open one incident and read its title, service, urgency and timeline.',
  '3. Acknowledge it (“acknowledge this” on the incident), so the team knows someone owns it.',
  '4. Find the right person: ask “Who is on call?” or “Who owns Checkout?”.',
  '5. Ask me anything else in plain words, for example “Show my open incidents” or “How do I connect Slack?”. Ask “What is an incident?” for any term you do not know.',
  'I only read your data and propose changes; nothing happens until you confirm.',
].join('\n');

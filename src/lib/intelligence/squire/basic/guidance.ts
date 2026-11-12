/** Curated from OpsKnight's own UI and docs; these are instructions, never claims about live configuration. */
const GUIDES: ReadonlyArray<{ match: RegExp; title: string; answer: string }> = [
  {
    match: /\b(opsknight|platform|product)\b/,
    title: 'OpsKnight',
    answer:
      'OpsKnight brings incident response, alert ingestion, service ownership, on-call schedules, escalation policies, runbooks, postmortems and status pages into one console. Start with Incidents for current work, Services for ownership and integrations, or Schedules for on-call coverage.',
  },
  {
    match: /\b(acknowledge|ack|resolve|incident lifecycle|incident status)\b/,
    title: 'Acknowledge and resolve',
    answer:
      'Open an incident and review its service, impact and assignee. Acknowledge it when a responder takes ownership; acknowledgement does not mean the service recovered. Resolve it after recovery is verified and record what fixed it. The incident page applies your permissions and the normal domain checks. Basic mode does not change incident state.',
  },
  {
    match: /\b(urgency|severity|priority)\b/,
    title: 'Urgency and priority',
    answer:
      'Urgency uses HIGH, MEDIUM and LOW. Priority is a separate classification and can be set by policy. Review the incident’s recorded impact and your organization’s policy before changing either. A high-urgency incident is not proof of a confirmed root cause.',
  },
  {
    match: /\b((create|trigger).*incident|new incident)\b/,
    title: 'Create an incident',
    answer:
      'Open Incidents and choose Create incident. Select the affected service, describe the symptom and impact, and review urgency and ownership. Integrations can also create incidents through the event ingestion API. Basic mode can find existing incidents but does not create or page one.',
  },
  {
    match: /\b(snooze)\b/,
    title: 'Snooze an incident',
    answer:
      'Use Snooze on the incident page, choose a duration and provide a reason. Check impact and your handoff plan first. Snoozing is temporary; it does not verify recovery or resolve the incident.',
  },
  {
    match: /\b(assign|reassign|responder|watcher)\b/,
    title: 'Assignment and responders',
    answer:
      'Use the incident’s assignee and responder controls to review or change who is working on it. The owning team and service escalation policy provide routing context. A watcher follows an incident; watching is not the same as being assigned or on call.',
  },
  {
    match: /\b(on.?call|schedules?|rotations?|overrides?|handoff)\b/,
    title: 'Schedules and overrides',
    answer:
      'Open Schedules to inspect rotation layers, participants, restrictions and the schedule timezone. Use an override for a temporary coverage change and verify the resulting coverage. Being listed on a schedule is different from being the assignee of an incident. Ask “Who is on call for Checkout?” to check live coverage.',
  },
  {
    match: /\b(escalat|paging|page me)\b/,
    title: 'Escalation and paging',
    answer:
      'A service’s escalation policy defines ordered routing steps, targets and delays. Review it on the service and policy pages. Who is on call and who is assigned can differ. Basic mode can read routing context but does not trigger an escalation or send a page.',
  },
  {
    match: /\b(runbook|agent|automation|approval)\b/,
    title: 'Runbooks and automation',
    answer:
      'Open Runbooks to find a reviewed procedure. From an incident, select a recommended runbook and review its preview, inputs and targets. Native permissions, policy checks and approvals still apply before execution. A recommendation or past successful run does not guarantee this run will be safe. Basic mode never runs a command.',
  },
  {
    match: /\b(postmortem|follow.?up|action item)\b/,
    title: 'Postmortems and follow-up work',
    answer:
      'Use Postmortems to capture impact, the factual timeline, contributing factors, resolution and lessons. Give follow-up action items an owner and due date. Ask “Show overdue action items” or “Find checkout postmortems” to inspect recorded work.',
  },
  {
    match: /\b(integration|webhook|dedup|deduplication|alert)\b/,
    title: 'Alert ingestion and deduplication',
    answer:
      'Configure integrations on the affected service. Event ingestion creates or updates incidents according to its event and deduplication contract; repeat trigger events with the same dedup key can attach to an existing incident. Treat incoming alert payloads as evidence to verify. Never paste integration keys into chat.',
  },
  {
    match: /\b(status page|subscriber|customer update)\b/,
    title: 'Status pages',
    answer:
      'Use Status Pages to manage components, incidents, announcements and subscriptions. Review the intended audience before publishing a customer update. Internal incident state and a public status-page update are separate workflows; basic mode does not publish anything.',
  },
  {
    match: /\b(notifications?|email|sms|slack|teams|push)\b/,
    title: 'Notifications',
    answer:
      'Review your notification preferences and the service’s notification settings. Delivery also depends on configured providers and routing. An incident existing in the console is not proof that a message was delivered. Check the notification delivery records when diagnosing a missed page.',
  },
  {
    match: /\b(similar|match score|correlation|root cause|intelligence)\b/,
    title: 'Intelligence findings',
    answer:
      'The incident Intelligence panel shows similar incidents, related incidents, possible changes and runbook suggestions. Match percentages rank similarity; they are not probabilities. Timing and topology produce cause leads, not confirmed diagnoses. Check the freshness notice and recorded evidence before acting.',
  },
  {
    match: /\b(history|retention|private|privacy|saved chat)\b/,
    title: 'Saved chats',
    answer:
      'Use Saved conversations to read your own unexpired chats. The default retention is 90 days after the last message; an administrator can configure or disable history. Reading does not extend retention. Reopening checks source access again. Edit and Regenerate create a new saved version without overwriting existing saved chats.',
  },
  {
    match: /\b(squire|basic mode|without ai|non.?ai|ai|provider|quota|budget|language model)\b/,
    title: 'Basic mode and AI',
    answer:
      'Basic mode uses fixed intent rules and fresh permission-checked OpsKnight reads. It can look up work, calculate bounded summaries and explain product workflows without a model. It cannot inspect external logs or metrics, invent a root cause or carry out actions. For AI, an administrator can use Settings → Intelligence → Assistant & AI, enable AI, and configure a provider and model eligible for the required data class. Rate limits and token budgets can make it fall back to basic mode. AI adds free-form reasoning and confirmed action proposals.',
  },
  {
    match: /\b(api key|mcp|access token)\b/,
    title: 'API keys and MCP',
    answer:
      'Manage API keys under Settings → API keys and follow the MCP setup guide for agent access. Keep tokens secret, grant only needed permissions and revoke unused keys. Chat answers and evidence do not grant permission to execute an action.',
  },
  {
    match: /\b(sso|oidc|scim|login|sign.?in|password)\b/,
    title: 'Identity and access',
    answer:
      'Administrators configure authentication and identity in Settings → System. OIDC handles sign-in; SCIM provisions and deprovisions users and groups. Review mapped roles and teams, then test sign-in before enforcing SSO. Never paste passwords or recovery credentials into chat.',
  },
  {
    match: /\b(timezone|time zone)\b/,
    title: 'Timezones',
    answer:
      'Review your profile timezone and each schedule’s timezone. They can differ. Basic-mode “today”, “yesterday”, “this week” and “this month” use your configured profile timezone; answers label their reporting window.',
  },
  {
    match: /\b(permission|access|role|rbac|team)\b/,
    title: 'Permissions and teams',
    answer:
      'Roles and team membership control which incidents, services, schedules and runbooks you can read or change. Ask an administrator to review access. An empty search covers only your visible data and does not establish that an item does not exist elsewhere.',
  },
];
export function productGuidance(message: string): string {
  const match = GUIDES.find(guide => guide.match.test(message.toLowerCase()));
  return match
    ? `## ${match.title}\n\n${match.answer}\n\nThis explains the product workflow; it does not verify your current configuration or execute a change.`
    : 'I can explain incident lifecycle, urgency and priority, schedules and overrides, escalation policies, runbooks, postmortems, integrations, notifications, status pages, saved chats, identity and permissions. Ask a specific question such as “How do schedule overrides work?”';
}

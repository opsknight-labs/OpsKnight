/**
 * Words people use for an operation that its id, tool, domain and summary do not contain
 * ("open incidents", "error budget", "my shifts"). Search only: not reviewed, not hashed and
 * never an authorization input. Each key must be a catalog operation id (a test checks this).
 */
export const MCP_SEARCH_KEYWORDS = new Map<string, readonly string[]>([
  ['listIncidents', ['open', 'active', 'unresolved', 'triage', 'firing', 'outage']],
  ['getIncident', ['details', 'status']],
  ['getIncidentTimeline', ['history', 'events', 'happened']],
  ['acknowledgeIncident', ['ack', 'claim']],
  ['resolveIncident', ['close', 'fixed']],
  ['addIncidentNote', ['comment', 'update']],
  ['createIncident', ['raise', 'declare', 'trigger', 'new']],
  ['listServiceObjectives', ['slo', 'sla', 'error budget', 'reliability', 'breach', 'at risk']],
  ['getServiceObjectiveAlertPolicy', ['burn rate', 'burn alert']],
  ['getServiceSlaPolicy', ['sla', 'target', 'response time', 'resolve time']],
  [
    'listServiceChangeEvents',
    ['change', 'changed', 'recent changes', 'what changed', 'edited', 'config'],
  ],
  ['getService', ['owner', 'owns', 'owning team', 'who owns', 'team']],
  ['getServiceSupportHours', ['support hours', 'business hours', 'after hours']],
  [
    'listMaintenanceWindows',
    ['maintenance', 'downtime', 'planned', 'silence', 'mute', 'suppress', 'change window'],
  ],
  [
    'createMaintenanceWindow',
    ['schedule maintenance', 'downtime', 'silence', 'mute', 'suppress', 'change window'],
  ],
  ['endMaintenanceWindow', ['end maintenance', 'unmute', 'unsilence', 'resume paging']],
  [
    'listMaintenanceSchedules',
    ['recurring maintenance', 'maintenance schedule', 'weekly downtime', 'repeating', 'recurring'],
  ],
  [
    'createMaintenanceSchedule',
    ['recurring maintenance', 'every week', 'every night', 'repeat downtime', 'recurring'],
  ],
  [
    'listStatusPageAnnouncements',
    ['announcement', 'maintenance', 'customer update', 'public update'],
  ],
  [
    'endStatusPageAnnouncement',
    ['end announcement', 'close announcement', 'take down notice', 'remove public update'],
  ],
  ['getScheduleOnCall', ['shift', 'oncall', 'page', 'rota', 'now']],
  ['listSchedules', ['rota', 'rotation', 'oncall']],
  ['getEscalationPolicy', ['paged', 'escalate', 'notified']],
  ['getServiceHealthSummary', ['healthy', 'status', 'down']],
  ['executeRunbook', ['run', 'execute']],
  ['listRunbooks', ['remediation', 'playbook']],
  ['listTeams', ['team']],
  ['listMyOnCallShifts', ['me', 'my', 'shift', 'when', 'handoff', 'oncall', 'rota']],
  ['getMyCatchUp', ['catch up', 'missed', 'what happened', 'on fire', 'overnight']],
  ['getOnCallNow', ['who is on call', 'on call now', 'covering', 'my team', 'gap', 'next on call']],
  [
    'listSimilarIncidents',
    ['similar', 'seen before', 'happened before', 'last time', 'what fixed', 'precedent'],
  ],
  ['listUsers', ['people', 'person', 'directory', 'colleague']],
  ['listAuditLogs', ['audit', 'who changed', 'trail', 'history']],
  ['getIntegrationDiagnostics', ['health', 'failing', 'deliveries', 'webhook']],
  ['createBusinessService', ['new business service', 'add product', 'catalog']],
  ['updateBusinessService', ['change owner', 'add member', 'edit business service', 'tier']],
  [
    'markIncidentBusinessServiceImpact',
    ['customer impact', 'affects', 'business impact', 'declare impact'],
  ],
  ['unmarkIncidentBusinessServiceImpact', ['not affected', 'remove impact', 'false impact']],
  ['createBusinessServiceCustomerReport', ['support tickets', 'customer reports', 'complaints']],
  ['notifyIncidentStakeholders', ['stakeholders', 'tell leadership', 'business update']],
  ['listBusinessServiceChanges', ['deploys', 'releases', 'rollout']],
  ['getBusinessServiceSlaReport', ['monthly report', 'uptime report', 'attainment']],
  ['getBusinessServiceScorecard', ['scorecard', 'maturity', 'level', 'readiness']],
]);

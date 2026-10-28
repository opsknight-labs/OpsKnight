import type { NextRequest } from 'next/server';

type Handler = {
  invoke(
    request: NextRequest,
    context: { params: Promise<Record<string, string>> }
  ): Promise<Response>;
}['invoke'];

// Static imports: a client cannot select a module or a URL.
export const MCP_HANDLERS = new Map<string, () => Promise<Handler>>([
  [
    'getTeamMember',
    async () => (await import('@/app/api/v2/teams/[id]/members/[userId]/route')).GET,
  ],
  [
    'getScheduleParticipant',
    async () =>
      (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route'))
        .GET,
  ],
  [
    'getScheduleOverride',
    async () => (await import('@/app/api/v2/schedules/[id]/overrides/[overrideId]/route')).GET,
  ],
  [
    'getPostmortemActionItem',
    async () => (await import('@/app/api/v2/postmortems/[id]/action-items/[itemId]/route')).GET,
  ],
  [
    'getIncidentWatcher',
    async () => (await import('@/app/api/v2/incidents/[id]/watchers/[watcherId]/route')).GET,
  ],
  [
    'getStatusPageAsset',
    async () => (await import('@/app/api/v2/status-pages/[id]/assets/[assetId]/route')).GET,
  ],
  ['listTeamServices', async () => (await import('@/app/api/v2/teams/[id]/services/route')).GET],
  ['listTeamMembers', async () => (await import('@/app/api/v2/teams/[id]/members/route')).GET],
  ['getTeamLead', async () => (await import('@/app/api/v2/teams/[id]/lead/route')).GET],
  [
    'listRunbookExecutions',
    async () => (await import('@/app/api/v2/runbooks/executions/route')).GET,
  ],
  [
    'listStatusPageServices',
    async () => (await import('@/app/api/v2/status-pages/[id]/services/route')).GET,
  ],
  [
    'listServiceRunbookRules',
    async () => (await import('@/app/api/v2/services/[id]/runbook-rules/route')).GET,
  ],
  [
    'getServiceRunbookRule',
    async () => (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/route')).GET,
  ],
  [
    'getRunbookMetadata',
    async () => (await import('@/app/api/v2/runbooks/[id]/metadata/route')).GET,
  ],
  [
    'validateAutomation',
    async () => (await import('@/app/api/v2/services/[id]/automation/validate/route')).POST,
  ],
  [
    'simulateAutomation',
    async () => (await import('@/app/api/v2/services/[id]/automation/simulate/route')).POST,
  ],
  [
    'listAutomationDecisions',
    async () => (await import('@/app/api/v2/services/[id]/automation/decisions/route')).GET,
  ],
  [
    'listAutomationVersions',
    async () => (await import('@/app/api/v2/services/[id]/automation/versions/route')).GET,
  ],
  [
    'getAutomationVersion',
    async () =>
      (await import('@/app/api/v2/services/[id]/automation/versions/[versionId]/route')).GET,
  ],
  [
    'getServiceAutomation',
    async () => (await import('@/app/api/v2/services/[id]/automation/route')).GET,
  ],
  [
    'getAutomationDraft',
    async () => (await import('@/app/api/v2/services/[id]/automation/draft/route')).GET,
  ],
  ['listIncidentTags', async () => (await import('@/app/api/v2/incidents/[id]/tags/route')).GET],
  [
    'listIncidentCustomFields',
    async () => (await import('@/app/api/v2/incidents/[id]/custom-fields/route')).GET,
  ],
  ['addIncidentTag', async () => (await import('@/app/api/v2/incidents/[id]/tags/route')).POST],
  [
    'removeIncidentTag',
    async () => (await import('@/app/api/v2/incidents/[id]/tags/[tagId]/route')).DELETE,
  ],
  [
    'getIncidentRoutingDecision',
    async () => (await import('@/app/api/v2/incidents/[id]/routing-decision/route')).GET,
  ],
  [
    'setIncidentWatcher',
    async () => (await import('@/app/api/v2/incidents/[id]/watchers/route')).POST,
  ],
  [
    'previewRunbookExecution',
    async () => (await import('@/app/api/v2/runbooks/[id]/executions/preview/route')).POST,
  ],
  [
    'listRunbookVersions',
    async () => (await import('@/app/api/v2/runbooks/[id]/versions/route')).GET,
  ],
  [
    'validateRunbookDraft',
    async () => (await import('@/app/api/v2/runbooks/[id]/drafts/[versionId]/validate/route')).POST,
  ],
  [
    'getEscalationPolicy',
    async () => (await import('@/app/api/v2/escalation-policies/[id]/route')).GET,
  ],
  [
    'getEscalationPolicyDependencies',
    async () => (await import('@/app/api/v2/escalation-policies/[id]/dependencies/route')).GET,
  ],
  [
    'listScheduleLayers',
    async () => (await import('@/app/api/v2/schedules/[id]/layers/route')).GET,
  ],
  [
    'getScheduleLayer',
    async () => (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/route')).GET,
  ],
  [
    'previewScheduleCoverage',
    async () => (await import('@/app/api/v2/schedules/[id]/coverage/preview/route')).POST,
  ],
  [
    'listEscalationPolicies',
    async () => (await import('@/app/api/v2/escalation-policies/route')).GET,
  ],
  [
    'acknowledgeIncident',
    async () => (await import('@/app/api/v2/incidents/[id]/acknowledge/route')).POST,
  ],
  ['assignIncident', async () => (await import('@/app/api/v2/incidents/[id]/assign/route')).POST],
  ['listIncidentNotes', async () => (await import('@/app/api/v2/incidents/[id]/notes/route')).GET],
  ['addIncidentNote', async () => (await import('@/app/api/v2/incidents/[id]/notes/route')).POST],
  ['resolveIncident', async () => (await import('@/app/api/v2/incidents/[id]/resolve/route')).POST],
  ['getIncident', async () => (await import('@/app/api/v2/incidents/[id]/route')).GET],
  [
    'getIncidentTimeline',
    async () => (await import('@/app/api/v2/incidents/[id]/timeline/route')).GET,
  ],
  ['listIncidents', async () => (await import('@/app/api/v2/incidents/route')).GET],
  // Reviewed side-effect-free POST reads (validation and bounded queries).
  ['queryReportMetrics', async () => (await import('@/app/api/v2/reports/query/route')).POST],
  [
    'validateIntegrationConfiguration',
    async () => (await import('@/app/api/v2/integrations/[id]/validate/route')).POST,
  ],
  [
    'validateIntegrationPayload',
    async () => (await import('@/app/api/v2/integrations/[id]/test/route')).POST,
  ],
  [
    'validateServiceRunbookRule',
    async () =>
      (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/validate/route')).POST,
  ],
  ['createIncident', async () => (await import('@/app/api/v2/incidents/route')).POST],
  [
    'getIncidentResponseActivity',
    async () => (await import('@/app/api/v2/incidents/[id]/response-activity/route')).GET,
  ],
  [
    'listIncidentRunbookExecutions',
    async () => (await import('@/app/api/v2/incidents/[id]/runbook-executions/route')).GET,
  ],
  [
    'getIncidentAvailableActions',
    async () => (await import('@/app/api/v2/incidents/[id]/available-actions/route')).GET,
  ],
  [
    'listRelatedIncidents',
    async () => (await import('@/app/api/v2/incidents/[id]/related-incidents/route')).GET,
  ],
  [
    'previewEscalationPolicy',
    async () => (await import('@/app/api/v2/escalation-policies/[id]/preview/route')).POST,
  ],
  [
    'getServiceHealthSummary',
    async () => (await import('@/app/api/v2/services/[id]/health-summary/route')).GET,
  ],
  ['getPostmortem', async () => (await import('@/app/api/v2/postmortems/[id]/route')).GET],
  [
    'listPostmortemVersions',
    async () => (await import('@/app/api/v2/postmortems/[id]/versions/route')).GET,
  ],
  [
    'listPostmortemContributors',
    async () => (await import('@/app/api/v2/postmortems/[id]/contributors/route')).GET,
  ],
  [
    'listPostmortemActionItems',
    async () => (await import('@/app/api/v2/postmortems/[id]/action-items/route')).GET,
  ],
  ['listPostmortems', async () => (await import('@/app/api/v2/postmortems/route')).GET],
  ['getReportCatalog', async () => (await import('@/app/api/v2/reports/catalog/route')).GET],
  ['listSavedReports', async () => (await import('@/app/api/v2/reports/saved/route')).GET],
  ['getSavedReport', async () => (await import('@/app/api/v2/reports/saved/[id]/route')).GET],
  ['getRunbook', async () => (await import('@/app/api/v2/runbooks/[id]/route')).GET],
  [
    'getRunbookExecution',
    async () => (await import('@/app/api/v2/runbooks/executions/[id]/route')).GET,
  ],
  ['listRunbooks', async () => (await import('@/app/api/v2/runbooks/route')).GET],
  [
    'getScheduleOnCall',
    async () => (await import('@/app/api/v2/schedules/[id]/on-call/route')).GET,
  ],
  [
    'listScheduleOverrides',
    async () => (await import('@/app/api/v2/schedules/[id]/overrides/route')).GET,
  ],
  [
    'getScheduleCoverage',
    async () => (await import('@/app/api/v2/schedules/[id]/coverage/route')).GET,
  ],
  ['getSchedule', async () => (await import('@/app/api/v2/schedules/[id]/route')).GET],
  ['listSchedules', async () => (await import('@/app/api/v2/schedules/route')).GET],
  ['getService', async () => (await import('@/app/api/v2/services/[id]/route')).GET],
  [
    'getServiceSupportHours',
    async () => (await import('@/app/api/v2/services/[id]/support-hours/route')).GET,
  ],
  [
    'getServiceClassificationPolicy',
    async () =>
      (await import('@/app/api/v2/services/[id]/response-policy/classification/route')).GET,
  ],
  [
    'getServiceSlaPolicy',
    async () => (await import('@/app/api/v2/services/[id]/response-policy/sla/route')).GET,
  ],
  ['listServices', async () => (await import('@/app/api/v2/services/route')).GET],
  [
    'listStatusPageAnnouncements',
    async () => (await import('@/app/api/v2/status-pages/[id]/announcements/route')).GET,
  ],
  ['getStatusPage', async () => (await import('@/app/api/v2/status-pages/[id]/route')).GET],
  ['listStatusPages', async () => (await import('@/app/api/v2/status-pages/route')).GET],
  ['getTeam', async () => (await import('@/app/api/v2/teams/[id]/route')).GET],
  ['listTeams', async () => (await import('@/app/api/v2/teams/route')).GET],
  [
    'getCustomFieldDefinition',
    async () => (await import('@/app/api/v2/custom-fields/[id]/route')).GET,
  ],
  [
    'listCustomFieldDefinitions',
    async () => (await import('@/app/api/v2/custom-fields/route')).GET,
  ],
  ['getReportDashboard', async () => (await import('@/app/api/v2/dashboards/[id]/route')).GET],
  [
    'getReportDashboardData',
    async () => (await import('@/app/api/v2/dashboards/[id]/data/route')).GET,
  ],
  [
    'listReportDashboardWidgets',
    async () => (await import('@/app/api/v2/dashboards/[id]/widgets/route')).GET,
  ],
  ['listReportDashboards', async () => (await import('@/app/api/v2/dashboards/route')).GET],
  [
    'validateEscalationPolicy',
    async () => (await import('@/app/api/v2/escalation-policies/[id]/validation/route')).GET,
  ],
  [
    'getIncidentCustomField',
    async () => (await import('@/app/api/v2/incidents/[id]/custom-fields/[fieldId]/route')).GET,
  ],
  [
    'getIncidentTemplate',
    async () => (await import('@/app/api/v2/incidents/templates/[templateId]/route')).GET,
  ],
  [
    'listIncidentAlerts',
    async () => (await import('@/app/api/v2/incidents/[id]/alerts/route')).GET,
  ],
  [
    'listIncidentNotificationAttempts',
    async () => (await import('@/app/api/v2/incidents/[id]/notification-attempts/route')).GET,
  ],
  [
    'listIncidentTemplates',
    async () => (await import('@/app/api/v2/incidents/templates/route')).GET,
  ],
  [
    'listIncidentWarRooms',
    async () => (await import('@/app/api/v2/incidents/[id]/war-rooms/route')).GET,
  ],
  [
    'listIncidentWatchers',
    async () => (await import('@/app/api/v2/incidents/[id]/watchers/route')).GET,
  ],
  [
    'getIntegrationUsage',
    async () => (await import('@/app/api/v2/integrations/[id]/usage/route')).GET,
  ],
  ['listIntegrationTypes', async () => (await import('@/app/api/v2/integrations/types/route')).GET],
  ['listIntegrations', async () => (await import('@/app/api/v2/integrations/route')).GET],
  [
    'getNotificationFeedback',
    async () => (await import('@/app/api/v2/notifications/[id]/feedback/route')).GET,
  ],
  [
    'listNotificationAttempts',
    async () => (await import('@/app/api/v2/notifications/[id]/attempts/route')).GET,
  ],
  ['listNotifications', async () => (await import('@/app/api/v2/notifications/route')).GET],
  [
    'listOperationalEvents',
    async () => (await import('@/app/api/v2/operational-events/route')).GET,
  ],
  ['getMetricsReport', async () => (await import('@/app/api/v2/reports/metrics/route')).GET],
  [
    'checkRunbookDeletion',
    async () => (await import('@/app/api/v2/runbooks/[id]/delete-check/route')).GET,
  ],
  [
    'compareRunbookVersions',
    async () => (await import('@/app/api/v2/runbooks/[id]/versions/[versionId]/diff/route')).GET,
  ],
  [
    'getRunbookDraft',
    async () => (await import('@/app/api/v2/runbooks/[id]/drafts/[versionId]/route')).GET,
  ],
  [
    'listRunbookExecutionEvents',
    async () => (await import('@/app/api/v2/runbooks/executions/[id]/events/route')).GET,
  ],
  [
    'listRunbookExecutionEvidence',
    async () => (await import('@/app/api/v2/runbooks/executions/[id]/evidence/route')).GET,
  ],
  [
    'listRunbookExecutionSteps',
    async () => (await import('@/app/api/v2/runbooks/executions/[id]/steps/route')).GET,
  ],
  [
    'getScheduleDependencies',
    async () => (await import('@/app/api/v2/schedules/[id]/dependencies/route')).GET,
  ],
  [
    'listScheduleChanges',
    async () => (await import('@/app/api/v2/schedules/[id]/changes/route')).GET,
  ],
  [
    'getServiceObjective',
    async () => (await import('@/app/api/v2/service-objectives/[id]/route')).GET,
  ],
  [
    'getServiceObjectiveCatalog',
    async () => (await import('@/app/api/v2/service-objectives/catalog/route')).GET,
  ],
  [
    'getServiceObjectiveEvaluation',
    async () =>
      (await import('@/app/api/v2/service-objectives/[id]/evaluations/[evaluationId]/route')).GET,
  ],
  [
    'getServiceObjectiveHistory',
    async () => (await import('@/app/api/v2/service-objectives/[id]/history/route')).GET,
  ],
  [
    'listServiceObjectiveSnapshots',
    async () => (await import('@/app/api/v2/service-objectives/[id]/snapshots/route')).GET,
  ],
  [
    'listServiceObjectiveVersions',
    async () => (await import('@/app/api/v2/service-objectives/[id]/versions/route')).GET,
  ],
  [
    'listServiceObjectives',
    async () => (await import('@/app/api/v2/service-objectives/route')).GET,
  ],
  [
    'getAutomationCandidate',
    async () => (await import('@/app/api/v2/services/[id]/automation/candidate/route')).GET,
  ],
  [
    'getServiceNotificationSettings',
    async () => (await import('@/app/api/v2/services/[id]/notification-settings/route')).GET,
  ],
  [
    'listAutomationObservations',
    async () => (await import('@/app/api/v2/services/[id]/automation/observations/route')).GET,
  ],
  [
    'listRunbookRulePolicyChecks',
    async () =>
      (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/policy-checks/route')).GET,
  ],
  [
    'listServiceChangeEvents',
    async () => (await import('@/app/api/v2/services/[id]/change-events/route')).GET,
  ],
  [
    'getAutomationSettings',
    async () => (await import('@/app/api/v2/settings/automation/route')).GET,
  ],
  ['getRunbookSettings', async () => (await import('@/app/api/v2/settings/runbooks/route')).GET],
  [
    'getWorkspaceSlaPolicy',
    async () => (await import('@/app/api/v2/settings/incident-sla/route')).GET,
  ],
  [
    'getStatusPageAppearance',
    async () => (await import('@/app/api/v2/status-pages/[id]/appearance/route')).GET,
  ],
  [
    'getStatusPageContent',
    async () => (await import('@/app/api/v2/status-pages/[id]/content/route')).GET,
  ],
  [
    'getStatusPagePublication',
    async () => (await import('@/app/api/v2/status-pages/[id]/publication/route')).GET,
  ],
  [
    'getStatusPagePublicationJob',
    async () => (await import('@/app/api/v2/status-pages/[id]/publication/jobs/[jobId]/route')).GET,
  ],
  [
    'getStatusPageSettings',
    async () => (await import('@/app/api/v2/status-pages/[id]/settings/route')).GET,
  ],
  [
    'getStatusPageSubscriberStats',
    async () => (await import('@/app/api/v2/status-pages/[id]/subscriber-stats/route')).GET,
  ],
  [
    'getStatusPageSubscriptionSettings',
    async () => (await import('@/app/api/v2/status-pages/[id]/subscription-settings/route')).GET,
  ],
  [
    'listStatusPageAssets',
    async () => (await import('@/app/api/v2/status-pages/[id]/assets/route')).GET,
  ],
  [
    'previewStatusPage',
    async () => (await import('@/app/api/v2/status-pages/[id]/preview/route')).GET,
  ],
  ['listTeamActivity', async () => (await import('@/app/api/v2/teams/[id]/activity/route')).GET],
]);

// Reachable only from the frozen approval commit; never from generic dispatch.
export const MCP_APPROVAL_HANDLERS = new Map<string, () => Promise<Handler>>([
  [
    'removeTeamMember',
    async () => (await import('@/app/api/v2/teams/[id]/members/[userId]/route')).DELETE,
  ],
  [
    'removeScheduleParticipant',
    async () =>
      (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route'))
        .DELETE,
  ],
  [
    'cancelScheduleOverride',
    async () => (await import('@/app/api/v2/schedules/[id]/overrides/[overrideId]/route')).DELETE,
  ],
  [
    'deletePostmortemActionItem',
    async () => (await import('@/app/api/v2/postmortems/[id]/action-items/[itemId]/route')).DELETE,
  ],
  [
    'removeIncidentWatcher',
    async () => (await import('@/app/api/v2/incidents/[id]/watchers/[watcherId]/route')).DELETE,
  ],
  [
    'deleteStatusPageAsset',
    async () => (await import('@/app/api/v2/status-pages/[id]/assets/[assetId]/route')).DELETE,
  ],
  [
    'createScheduleOverride',
    async () => (await import('@/app/api/v2/schedules/[id]/overrides/route')).POST,
  ],
  ['createStatusPage', async () => (await import('@/app/api/v2/status-pages/route')).POST],
  [
    'retryNotification',
    async () => (await import('@/app/api/v2/notifications/[id]/retry/route')).POST,
  ],
  ['setTeamLead', async () => (await import('@/app/api/v2/teams/[id]/lead/route')).PUT],
  [
    'updateServiceSupportHours',
    async () => (await import('@/app/api/v2/services/[id]/support-hours/route')).PUT,
  ],
  [
    'createStatusPageAnnouncement',
    async () => (await import('@/app/api/v2/status-pages/[id]/announcements/route')).POST,
  ],
  [
    'setTeamMember',
    async () => (await import('@/app/api/v2/teams/[id]/members/[userId]/route')).PUT,
  ],
  [
    'assignTeamService',
    async () => (await import('@/app/api/v2/teams/[id]/services/[serviceId]/route')).PUT,
  ],
  [
    'updateServiceSlaPolicy',
    async () => (await import('@/app/api/v2/services/[id]/response-policy/sla/route')).PUT,
  ],
  [
    'updateServiceClassificationPolicy',
    async () =>
      (await import('@/app/api/v2/services/[id]/response-policy/classification/route')).PUT,
  ],
  [
    'saveAutomationDraft',
    async () => (await import('@/app/api/v2/services/[id]/automation/draft/route')).PUT,
  ],
  [
    'publishAutomationVersion',
    async () => (await import('@/app/api/v2/services/[id]/automation/publish/route')).POST,
  ],
  [
    'restoreAutomationDraft',
    async () => (await import('@/app/api/v2/services/[id]/automation/restore/route')).POST,
  ],
  [
    'updateServiceAutomationMode',
    async () => (await import('@/app/api/v2/services/[id]/automation/mode/route')).PATCH,
  ],
  [
    'createServiceRunbookRule',
    async () => (await import('@/app/api/v2/services/[id]/runbook-rules/route')).POST,
  ],
  [
    'updateServiceRunbookRule',
    async () => (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/route')).PATCH,
  ],
  [
    'pauseServiceRunbookRule',
    async () =>
      (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/pause/route')).POST,
  ],
  [
    'activateServiceRunbookRule',
    async () =>
      (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/activate/route')).POST,
  ],
  [
    'updateCustomFieldDefinition',
    async () => (await import('@/app/api/v2/custom-fields/[id]/route')).PATCH,
  ],
  [
    'createCustomFieldDefinition',
    async () => (await import('@/app/api/v2/custom-fields/route')).POST,
  ],
  ['updateReportDashboard', async () => (await import('@/app/api/v2/dashboards/[id]/route')).PATCH],
  ['createReportDashboard', async () => (await import('@/app/api/v2/dashboards/route')).POST],
  [
    'duplicateReportDashboard',
    async () => (await import('@/app/api/v2/dashboards/[id]/duplicate/route')).POST,
  ],
  [
    'replaceReportDashboardWidgets',
    async () => (await import('@/app/api/v2/dashboards/[id]/widgets/route')).PUT,
  ],
  [
    'updateIncidentTemplate',
    async () => (await import('@/app/api/v2/incidents/templates/[templateId]/route')).PATCH,
  ],
  ['updateIncident', async () => (await import('@/app/api/v2/incidents/[id]/route')).PATCH],
  [
    'createIncidentTemplate',
    async () => (await import('@/app/api/v2/incidents/templates/route')).POST,
  ],
  ['reopenIncident', async () => (await import('@/app/api/v2/incidents/[id]/reopen/route')).POST],
  ['snoozeIncident', async () => (await import('@/app/api/v2/incidents/[id]/snooze/route')).POST],
  [
    'suppressIncident',
    async () => (await import('@/app/api/v2/incidents/[id]/suppress/route')).POST,
  ],
  [
    'unacknowledgeIncident',
    async () => (await import('@/app/api/v2/incidents/[id]/unacknowledge/route')).POST,
  ],
  [
    'unsnoozeIncident',
    async () => (await import('@/app/api/v2/incidents/[id]/unsnooze/route')).POST,
  ],
  [
    'unsuppressIncident',
    async () => (await import('@/app/api/v2/incidents/[id]/unsuppress/route')).POST,
  ],
  [
    'setIncidentCustomField',
    async () => (await import('@/app/api/v2/incidents/[id]/custom-fields/[fieldId]/route')).PUT,
  ],
  ['updatePostmortem', async () => (await import('@/app/api/v2/postmortems/[id]/route')).PATCH],
  [
    'updatePostmortemActionItem',
    async () => (await import('@/app/api/v2/postmortems/[id]/action-items/[itemId]/route')).PATCH,
  ],
  ['createPostmortem', async () => (await import('@/app/api/v2/postmortems/route')).POST],
  [
    'publishPostmortem',
    async () => (await import('@/app/api/v2/postmortems/[id]/publish/route')).POST,
  ],
  [
    'replacePostmortemActionItems',
    async () => (await import('@/app/api/v2/postmortems/[id]/action-items/route')).PUT,
  ],
  [
    'replacePostmortemContributors',
    async () => (await import('@/app/api/v2/postmortems/[id]/contributors/route')).PUT,
  ],
  ['updateSavedReport', async () => (await import('@/app/api/v2/reports/saved/[id]/route')).PATCH],
  ['createSavedReport', async () => (await import('@/app/api/v2/reports/saved/route')).POST],
  ['updateRunbookMetadata', async () => (await import('@/app/api/v2/runbooks/[id]/route')).PATCH],
  [
    'updateRunbookDraft',
    async () => (await import('@/app/api/v2/runbooks/[id]/drafts/[versionId]/route')).PATCH,
  ],
  ['createRunbook', async () => (await import('@/app/api/v2/runbooks/route')).POST],
  [
    'cancelRunbookExecution',
    async () => (await import('@/app/api/v2/runbooks/executions/[id]/cancel/route')).POST,
  ],
  [
    'rerunRunbookExecution',
    async () => (await import('@/app/api/v2/runbooks/executions/[id]/rerun/route')).POST,
  ],
  [
    'approveRunbookExecutionStep',
    async () =>
      (await import('@/app/api/v2/runbooks/executions/[id]/steps/[stepId]/approve/route')).POST,
  ],
  [
    'rejectRunbookExecutionStep',
    async () =>
      (await import('@/app/api/v2/runbooks/executions/[id]/steps/[stepId]/reject/route')).POST,
  ],
  ['archiveRunbook', async () => (await import('@/app/api/v2/runbooks/[id]/archive/route')).POST],
  [
    'createRunbookDraft',
    async () => (await import('@/app/api/v2/runbooks/[id]/drafts/route')).POST,
  ],
  [
    'publishRunbookDraft',
    async () => (await import('@/app/api/v2/runbooks/[id]/drafts/[versionId]/publish/route')).POST,
  ],
  [
    'duplicateRunbook',
    async () => (await import('@/app/api/v2/runbooks/[id]/duplicate/route')).POST,
  ],
  ['restoreRunbook', async () => (await import('@/app/api/v2/runbooks/[id]/restore/route')).POST],
  [
    'updateScheduleLayer',
    async () => (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/route')).PATCH,
  ],
  [
    'moveScheduleParticipant',
    async () =>
      (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route'))
        .PATCH,
  ],
  ['createSchedule', async () => (await import('@/app/api/v2/schedules/route')).POST],
  [
    'createScheduleLayer',
    async () => (await import('@/app/api/v2/schedules/[id]/layers/route')).POST,
  ],
  [
    'addScheduleParticipant',
    async () =>
      (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/participants/route')).POST,
  ],
  [
    'reorderScheduleLayers',
    async () => (await import('@/app/api/v2/schedules/[id]/layers/order/route')).PUT,
  ],
  [
    'updateServiceObjective',
    async () => (await import('@/app/api/v2/service-objectives/[id]/route')).PATCH,
  ],
  [
    'createServiceObjective',
    async () => (await import('@/app/api/v2/service-objectives/route')).POST,
  ],
  [
    'archiveServiceObjective',
    async () => (await import('@/app/api/v2/service-objectives/[id]/archive/route')).POST,
  ],
  [
    'evaluateServiceObjective',
    async () => (await import('@/app/api/v2/service-objectives/[id]/evaluate/route')).POST,
  ],
  [
    'updateServiceNotificationSettings',
    async () => (await import('@/app/api/v2/services/[id]/notification-settings/route')).PATCH,
  ],
  ['createService', async () => (await import('@/app/api/v2/services/route')).POST],
  [
    'activateAutomationCandidate',
    async () =>
      (await import('@/app/api/v2/services/[id]/automation/candidates/activate/route')).POST,
  ],
  [
    'duplicateServiceRunbookRule',
    async () =>
      (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/duplicate/route')).POST,
  ],
  [
    'requestRunbookRulePolicyChecks',
    async () =>
      (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/policy-checks/route')).POST,
  ],
  [
    'replaceRunbookRuleTriggers',
    async () =>
      (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/triggers/route')).PUT,
  ],
  [
    'updateAutomationSettings',
    async () => (await import('@/app/api/v2/settings/automation/route')).PATCH,
  ],
  [
    'updateRunbookSettings',
    async () => (await import('@/app/api/v2/settings/runbooks/route')).PATCH,
  ],
  [
    'updateChatOpsConfiguration',
    async () => (await import('@/app/api/v2/settings/chatops/route')).PUT,
  ],
  [
    'updateWorkspaceSlaPolicy',
    async () => (await import('@/app/api/v2/settings/incident-sla/route')).PUT,
  ],
  [
    'updateStatusPageAppearance',
    async () => (await import('@/app/api/v2/status-pages/[id]/appearance/route')).PATCH,
  ],
  [
    'updateStatusPageContent',
    async () => (await import('@/app/api/v2/status-pages/[id]/content/route')).PATCH,
  ],
  [
    'updateStatusPageService',
    async () => (await import('@/app/api/v2/status-pages/[id]/services/[serviceId]/route')).PATCH,
  ],
  [
    'updateStatusPageSettings',
    async () => (await import('@/app/api/v2/status-pages/[id]/settings/route')).PATCH,
  ],
  [
    'retryStatusPagePublication',
    async () => (await import('@/app/api/v2/status-pages/[id]/publication/retry/route')).POST,
  ],
  [
    'setStatusPageServices',
    async () => (await import('@/app/api/v2/status-pages/[id]/services/route')).PUT,
  ],
  ['createTeam', async () => (await import('@/app/api/v2/teams/route')).POST],
  [
    'deleteCustomFieldDefinition',
    async () => (await import('@/app/api/v2/custom-fields/[id]/route')).DELETE,
  ],
  [
    'deleteReportDashboard',
    async () => (await import('@/app/api/v2/dashboards/[id]/route')).DELETE,
  ],
  [
    'deleteIncidentTemplate',
    async () => (await import('@/app/api/v2/incidents/templates/[templateId]/route')).DELETE,
  ],
  ['deleteSavedReport', async () => (await import('@/app/api/v2/reports/saved/[id]/route')).DELETE],
  [
    'deleteScheduleLayer',
    async () => (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/route')).DELETE,
  ],
  [
    'detachServiceRunbookRule',
    async () => (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/route')).DELETE,
  ],
  [
    'discardAutomationCandidate',
    async () => (await import('@/app/api/v2/services/[id]/automation/candidate/route')).DELETE,
  ],
  ['deleteIntegration', async () => (await import('@/app/api/v2/integrations/[id]/route')).DELETE],
  [
    'deleteEscalationPolicy',
    async () => (await import('@/app/api/v2/escalation-policies/[id]/route')).DELETE,
  ],
  ['deletePostmortem', async () => (await import('@/app/api/v2/postmortems/[id]/route')).DELETE],
  ['deleteSchedule', async () => (await import('@/app/api/v2/schedules/[id]/route')).DELETE],
  ['deleteService', async () => (await import('@/app/api/v2/services/[id]/route')).DELETE],
  ['deleteTeam', async () => (await import('@/app/api/v2/teams/[id]/route')).DELETE],
  [
    'updateStatusPagePrivacy',
    async () => (await import('@/app/api/v2/status-pages/[id]/privacy/route')).PATCH,
  ],
  [
    'createEscalationPolicy',
    async () => (await import('@/app/api/v2/escalation-policies/route')).POST,
  ],
  [
    'updateEscalationPolicy',
    async () => (await import('@/app/api/v2/escalation-policies/[id]/route')).PATCH,
  ],
  ['updateIntegration', async () => (await import('@/app/api/v2/integrations/[id]/route')).PATCH],
  ['updateSchedule', async () => (await import('@/app/api/v2/schedules/[id]/route')).PATCH],
  ['updateService', async () => (await import('@/app/api/v2/services/[id]/route')).PATCH],
  ['updateTeam', async () => (await import('@/app/api/v2/teams/[id]/route')).PATCH],
]);

// Reads used only as impact previews for destructive approvals; never generic tools.
export const MCP_PREVIEW_HANDLERS = new Map<string, () => Promise<Handler>>([
  [
    'getTeamMember',
    async () => (await import('@/app/api/v2/teams/[id]/members/[userId]/route')).GET,
  ],
  [
    'getScheduleParticipant',
    async () =>
      (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route'))
        .GET,
  ],
  [
    'getScheduleOverride',
    async () => (await import('@/app/api/v2/schedules/[id]/overrides/[overrideId]/route')).GET,
  ],
  [
    'getPostmortemActionItem',
    async () => (await import('@/app/api/v2/postmortems/[id]/action-items/[itemId]/route')).GET,
  ],
  [
    'getIncidentWatcher',
    async () => (await import('@/app/api/v2/incidents/[id]/watchers/[watcherId]/route')).GET,
  ],
  [
    'getStatusPageAsset',
    async () => (await import('@/app/api/v2/status-pages/[id]/assets/[assetId]/route')).GET,
  ],
  [
    'getCustomFieldDefinition',
    async () => (await import('@/app/api/v2/custom-fields/[id]/route')).GET,
  ],
  ['getReportDashboard', async () => (await import('@/app/api/v2/dashboards/[id]/route')).GET],
  [
    'getIncidentTemplate',
    async () => (await import('@/app/api/v2/incidents/templates/[templateId]/route')).GET,
  ],
  ['getSavedReport', async () => (await import('@/app/api/v2/reports/saved/[id]/route')).GET],
  ['getRunbook', async () => (await import('@/app/api/v2/runbooks/[id]/route')).GET],
  [
    'getScheduleLayer',
    async () => (await import('@/app/api/v2/schedules/[id]/layers/[layerId]/route')).GET,
  ],
  [
    'getServiceRunbookRule',
    async () => (await import('@/app/api/v2/services/[id]/runbook-rules/[ruleId]/route')).GET,
  ],
  [
    'getAutomationCandidate',
    async () => (await import('@/app/api/v2/services/[id]/automation/candidate/route')).GET,
  ],
  ['getIntegration', async () => (await import('@/app/api/v2/integrations/[id]/route')).GET],
  [
    'getStatusPagePrivacy',
    async () => (await import('@/app/api/v2/status-pages/[id]/privacy/route')).GET,
  ],
  [
    'getEscalationPolicy',
    async () => (await import('@/app/api/v2/escalation-policies/[id]/route')).GET,
  ],
  ['getPostmortem', async () => (await import('@/app/api/v2/postmortems/[id]/route')).GET],
  ['getSchedule', async () => (await import('@/app/api/v2/schedules/[id]/route')).GET],
  ['getService', async () => (await import('@/app/api/v2/services/[id]/route')).GET],
  ['getTeam', async () => (await import('@/app/api/v2/teams/[id]/route')).GET],
]);

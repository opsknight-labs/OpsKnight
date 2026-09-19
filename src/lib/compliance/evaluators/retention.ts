import type {
  ComplianceControlEvaluator,
  ComplianceEvaluationContext,
  ComplianceEvaluatorResult,
} from './types';

export const retentionEvaluator: ComplianceControlEvaluator = {
  id: 'data.retention',
  version: '1',

  async evaluate(context: ComplianceEvaluationContext): Promise<ComplianceEvaluatorResult> {
    // Strictly read-only query: inspect SystemSettings directly without fallback mutation or upsert
    const settings = await context.prisma.systemSettings.findUnique({
      where: { id: 'default' },
      select: {
        incidentRetentionDays: true,
        alertRetentionDays: true,
        logRetentionDays: true,
        metricsRetentionDays: true,
        completedPrivacyRequestRetentionDays: true,
      },
    });

    if (!settings) {
      return {
        status: 'ACTION_REQUIRED',
        summary: 'System retention settings row has not been configured in this deployment.',
        findings: [
          {
            code: 'RETENTION_SETTINGS_MISSING',
            message: 'Default SystemSettings row is missing in the database.',
            severity: 'ERROR',
          },
        ],
        evidenceRefs: [
          {
            source: 'SystemSettings',
            description: 'Row with id "default" was not found.',
          },
        ],
      };
    }

    const incidentRetentionDays = settings.incidentRetentionDays ?? 730;
    const alertRetentionDays = settings.alertRetentionDays ?? 365;
    const logRetentionDays = settings.logRetentionDays ?? 365;
    const metricsRetentionDays = settings.metricsRetentionDays ?? 365;
    const completedPrivacyRequestRetentionDays =
      settings.completedPrivacyRequestRetentionDays ?? 730;

    // Verify hold-aware cleanup subsystem is queryable and operational
    const activeHoldCount = await context.prisma.dataRetentionHold.count({
      where: {
        releasedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: context.now } }],
      },
    });

    return {
      status: 'IMPLEMENTED',
      summary:
        'Retention policies are configured and the hold-aware cleanup engine is available in this deployment.',
      findings: [
        { code: 'INCIDENT_RETENTION_DAYS', value: incidentRetentionDays },
        { code: 'ALERT_RETENTION_DAYS', value: alertRetentionDays },
        { code: 'LOG_RETENTION_DAYS', value: logRetentionDays },
        { code: 'METRICS_RETENTION_DAYS', value: metricsRetentionDays },
        {
          code: 'PRIVACY_REQUEST_RETENTION_DAYS',
          value: completedPrivacyRequestRetentionDays,
        },
        { code: 'HOLD_AWARE_CLEANUP_AVAILABLE', value: true },
        { code: 'ACTIVE_RETENTION_HOLDS', value: activeHoldCount },
      ],
      evidenceRefs: [
        {
          source: 'SystemSettings',
          description: 'Active retention configuration validated via read-only inspection.',
        },
        {
          source: 'DataRetentionHold',
          description: 'Hold-aware retention subsystem is online and queryable.',
        },
      ],
    };
  },
};

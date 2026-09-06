/**
 * Azure Monitor Integration Handler
 * Transforms Azure Monitor alert webhooks to standard event format
 */

export type AzureAlertData = {
  schemaId?: string;
  data?: {
    essentials?: {
      alertId?: string;
      alertRule?: string;
      severity?: string;
      signalType?: string;
      monitorCondition?: string;
      monitorService?: string;
      firedDateTime?: string;
      description?: string;
    };
    alertContext?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    context?: {
      id?: string;
      name?: string;
      description?: string;
      conditionType?: string;
      condition?: {
        windowSize?: string;
        allOf?: Array<{
          metricName?: string;
          threshold?: number;
        }>;
      };
    };
    properties?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
};

export function transformAzureToEvent(data: AzureAlertData): {
  event_action: 'trigger' | 'resolve';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
} {
  const essentials = data.data?.essentials;
  const context = data.data?.context;

  const alertId = essentials?.alertId || context?.id || 'unknown';
  const alertName = essentials?.alertRule || context?.name || 'Azure Alert';
  const description = essentials?.description || context?.description || '';
  const severity = essentials?.severity || 'Sev3';
  const monitorCondition = essentials?.monitorCondition || 'Fired';

  const isFired = monitorCondition === 'Fired' || monitorCondition === 'Activated';
  const dedupKey = `azure-${alertId}`;

  // Map Azure severity to our severity (case-insensitively)
  const sevLower = (severity || '').toLowerCase();
  let mappedSeverity: 'critical' | 'error' | 'warning' | 'info' = 'info';
  if (sevLower.includes('sev0') || sevLower.includes('critical')) {
    mappedSeverity = 'critical';
  } else if (sevLower.includes('sev1') || sevLower.includes('error')) {
    mappedSeverity = 'error';
  } else if (sevLower.includes('sev2') || sevLower.includes('warning')) {
    mappedSeverity = 'warning';
  } else if (
    sevLower.includes('sev3') ||
    sevLower.includes('sev4') ||
    sevLower.includes('info') ||
    sevLower.includes('verbose')
  ) {
    mappedSeverity = 'info';
  }

  return {
    event_action: isFired ? 'trigger' : 'resolve',
    dedup_key: dedupKey,
    payload: {
      summary: alertName,
      source: `Azure Monitor (${essentials?.monitorService || 'Unknown'})`,
      severity: mappedSeverity,
      custom_details: {
        alertId,
        alertName,
        description,
        severity,
        monitorCondition,
        monitorService: essentials?.monitorService,
        firedDateTime: essentials?.firedDateTime,
        alertContext: data.data?.alertContext,
        context: context,
        properties: data.data?.properties,
      },
    },
  };
}

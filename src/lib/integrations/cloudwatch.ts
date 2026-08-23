/**
 * AWS CloudWatch Integration Handler
 * Transforms CloudWatch alarm webhooks to standard event format
 */

export type CloudWatchAlarmMessage = {
  AlarmName: string;
  AlarmDescription?: string | null;
  AWSAccountId?: string | null;
  NewStateValue: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
  NewStateReason?: string | null;
  StateChangeTime: string;
  Region?: string;
  Trigger?: {
    MetricName?: string;
    Namespace?: string;
    Statistic?: string;
    Threshold?: number;
  } | null;
};

export function transformCloudWatchToEvent(message: CloudWatchAlarmMessage): {
  event_action: 'trigger' | 'resolve';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
} {
  const isOk = message.NewStateValue === 'OK';
  const accountPart = message.AWSAccountId ? `${message.AWSAccountId}-` : '';
  const region = message.Region || 'global';
  const dedupKey = `cloudwatch-${accountPart}${region}-${message.AlarmName}`;

  return {
    event_action: isOk ? 'resolve' : 'trigger',
    dedup_key: dedupKey,
    payload: {
      summary: message.AlarmName,
      source: `AWS CloudWatch (${message.Region})`,
      severity: (() => {
        if (isOk) return 'info';
        if (message.NewStateValue === 'INSUFFICIENT_DATA') return 'warning';
        const desc = (message.AlarmDescription || '').toUpperCase();
        if (desc.includes('CRITICAL') || desc.includes('HIGH')) return 'critical';
        if (desc.includes('WARNING') || desc.includes('MEDIUM') || desc.includes('ERROR'))
          return 'error';
        if (desc.includes('INFO') || desc.includes('LOW')) return 'info';
        return 'critical'; // Default to critical for alarms
      })(),
      custom_details: {
        alarmName: message.AlarmName,
        alarmDescription: message.AlarmDescription,
        state: message.NewStateValue,
        reason: message.NewStateReason,
        region: message.Region,
        trigger: message.Trigger,
        stateChangeTime: message.StateChangeTime,
      },
    },
  };
}

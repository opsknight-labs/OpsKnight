export type ServiceDynamicStatus = 'OPERATIONAL' | 'DEGRADED' | 'CRITICAL';

export function getServiceDynamicStatus({
  activeIncidentCount,
  hasCritical,
}: {
  activeIncidentCount: number;
  hasCritical: boolean;
}): ServiceDynamicStatus {
  if (hasCritical) {
    return 'CRITICAL';
  }

  if (activeIncidentCount > 0) {
    return 'DEGRADED';
  }

  return 'OPERATIONAL';
}

import type { PublicServiceStatus, PublicStatusHistorySegment } from './public-contract';
import { getWorstPublicStatus } from './status-presentation';
import {
  buildServiceHealthSegments,
  healthSegmentsToPublic,
  type PublicHistoryIncident,
  type PublicHistoryMaintenance,
} from './availability-engine';

export type { PublicHistoryIncident, PublicHistoryMaintenance };

export function buildPublicHistorySegments(args: {
  serviceId: string;
  incidents: PublicHistoryIncident[];
  maintenance: PublicHistoryMaintenance[];
  start: Date;
  end: Date;
}): PublicStatusHistorySegment[] {
  return healthSegmentsToPublic(buildServiceHealthSegments(args));
}

export function aggregatePublicRegions(
  services: Array<{ id: string; regions?: string[]; status: PublicServiceStatus }>
) {
  const regionServices = new Map<string, typeof services>();
  for (const service of services) {
    for (const region of service.regions ?? []) {
      const current = regionServices.get(region) ?? [];
      current.push(service);
      regionServices.set(region, current);
    }
  }
  return [...regionServices.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, members]) => {
      const count = (status: PublicServiceStatus) =>
        members.filter(item => item.status === status).length;
      return {
        name,
        status: getWorstPublicStatus(members.map(item => item.status)),
        totalServices: members.length,
        operationalServices: count('OPERATIONAL'),
        degradedServices: count('DEGRADED'),
        maintenanceServices: count('MAINTENANCE'),
        partialOutageServices: count('PARTIAL_OUTAGE'),
        majorOutageServices: count('MAJOR_OUTAGE'),
        unknownServices: count('UNKNOWN'),
        impactedServices: members.filter(item => item.status !== 'OPERATIONAL').length,
        serviceIds: members.map(item => item.id),
      };
    });
}

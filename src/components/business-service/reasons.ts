/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, tier, urgency), never request input */
import type { BsStatus, ImpactReason } from '@/lib/business-services/contract';
import { BS_STATUS_META } from './HealthBadge';

export type ReasonNames = {
  services: ReadonlyMap<string, string>;
  businessServices: ReadonlyMap<string, string>;
};

const urgencyWord = { HIGH: 'high-urgency', MEDIUM: 'medium-urgency', LOW: 'low-urgency' } as const;

/**
 * One plain sentence per reason, safe for stakeholders: names services and urgency, never incident
 * titles. Names the viewer cannot see fall back to a neutral phrase.
 */
export function describeReason(reason: ImpactReason, names: ReasonNames): string {
  const service = (id: string) => names.services.get(id) ?? 'A service';
  switch (reason.kind) {
    case 'DIRECT':
      return `${service(reason.serviceId)} has an open ${urgencyWord[reason.urgency]} incident.`;
    case 'DEPENDENCY':
      return `${service(reason.viaServiceId)} depends on ${names.services.get(reason.serviceId) ?? 'a service'}, which has an open incident.`;
    case 'NESTED':
      return `${names.businessServices.get(reason.childBusinessServiceId) ?? 'A supporting business service'} is ${BS_STATUS_META[reason.status].label.toLowerCase()}.`;
    case 'MANUAL':
      return 'A responder marked an incident as impacting this business service.';
    case 'MAINTENANCE':
      return 'Scheduled maintenance is in progress.';
  }
}

/** Worst reason status per member service (DIRECT on it, or DEPENDENCY through it). */
export function memberStatuses(reasons: readonly ImpactReason[]): Map<string, BsStatus> {
  const statuses = new Map<string, BsStatus>();
  for (const reason of reasons) {
    const serviceId =
      reason.kind === 'DIRECT'
        ? reason.serviceId
        : reason.kind === 'DEPENDENCY'
          ? reason.viaServiceId
          : null;
    if (!serviceId) continue;
    const current = statuses.get(serviceId);
    if (!current || BS_STATUS_META[reason.status].rank > BS_STATUS_META[current].rank) {
      statuses.set(serviceId, reason.status);
    }
  }
  return statuses;
}

/** Ids the reasons mention, so the page can resolve their names in one query each. */
export function reasonIds(reasons: readonly ImpactReason[]) {
  const services = new Set<string>();
  const businessServices = new Set<string>();
  for (const reason of reasons) {
    if (reason.kind === 'DIRECT') services.add(reason.serviceId);
    if (reason.kind === 'DEPENDENCY') services.add(reason.serviceId).add(reason.viaServiceId);
    if (reason.kind === 'NESTED') businessServices.add(reason.childBusinessServiceId);
  }
  return { services: [...services], businessServices: [...businessServices] };
}

import 'server-only';

import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { changeReadWhere } from '@/lib/intelligence/lists/changes';
import { redactSecrets } from '@/lib/intelligence/ai/redact';
import { businessServiceReadWhere } from './commands';
import type { TimeWindow } from './contract';

export const MAX_BUSINESS_SERVICE_CHANGES = 200;

export type BusinessServiceChange = {
  id: string;
  serviceId: string;
  serviceName: string;
  source: string;
  kind: string;
  summary: string;
  version: string | null;
  /** http(s) only; anything else is dropped. */
  url: string | null;
  occurredAt: Date;
  /** 0..1 ranking signal, or null when unscored. Never a verdict. */
  riskScore: number | null;
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Recorded changes (deploys, config, flags, infra from GitHub, GitLab, Argo CD, Terraform, Vercel)
 * on the member services of a business service in the window, newest first. Only changes the actor
 * may read: a team-scoped reader sees changes of their teams' members only.
 */
export async function listBusinessServiceChanges(
  businessServiceId: string,
  window: TimeWindow,
  actor: AuthorizationActor,
  limit = 50
): Promise<BusinessServiceChange[]> {
  const row = await prisma.businessService.findFirst({
    where: { AND: [{ id: businessServiceId }, businessServiceReadWhere(actor)] },
    select: { members: { select: { serviceId: true } } },
  });
  if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const readable = changeReadWhere(actor);
  const serviceIds = row.members.map(member => member.serviceId);
  if (!readable || serviceIds.length === 0) return [];
  const changes = await prisma.changeEvent.findMany({
    where: {
      AND: [
        readable,
        { serviceId: { in: serviceIds } },
        { occurredAt: { gte: window.from, lt: window.to } },
      ],
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(limit, 1), MAX_BUSINESS_SERVICE_CHANGES),
    select: {
      id: true,
      serviceId: true,
      source: true,
      kind: true,
      summary: true,
      version: true,
      url: true,
      occurredAt: true,
      riskScore: true,
      service: { select: { name: true } },
    },
  });
  return changes.map(change => ({
    id: change.id,
    serviceId: change.serviceId!,
    serviceName: change.service?.name ?? 'Service',
    source: change.source,
    kind: change.kind,
    summary: clip(redactSecrets(change.summary), 300),
    version: change.version,
    url: change.url && /^https?:\/\//i.test(change.url.trim()) ? change.url.trim() : null,
    occurredAt: change.occurredAt,
    riskScore: change.riskScore,
  }));
}

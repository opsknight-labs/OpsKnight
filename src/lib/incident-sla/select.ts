import type { Prisma } from '@prisma/client';

/** Scalar-only contract and materialized clock. Never load pause history for live lists. */
export const incidentSlaSelect = {
  status: true,
  createdAt: true,
  acknowledgedAt: true,
  slaFirstAcknowledgedAt: true,
  resolvedAt: true,
  slaAckTargetMs: true,
  slaResolveTargetMs: true,
  slaTargetSource: true,
  slaTargetCapturedAt: true,
  slaPausedMs: true,
  slaPauseStartedAt: true,
  slaAckElapsedMs: true,
  slaResolveElapsedMs: true,
} satisfies Prisma.IncidentSelect;

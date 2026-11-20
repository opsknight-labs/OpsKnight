import type { IncidentStatus, IncidentUrgency } from '@prisma/client';

export interface IncidentListItem {
  id: string;
  title: string;
  status: IncidentStatus;
  escalationStatus: string | null;
  currentEscalationStep: number | null;
  nextEscalationAt: Date | null;
  priority: string | null;
  urgency: IncidentUrgency;
  createdAt: Date;
  updatedAt?: Date | null;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  slaAckTargetMs?: number | null;
  slaResolveTargetMs?: number | null;
  slaTargetSource?: string | null;
  slaTargetCapturedAt?: Date | null;
  slaPausedMs: bigint | number;
  slaPauseStartedAt?: Date | null;
  slaAckElapsedMs?: bigint | number | null;
  slaResolveElapsedMs?: bigint | number | null;
  assigneeId: string | null;
  teamId: string | null;
  service: {
    id: string;
    name: string;
  };
  team: {
    id: string;
    name: string;
  } | null;
  assignee: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    gender?: string | null;
  } | null;
}

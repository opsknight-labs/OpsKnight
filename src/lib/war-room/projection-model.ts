export type WarRoomProjectionPhase = 'TRIGGERED' | 'ACKNOWLEDGED' | 'RESOLVED';

export type WarRoomProjectionAction = 'ACKNOWLEDGE' | 'ASSIGN_TO_ME' | 'RESOLVE';

export interface WarRoomProjectionModel {
  version: 1;
  incident: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    urgency: string;
    priority: string | null;
    serviceName: string;
    assigneeName: string | null;
    url: string;
    createdAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
  };
  phase: WarRoomProjectionPhase;
  actions: readonly WarRoomProjectionAction[];
}

export function buildWarRoomProjection(input: {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  urgency: string;
  priority?: string | null;
  serviceName: string;
  assigneeName?: string | null;
  url: string;
  createdAt: Date;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
}): WarRoomProjectionModel {
  const phase: WarRoomProjectionPhase =
    input.status === 'RESOLVED'
      ? 'RESOLVED'
      : input.acknowledgedAt || input.status === 'ACKNOWLEDGED'
        ? 'ACKNOWLEDGED'
        : 'TRIGGERED';

  return {
    version: 1,
    incident: {
      id: input.id,
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      urgency: input.urgency,
      priority: input.priority ?? null,
      serviceName: input.serviceName,
      assigneeName: input.assigneeName ?? null,
      url: input.url,
      createdAt: input.createdAt,
      acknowledgedAt: input.acknowledgedAt ?? null,
      resolvedAt: input.resolvedAt ?? null,
    },
    phase,
    actions: phase === 'RESOLVED' ? [] : ['ACKNOWLEDGE', 'ASSIGN_TO_ME', 'RESOLVE'],
  };
}

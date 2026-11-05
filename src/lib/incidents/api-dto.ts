type IncidentDurationFields = {
  slaPausedMs?: bigint | number | null;
  slaAckElapsedMs?: bigint | number | null;
  slaResolveElapsedMs?: bigint | number | null;
};

type JsonIncident<T extends IncidentDurationFields> = Omit<
  T,
  'slaPausedMs' | 'slaAckElapsedMs' | 'slaResolveElapsedMs'
> & {
  slaPausedMs?: number | null;
  slaAckElapsedMs?: number | null;
  slaResolveElapsedMs?: number | null;
};

function durationToNumber(value: bigint | number | null | undefined, field: string) {
  if (value === null || value === undefined) return value;
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${field} exceeds the JSON-safe integer range`);
  }
  return result;
}

/**
 * Maps Prisma's BigInt-backed incident duration columns to the numeric public
 * REST representation. Keep this boundary explicit so database records are
 * never passed directly to NextResponse.json.
 */
export function toIncidentApiDto<T extends IncidentDurationFields>(incident: T): JsonIncident<T> {
  return {
    ...incident,
    ...('slaPausedMs' in incident
      ? { slaPausedMs: durationToNumber(incident.slaPausedMs, 'slaPausedMs') }
      : {}),
    ...('slaAckElapsedMs' in incident
      ? { slaAckElapsedMs: durationToNumber(incident.slaAckElapsedMs, 'slaAckElapsedMs') }
      : {}),
    ...('slaResolveElapsedMs' in incident
      ? {
          slaResolveElapsedMs: durationToNumber(
            incident.slaResolveElapsedMs,
            'slaResolveElapsedMs'
          ),
        }
      : {}),
  } as JsonIncident<T>;
}

export function toIncidentApiDtos<T extends IncidentDurationFields>(incidents: T[]) {
  return incidents.map(toIncidentApiDto);
}

type IncidentResponseStateFields = IncidentDurationFields & {
  currentEscalationStep: number | null;
  nextEscalationAt: Date | null;
  escalationStatus: string | null;
  slaAckTargetMs: number | null;
  slaResolveTargetMs: number | null;
};

/**
 * The single-incident REST view: the list fields plus where escalation stands and the SLA
 * targets against elapsed time, so a responder (or an assistant) can tell who has been paged and
 * when it escalates next. The engine's internal claim columns (processing lease, generation) are
 * never selected or exposed.
 */
export function toIncidentDetailDto<T extends IncidentResponseStateFields>(incident: T) {
  const {
    currentEscalationStep,
    nextEscalationAt,
    escalationStatus,
    slaAckTargetMs,
    slaResolveTargetMs,
    ...rest
  } = incident;
  const dto = toIncidentApiDto(rest);
  return {
    ...dto,
    escalation: {
      step: currentEscalationStep,
      status: escalationStatus,
      nextAt: nextEscalationAt,
    },
    sla: {
      ackTargetMs: slaAckTargetMs,
      resolveTargetMs: slaResolveTargetMs,
      ackElapsedMs: durationToNumber(incident.slaAckElapsedMs, 'slaAckElapsedMs') ?? null,
      resolveElapsedMs:
        durationToNumber(incident.slaResolveElapsedMs, 'slaResolveElapsedMs') ?? null,
      pausedMs: durationToNumber(incident.slaPausedMs, 'slaPausedMs') ?? null,
    },
  };
}

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
      ? { slaResolveElapsedMs: durationToNumber(incident.slaResolveElapsedMs, 'slaResolveElapsedMs') }
      : {}),
  } as JsonIncident<T>;
}

export function toIncidentApiDtos<T extends IncidentDurationFields>(incidents: T[]) {
  return incidents.map(toIncidentApiDto);
}

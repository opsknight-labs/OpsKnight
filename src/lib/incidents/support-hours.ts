import type { Prisma } from '@prisma/client';

export type SupportHoursState = 'INSIDE' | 'OUTSIDE' | 'UNCONFIGURED';
export type SupportHoursDecision = {
  state: SupportHoursState;
  timezone: string | null;
  scope: string | null;
  policyId: string | null;
  policyVersion: number | null;
  nextSupportAt: Date | null;
};

type Policy = Prisma.ResponseSupportHoursPolicyGetPayload<{
  include: { windows: true; exceptions: true };
}>;
const compiledPolicies = new WeakMap<
  object,
  { exceptions: Map<string, Policy['exceptions'][number]>; windows: Map<number, Policy['windows']> }
>();

function compiled(policy: Policy) {
  const cached = compiledPolicies.get(policy);
  if (cached) return cached;
  const windows = new Map<number, Policy['windows']>();
  for (const window of policy.windows)
    windows.set(window.dayOfWeek, [...(windows.get(window.dayOfWeek) ?? []), window]);
  const value = {
    exceptions: new Map(
      policy.exceptions.map(item => [item.localDate.toISOString().slice(0, 10), item])
    ),
    windows,
  };
  compiledPolicies.set(policy, value);
  return value;
}

function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? '';
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    day: weekdays[value('weekday')] ?? 0,
    minute: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function contains(policy: Policy, at: Date): boolean {
  const local = localParts(at, policy.timezone);
  const index = compiled(policy);
  const exception = index.exceptions.get(local.date);
  if (exception)
    return (
      exception.available &&
      exception.startMinute! <= local.minute &&
      local.minute < exception.endMinute!
    );
  return (index.windows.get(local.day) ?? []).some(
    window => window.startMinute <= local.minute && local.minute < window.endMinute
  );
}

function addLocalDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function localIntervalOpeningToInstant(
  date: string,
  startMinute: number,
  endMinute: number,
  timezone: string,
  after: Date
): Date | null {
  const [year, month, day] = date.split('-').map(Number);
  const nominal = Date.UTC(year, month - 1, day, Math.floor(startMinute / 60), startMinute % 60);
  // Search the complete timezone-offset range. This deliberately clamps a
  // nonexistent opening to the first valid minute in the interval and chooses
  // the earliest future occurrence when a local minute repeats at a DST fold.
  for (let offset = -14 * 60; offset <= 14 * 60; offset++) {
    const candidate = new Date(nominal + offset * 60_000);
    if (candidate <= after) continue;
    const local = localParts(candidate, timezone);
    if (local.date === date && local.minute >= startMinute && local.minute < endMinute)
      return candidate;
  }
  return null;
}

function findNext(policy: Policy, at: Date): Date | null {
  const current = localParts(at, policy.timezone);
  const index = compiled(policy);
  // One year permits long closure calendars while keeping malformed policies
  // bounded. Opening instants are calculated from policy boundaries, not sampled.
  for (let dayOffset = 0; dayOffset <= 400; dayOffset++) {
    const date = addLocalDays(current.date, dayOffset);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const exception = index.exceptions.get(date);
    const intervals = exception
      ? exception.available && exception.startMinute !== null && exception.endMinute !== null
        ? [{ startMinute: exception.startMinute, endMinute: exception.endMinute }]
        : []
      : (index.windows.get(day) ?? []);
    for (const interval of [...intervals].sort(
      (left, right) => left.startMinute - right.startMinute
    )) {
      const candidate = localIntervalOpeningToInstant(
        date,
        interval.startMinute,
        interval.endMinute,
        policy.timezone,
        at
      );
      if (candidate && candidate > at && contains(policy, candidate)) return candidate;
    }
  }
  return null;
}

export async function resolveSupportHours(
  tx: Prisma.TransactionClient,
  input: { serviceId: string; at: Date }
): Promise<SupportHoursDecision> {
  const keys = [`service:${input.serviceId}`, 'workspace'];
  const [service, workspace] = await Promise.all(
    keys.map(scopeKey =>
      tx.responseSupportHoursPolicy.findFirst({
        where: { scopeKey, sealedAt: { not: null } },
        orderBy: { version: 'desc' },
        include: { windows: true, exceptions: true },
      })
    )
  );
  const serviceMode = service?.mode ?? (service?.inheritWorkspace ? 'INHERIT' : 'SCHEDULED');
  const policy = service && serviceMode !== 'INHERIT' ? service : workspace;
  if (!policy)
    return {
      state: 'UNCONFIGURED',
      timezone: null,
      scope: null,
      policyId: null,
      policyVersion: null,
      nextSupportAt: null,
    };
  const mode = policy.mode ?? (policy.inheritWorkspace ? 'INHERIT' : 'SCHEDULED');
  const inside = mode === 'ALWAYS' || contains(policy, input.at);
  return {
    state: inside ? 'INSIDE' : 'OUTSIDE',
    timezone: policy.timezone,
    scope: policy.scopeKey,
    policyId: policy.id,
    policyVersion: policy.version,
    nextSupportAt: inside ? input.at : mode === 'SCHEDULED' ? findNext(policy, input.at) : null,
  };
}

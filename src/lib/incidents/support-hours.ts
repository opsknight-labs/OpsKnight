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

function findNext(policy: Policy, at: Date): Date | null {
  // DST-safe bounded search. Policies have minute precision and at most a week
  // between recurring windows; exceptions can extend that, so scan 15 days.
  const start = new Date(Math.floor(at.getTime() / 60_000) * 60_000 + 60_000);
  for (let offset = 0; offset < 15 * 24 * 4; offset++) {
    const candidate = new Date(start.getTime() + offset * 15 * 60_000);
    if (contains(policy, candidate)) {
      let boundary = candidate;
      for (let minute = 1; minute <= 15; minute++) {
        const earlier = new Date(candidate.getTime() - minute * 60_000);
        if (earlier < start || !contains(policy, earlier)) break;
        boundary = earlier;
      }
      return boundary;
    }
  }
  return null;
}

export async function resolveSupportHours(
  tx: Prisma.TransactionClient,
  input: { serviceId: string; at: Date }
): Promise<SupportHoursDecision> {
  const keys = [`service:${input.serviceId}`, 'workspace'];
  const versions = await tx.responseSupportHoursPolicy.findMany({
    where: { scopeKey: { in: keys }, sealedAt: { not: null } },
    orderBy: [{ scopeKey: 'asc' }, { version: 'desc' }],
    include: { windows: true, exceptions: true },
  });
  const latest = new Map<string, Policy>();
  for (const policy of versions)
    if (!latest.has(policy.scopeKey)) latest.set(policy.scopeKey, policy);
  const service = latest.get(keys[0]);
  const policy = service && !service.inheritWorkspace ? service : latest.get('workspace');
  if (!policy)
    return {
      state: 'UNCONFIGURED',
      timezone: null,
      scope: null,
      policyId: null,
      policyVersion: null,
      nextSupportAt: null,
    };
  const inside = contains(policy, input.at);
  return {
    state: inside ? 'INSIDE' : 'OUTSIDE',
    timezone: policy.timezone,
    scope: policy.scopeKey,
    policyId: policy.id,
    policyVersion: policy.version,
    nextSupportAt: inside ? input.at : findNext(policy, input.at),
  };
}

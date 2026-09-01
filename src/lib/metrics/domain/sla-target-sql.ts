import { Prisma } from '@prisma/client';
import { MINUTE_MS, PRIORITY_SLA_TARGETS } from './sla-target';

type ServiceTarget = { ackMinutes: number; resolveMinutes: number };

function minutesFor(target: ServiceTarget, kind: 'ackMinutes' | 'resolveMinutes') {
  return kind === 'ackMinutes' ? target.ackMinutes : target.resolveMinutes;
}

function priorityMinutes(
  target: (typeof PRIORITY_SLA_TARGETS)[number],
  kind: 'ackMinutes' | 'resolveMinutes'
) {
  return kind === 'ackMinutes' ? target.ackMinutes : target.resolveMinutes;
}

function column(alias: string | undefined, name: 'priority' | 'serviceId') {
  if (alias !== undefined && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid SQL alias');
  }
  return Prisma.raw(`${alias ? `"${alias}".` : ''}"${name}"`);
}

function serviceTargetExpression(
  serviceTargetMap: ReadonlyMap<string, ServiceTarget>,
  kind: 'ackMinutes' | 'resolveMinutes',
  fallbackMinutes: number,
  alias?: string
) {
  const cases = [...serviceTargetMap.entries()].map(
    ([serviceId, target]) =>
      Prisma.sql`WHEN ${column(alias, 'serviceId')} = ${serviceId} THEN ${minutesFor(target, kind) * MINUTE_MS}`
  );
  if (cases.length === 0) return Prisma.sql`${fallbackMinutes * MINUTE_MS}`;
  return Prisma.sql`CASE ${Prisma.join(cases, ' ')} ELSE ${fallbackMinutes * MINUTE_MS} END`;
}

/** SQL equivalent of resolveSlaTarget priority > service > global precedence. */
export function slaTargetSql(input: {
  kind: 'ackMinutes' | 'resolveMinutes';
  serviceTargetMap: ReadonlyMap<string, ServiceTarget>;
  fallbackMinutes: number;
  alias?: string;
}) {
  const priorityCases = PRIORITY_SLA_TARGETS.map(
    target =>
      Prisma.sql`WHEN UPPER(${column(input.alias, 'priority')}) = ${target.priority}
      THEN ${priorityMinutes(target, input.kind) * MINUTE_MS}`
  );
  return Prisma.sql`CASE
    ${Prisma.join(priorityCases, ' ')}
    ELSE ${serviceTargetExpression(
      input.serviceTargetMap,
      input.kind,
      input.fallbackMinutes,
      input.alias
    )}
  END`;
}

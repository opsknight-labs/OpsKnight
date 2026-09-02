import { Prisma } from '@prisma/client';
import { MINUTE_MS, PRIORITY_SLA_TARGETS } from './sla-target';

type ServiceTarget = { ackMinutes: number; resolveMinutes: number };
type IncidentSlaColumn = 'priority' | 'serviceId' | 'slaAckTargetMs' | 'slaResolveTargetMs';

function priorityMinutes(
  target: (typeof PRIORITY_SLA_TARGETS)[number],
  kind: 'ackMinutes' | 'resolveMinutes'
) {
  return kind === 'ackMinutes' ? target.ackMinutes : target.resolveMinutes;
}

function column(alias: string | undefined, name: IncidentSlaColumn) {
  if (alias !== undefined && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid SQL alias');
  }
  return Prisma.raw(`${alias ? `"${alias}".` : ''}"${name}"`);
}

function serviceTargetExpression(
  _serviceTargetMap: ReadonlyMap<string, ServiceTarget>,
  kind: 'ackMinutes' | 'resolveMinutes',
  fallbackMinutes: number,
  alias?: string
) {
  const serviceColumn = Prisma.raw(
    kind === 'ackMinutes' ? '"targetAckMinutes"' : '"targetResolveMinutes"'
  );
  return Prisma.sql`COALESCE((
    SELECT s.${serviceColumn} * ${MINUTE_MS}
    FROM "Service" s
    WHERE s."id" = ${column(alias, 'serviceId')}
  ), ${fallbackMinutes * MINUTE_MS})`;
}

/** SQL equivalent of resolveSlaTarget incident > priority > service > global precedence. */
export function slaTargetSql(input: {
  kind: 'ackMinutes' | 'resolveMinutes';
  serviceTargetMap: ReadonlyMap<string, ServiceTarget>;
  fallbackMinutes: number;
  alias?: string;
}) {
  const priorityCases = PRIORITY_SLA_TARGETS.map(
    target =>
      Prisma.sql`WHEN CONCAT('P', REGEXP_REPLACE(BTRIM(UPPER(${column(input.alias, 'priority')})), '^P', '')) = ${target.priority}
      THEN ${priorityMinutes(target, input.kind) * MINUTE_MS}`
  );
  const frozenColumn = column(
    input.alias,
    input.kind === 'ackMinutes' ? 'slaAckTargetMs' : 'slaResolveTargetMs'
  );
  return Prisma.sql`COALESCE(
    NULLIF(${frozenColumn}, 0),
    CASE
      ${Prisma.join(priorityCases, ' ')}
      ELSE ${serviceTargetExpression(
        input.serviceTargetMap,
        input.kind,
        input.fallbackMinutes,
        input.alias
      )}
    END
  )`;
}

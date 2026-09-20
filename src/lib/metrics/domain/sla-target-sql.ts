import { Prisma } from '@prisma/client';
type IncidentSlaColumn =
  | 'slaAckTargetMs'
  | 'slaResolveTargetMs'
  | 'slaTargetSource'
  | 'slaTargetCapturedAt';

function column(alias: string | undefined, name: IncidentSlaColumn) {
  if (alias !== undefined && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid SQL alias');
  }
  return Prisma.raw(`${alias ? `"${alias}".` : ''}"${name}"`);
}

/** Canonical analytics use only the complete, immutable incident contract. */
export function slaTargetSql(input: {
  kind: 'ackMinutes' | 'resolveMinutes';
  serviceTargetMap?: ReadonlyMap<string, { ackMinutes: number; resolveMinutes: number }>;
  fallbackMinutes?: number;
  alias?: string;
}) {
  const frozenColumn = column(
    input.alias,
    input.kind === 'ackMinutes' ? 'slaAckTargetMs' : 'slaResolveTargetMs'
  );
  const ackColumn = column(input.alias, 'slaAckTargetMs');
  const resolveColumn = column(input.alias, 'slaResolveTargetMs');
  const sourceColumn = column(input.alias, 'slaTargetSource');
  const capturedAtColumn = column(input.alias, 'slaTargetCapturedAt');
  return Prisma.sql`CASE
    WHEN ${ackColumn} > 0
      AND ${resolveColumn} > 0
      AND NULLIF(BTRIM(${sourceColumn}), '') IS NOT NULL
      AND ${capturedAtColumn} IS NOT NULL
    THEN ${frozenColumn}
    ELSE NULL
  END`;
}

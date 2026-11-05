import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { RESPONSE_LIMITS } from '../contract';
import { enqueueWorkItems, WORK_KINDS } from '../jobs/work-queue';
import { parseOrThrow } from '../settings/service';
import { canonicalizeLabels } from '../normalization/labels';
import { maskVolatileIdentifiers } from '../normalization/text';
import { loadActiveEdges } from '../dependencies/service';
import { upstreamDistances } from '../dependencies/graph';

export const CHANGE_KINDS = ['DEPLOY', 'CONFIG', 'FEATURE_FLAG', 'INFRA'] as const;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 24 * 3_600_000;

/** Operator-supplied text is shown to responders, so control characters are removed at the edge. */
function stripControl(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Must be an http(s) URL');

export const changeInputSchema = z
  .object({
    serviceId: z.string().trim().min(1).max(64).nullish(),
    source: z.string().trim().min(1).max(64),
    kind: z.enum(CHANGE_KINDS),
    summary: z.string().transform(stripControl).pipe(z.string().min(1).max(300)),
    version: z.string().transform(stripControl).pipe(z.string().max(100)).nullish(),
    component: z.string().trim().min(1).max(128).transform(maskVolatileIdentifiers).nullish(),
    labels: z
      .record(z.string().min(1).max(64), z.union([z.string().max(128), z.number(), z.boolean()]))
      .refine(value => Object.keys(value).length <= 32, 'At most 32 labels')
      .transform(canonicalizeLabels)
      .default({}),
    url: httpUrl.nullish(),
    dedupKey: z.string().trim().min(1).max(128).nullish(),
    // Numbers below 10^11 are Unix seconds (10^11 s is the year 5138); larger ones are milliseconds. Many
    // CI systems send seconds, which read as milliseconds would land in January 1970 and be rejected.
    occurredAt: z.preprocess(
      value =>
        typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e11
          ? value * 1000
          : value,
      z.coerce.date()
    ),
  })
  .strict();
export type ChangeInput = z.input<typeof changeInputSchema>;

export type RecordChangeResult = { status: 'created' | 'duplicate'; id: string };

function invalid(field: string, message: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', fields: [{ field, code: 'custom', message }] });
}

const LATE_CHANGE_REANALYSIS_LIMIT = 50;

/**
 * A change often arrives after the incident it caused (a deploy webhook that lags, or a backfill). Incidents
 * that opened within the cause window after the change are analysed again so it can appear as a possible
 * cause. Only already-indexed incidents are signalled, at most a bounded number, and only the coalesced work
 * queue is touched: nothing on the paging path. A change tied to no service affects every service, so it
 * re-signals the most recent incidents overall.
 */
async function reanalyzeAfterLateChange(
  serviceId: string | null,
  occurredAt: Date,
  tx: Prisma.TransactionClient
): Promise<void> {
  const until = new Date(occurredAt.getTime() + RESPONSE_LIMITS.causeLookbackMinutes * 60_000);
  const downstream = serviceId
    ? upstreamDistances(
        (await loadActiveEdges(tx)).map(edge => ({
          upstreamServiceId: edge.downstreamServiceId,
          downstreamServiceId: edge.upstreamServiceId,
        })),
        serviceId,
        RESPONSE_LIMITS.maxUpstreamDepth
      )
    : new Map<string, number>();
  const rows = await tx.incidentFingerprint.findMany({
    where: {
      incidentCreatedAt: { gte: occurredAt, lte: until },
      template: { not: '' },
      ...(serviceId ? { serviceId: { in: [serviceId, ...downstream.keys()] } } : {}),
    },
    orderBy: { incidentCreatedAt: 'desc' },
    take: LATE_CHANGE_REANALYSIS_LIMIT,
    select: { incidentId: true },
  });
  if (rows.length === 0) return;
  await enqueueWorkItems(
    rows.map(row => ({ kind: WORK_KINDS.ANALYZE_RESPONSE, subjectKey: row.incidentId })),
    tx
  );
}

/**
 * Records a production change. Idempotent per (source, dedupKey), so a retried webhook never
 * creates a second row. Never touches the paging path: this is an independent write.
 */
export async function recordChange(
  input: ChangeInput,
  now: Date = new Date()
): Promise<RecordChangeResult> {
  const parsed = parseOrThrow(changeInputSchema, input);
  if (parsed.occurredAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw invalid('occurredAt', 'Change time is in the future');
  }
  if (parsed.occurredAt.getTime() < now.getTime() - MAX_AGE_MS) {
    throw invalid('occurredAt', 'Change is older than 30 days');
  }
  const data = {
    serviceId: parsed.serviceId ?? null,
    source: parsed.source,
    kind: parsed.kind,
    summary: parsed.summary,
    version: parsed.version || null,
    component: parsed.component ?? null,
    labels: parsed.labels,
    url: parsed.url ?? null,
    dedupKey: parsed.dedupKey ?? null,
    occurredAt: parsed.occurredAt,
  };
  try {
    const row = await prisma.$transaction(async tx => {
      const created = await tx.changeEvent.create({ data, select: { id: true } });
      await reanalyzeAfterLateChange(data.serviceId, data.occurredAt, tx);
      return created;
    });
    return { status: 'created', id: row.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002' && data.dedupKey) {
        const existing = await prisma.changeEvent.findFirst({
          where: { source: data.source, dedupKey: data.dedupKey },
          select: { id: true },
        });
        if (existing) return { status: 'duplicate', id: existing.id };
      }
      if (error.code === 'P2003') throw invalid('serviceId', 'Unknown service');
    }
    throw error;
  }
}

import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { parseOrThrow } from '../settings/service';

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
    url: parsed.url ?? null,
    dedupKey: parsed.dedupKey ?? null,
    occurredAt: parsed.occurredAt,
  };
  try {
    const row = await prisma.changeEvent.create({ data, select: { id: true } });
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

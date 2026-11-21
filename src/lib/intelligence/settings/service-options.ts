import 'server-only';
import { z } from 'zod/v4';
import { serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { withDbBudget } from '../jobs/db-budget';

const inputSchema = z
  .object({
    q: z.string().trim().max(80).default(''),
    after: z.string().max(64).optional(),
    serviceId: z.string().max(64).optional(),
  })
  .strict();
export const SERVICE_OPTIONS_PAGE_SIZE = 25;

/** Scope is applied before search, cursor resolution and LIMIT. No unbounded service list/count. */
export async function listReadableServiceOptions(actor: AuthorizationActor, input: unknown) {
  const readable = serviceReadWhere(actor);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return {
      services: [],
      selected: null,
      q: '',
      after: undefined,
      next: undefined,
      error: 'Use a search of at most 80 characters and a valid service selection.',
    };
  const { q, after, serviceId } = parsed.data;
  const literalSearch = q.replace(/[\\%_]/g, character => `\\${character}`);
  return withDbBudget({ maxDbMs: 750 }, async tx => {
    const where = {
      AND: [
        readable,
        ...(q ? [{ name: { contains: literalSearch, mode: 'insensitive' as const } }] : []),
      ],
    };
    const cursor = after
      ? await tx.service.findFirst({
          where: { AND: [where, { id: after }] },
          select: { name: true },
        })
      : null;
    const services =
      after && !cursor
        ? []
        : await tx.service.findMany({
            where: { AND: [where, ...(cursor ? [{ name: { gt: cursor.name } }] : [])] },
            orderBy: { name: 'asc' },
            take: SERVICE_OPTIONS_PAGE_SIZE + 1,
            select: { id: true, name: true },
          });
    const hasMore = services.length > SERVICE_OPTIONS_PAGE_SIZE;
    if (hasMore) services.pop();
    const selected = serviceId
      ? (services.find(row => row.id === serviceId) ??
        (await tx.service.findFirst({
          where: { AND: [readable, { id: serviceId }] },
          select: { id: true, name: true },
        })))
      : (services[0] ?? null);
    return {
      services,
      selected,
      q,
      after,
      next: hasMore ? services.at(-1)?.id : undefined,
      error:
        after && !cursor ? 'The service list changed. Restart the search to continue.' : undefined,
    };
  });
}

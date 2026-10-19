import 'server-only';
import type { PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { z } from 'zod';
const cursorSchema = z.object({ id: z.string().cuid(), createdAt: z.string().datetime() }).strict();
export const SERVICE_RULE_PAGE_SIZE = 20;
export async function getServiceRulePage(
  serviceId: string,
  after: string | undefined = undefined,
  db: Pick<PrismaClient, 'serviceAutomationRule'> = prisma,
  options: { state?: 'active' | 'archived'; search?: string } = {}
) {
  let cursor: { createdAt: Date; id: string } | null = null;
  if (after && after.length <= 512) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(after, 'base64url').toString());
      const value = cursorSchema.safeParse(parsed);
      if (value.success) cursor = { id: value.data.id, createdAt: new Date(value.data.createdAt) };
    } catch {
      /* Invalid cursors restart at the first page. */
    }
  }
  const total = await db.serviceAutomationRule.count({ where: { serviceId, detachedAt: null } });
  const rows = await db.serviceAutomationRule.findMany({
    where: {
      serviceId,
      detachedAt: options.state === 'archived' ? { not: null } : null,
      ...(options.search?.trim()
        ? {
            AND: [
              {
                OR: [
                  {
                    name: { contains: options.search.slice(0, 100), mode: 'insensitive' as const },
                  },
                  {
                    runbook: {
                      name: {
                        contains: options.search.slice(0, 100),
                        mode: 'insensitive' as const,
                      },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: {
      runbook: {
        include: { publishedVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } } },
      },
      runbookVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } },
      triggers: { include: { conditions: { orderBy: { sequence: 'asc' } } } },
      unattendedWritesAuthorizedBy: { select: { name: true } },
      executions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
        },
      },
      _count: {
        select: { executions: true },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: SERVICE_RULE_PAGE_SIZE + 1,
  });
  const rules = rows.slice(0, SERVICE_RULE_PAGE_SIZE);
  const last = rules.at(-1);
  return {
    rules,
    total,
    hasNext: rows.length > SERVICE_RULE_PAGE_SIZE,
    nextCursor: last
      ? Buffer.from(
          JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })
        ).toString('base64url')
      : undefined,
  };
}

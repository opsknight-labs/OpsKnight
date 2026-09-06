import { Prisma, PrismaClient } from '@prisma/client';
import {
  getStoredActionItemId,
  normalizeLegacyActionItems,
  parseActionItemDueDate,
} from '../src/lib/action-items';

const prisma = new PrismaClient();

type Options = {
  apply: boolean;
  batchSize: number;
  limit?: number;
  postmortemId?: string;
};

type BackfillStats = {
  scanned: number;
  eligible: number;
  skippedExisting: number;
  emptyLegacy: number;
  created: number;
  failed: number;
};

function parsePositiveInteger(value: string | undefined, fallback?: number): number | undefined {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apply: false,
    batchSize: 100,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize =
        parsePositiveInteger(arg.split('=')[1], options.batchSize) ?? options.batchSize;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.split('=')[1]);
    } else if (arg.startsWith('--postmortem-id=')) {
      options.postmortemId = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Backfill legacy Postmortem.actionItems JSON into normalized ActionItem rows.

Usage:
  npx ts-node --project tsconfig.script.json scripts/backfill-action-items.ts [options]

Options:
  --apply                 Write rows. Without this flag the script is dry-run only.
  --batch-size=<number>   Number of postmortems to scan per batch. Default: 100.
  --limit=<number>        Stop after scanning this many postmortems.
  --postmortem-id=<id>    Backfill a single postmortem.
  --help                  Show this help text.

Safety:
  - Idempotent: skips postmortems that already have ActionItem rows.
  - Resumable: safe to rerun after interruption.
  - Rolling-safe: leaves legacy JSON untouched.
`);
}

function legacyActionItemsWhere(options: Options): Prisma.PostmortemWhereInput {
  return {
    ...(options.postmortemId ? { id: options.postmortemId } : {}),
    actionItems: {
      not: Prisma.JsonNull,
    },
  };
}

async function backfillActionItems(options: Options): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    eligible: 0,
    skippedExisting: 0,
    emptyLegacy: 0,
    created: 0,
    failed: 0,
  };

  let cursor: string | undefined;

  while (true) {
    const remaining = options.limit ? options.limit - stats.scanned : undefined;
    if (remaining !== undefined && remaining <= 0) break;

    const take = Math.min(options.batchSize, remaining ?? options.batchSize);
    const postmortems = await prisma.postmortem.findMany({
      where: legacyActionItemsWhere(options),
      select: {
        id: true,
        incidentId: true,
        actionItems: true,
        actionItemRecords: {
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { id: 'asc' },
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      take,
    });

    if (postmortems.length === 0) break;

    for (const postmortem of postmortems) {
      stats.scanned++;

      if (postmortem.actionItemRecords.length > 0) {
        stats.skippedExisting++;
        continue;
      }

      const legacyItems = normalizeLegacyActionItems(postmortem.actionItems, {
        legacyIdPrefix: `postmortem-${postmortem.id}`,
      });

      if (legacyItems.length === 0) {
        stats.emptyLegacy++;
        continue;
      }

      stats.eligible++;

      const now = new Date();
      const rows = legacyItems.map((item, index) => ({
        id: getStoredActionItemId({
          postmortemId: postmortem.id,
          legacyId: item.id,
          index,
        }),
        postmortemId: postmortem.id,
        incidentId: postmortem.incidentId,
        title: item.title.trim() || 'Untitled action item',
        description: item.description.trim() || null,
        ownerId: item.owner ?? null,
        dueDate: parseActionItemDueDate(item.dueDate) ?? null,
        status: item.status,
        priority: item.priority,
        source: 'POSTMORTEM' as const,
        completedAt: item.status === 'COMPLETED' ? now : null,
        createdAt: now,
        updatedAt: now,
      }));

      if (!options.apply) {
        stats.created += rows.length;
        continue;
      }

      try {
        const result = await prisma.actionItem.createMany({
          data: rows,
          skipDuplicates: true,
        });
        stats.created += result.count;
      } catch (error) {
        stats.failed++;
        console.error(`Failed to backfill postmortem ${postmortem.id}:`, error);
      }
    }

    cursor = postmortems[postmortems.length - 1]?.id;

    console.log(
      JSON.stringify({
        mode: options.apply ? 'apply' : 'dry-run',
        scanned: stats.scanned,
        eligible: stats.eligible,
        skippedExisting: stats.skippedExisting,
        emptyLegacy: stats.emptyLegacy,
        created: stats.created,
        failed: stats.failed,
      })
    );

    if (options.postmortemId) break;
  }

  return stats;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  console.log(
    JSON.stringify({
      message: 'Starting action item backfill',
      mode: options.apply ? 'apply' : 'dry-run',
      batchSize: options.batchSize,
      limit: options.limit ?? null,
      postmortemId: options.postmortemId ?? null,
    })
  );

  const stats = await backfillActionItems(options);

  console.log(
    JSON.stringify({
      message: 'Action item backfill complete',
      mode: options.apply ? 'apply' : 'dry-run',
      ...stats,
    })
  );

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch(error => {
    console.error('Action item backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

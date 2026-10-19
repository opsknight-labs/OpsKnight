'use strict';

const { PrismaClient } = require('@prisma/client');

const LOCK_ID = 1762184302;
const BATCH_SIZE = Number(process.env.OPSKNIGHT_BACKFILL_BATCH_SIZE || 500);
const MAX_PASSES = 20;

// Driven from the automation history tables so cost scales with automation use, not Incident size.
const CAPTURED = `(
  SELECT "incidentId" AS id FROM "IncidentAutomationDecision"
  UNION
  SELECT "incidentId" AS id FROM "AutomationTrace"
)`;

async function pendingClassificationCount(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS pending
    FROM ${CAPTURED} captured
    JOIN "Incident" incident ON incident.id = captured.id
    WHERE NOT incident."automationSourceRestricted"
  `);
  return rows[0].pending;
}

// Short per-batch transactions; rows locked by live writers are skipped and picked up by a later pass.
async function backfillPass(prisma, batchSize = BATCH_SIZE) {
  let cursor = '';
  let updated = 0;
  for (;;) {
    const rows = await prisma.$queryRawUnsafe(
      `
      WITH batch AS (
        SELECT incident.id
        FROM "Incident" incident
        WHERE NOT incident."automationSourceRestricted" AND incident.id > $1
          AND (
            EXISTS (SELECT 1 FROM "IncidentAutomationDecision" d WHERE d."incidentId" = incident.id)
            OR EXISTS (SELECT 1 FROM "AutomationTrace" t WHERE t."incidentId" = incident.id)
          )
        ORDER BY incident.id
        LIMIT $2
        FOR UPDATE OF incident SKIP LOCKED
      ), changed AS (
        UPDATE "Incident" SET "automationSourceRestricted" = true
        WHERE id IN (SELECT id FROM batch)
        RETURNING id
      )
      SELECT (SELECT max(id) FROM batch) AS "lastId", (SELECT count(*)::int FROM changed) AS changed
    `,
      cursor,
      batchSize
    );
    const { lastId, changed } = rows[0];
    if (!lastId) return updated;
    updated += changed;
    cursor = lastId;
  }
}

async function backfillAutomationSourceClassification(prisma, options = {}) {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxPasses = options.maxPasses ?? MAX_PASSES;
  let total = 0;
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    total += await backfillPass(prisma, batchSize);
    if ((await pendingClassificationCount(prisma)) === 0) return total;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(
    `Source classification backfill left ${await pendingClassificationCount(prisma)} incident(s) unclassified.`
  );
}

async function main() {
  const url = new URL(process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL);
  url.searchParams.set('connection_limit', '1');
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_lock(${LOCK_ID})::text AS "lockResult"`);
  try {
    const updated = await backfillAutomationSourceClassification(prisma);
    console.log(`Automation source classification backfill complete (${updated} incidents updated).`);
  } finally {
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_ID})`);
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Automation source classification backfill failed.', error);
    process.exitCode = 1;
  });
}

module.exports = { backfillAutomationSourceClassification, pendingClassificationCount };

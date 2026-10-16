/** Explicit, bounded historical-data rewrite. Backups and already downloaded output remain operator responsibilities. */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { sanitizeCompressedArtifact } from '../src/lib/runbooks/artifact-safety';
const argument = (name: string) =>
  process.argv
    .find(value => value.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
async function main() {
  if (!process.argv.includes('--apply'))
    throw new Error(
      'Historical output rewrite requires --apply. Review retention/backups and the qualification guide first.'
    );
  const limit = Number(argument('limit') ?? 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Batch limit must be 1–100.');
  const after = argument('after');
  if (after && !/^[a-z0-9]+$/i.test(after)) throw new Error('Invalid artifact cursor.');
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  let rewritten = 0,
    unchanged = 0,
    rejected = 0;
  try {
    const batch = await db.runbookArtifact.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const candidate of batch) {
      const artifact = await db.runbookArtifact.findUnique({ where: { id: candidate.id } });
      if (!artifact) continue;
      let normalized: Awaited<ReturnType<typeof sanitizeCompressedArtifact>>;
      try {
        normalized = await sanitizeCompressedArtifact(artifact.content);
      } catch {
        rejected++;
        continue;
      }
      const checksum = createHash('sha256').update(normalized.content).digest('hex');
      if (checksum === artifact.sha256) {
        unchanged++;
        continue;
      }
      const updated = await db.$transaction(async tx => {
        const changed = await tx.runbookArtifact.updateMany({
          where: { id: artifact.id, sha256: artifact.sha256 },
          data: {
            content: normalized.content,
            sha256: checksum,
            sizeBytes: normalized.content.length,
            truncated: artifact.truncated || normalized.truncated,
          },
        });
        if (changed.count === 1)
          await tx.auditLog.create({
            data: {
              action: 'runbook.artifact.sanitized',
              entityType: 'RUNBOOK_EXECUTION',
              entityId: null,
              details: {
                artifactId: artifact.id,
                attemptId: artifact.attemptId,
                previousSha256: artifact.sha256,
                sanitizedSha256: checksum,
                source: 'operator-batch',
              },
            },
          });
        return changed;
      });
      rewritten += updated.count;
    }
    console.log(
      JSON.stringify({
        selected: batch.length,
        rewritten,
        unchanged,
        rejected,
        nextCursor: batch.at(-1)?.id ?? after ?? null,
        hasMore: batch.length === limit,
      })
    );
    if (rejected) process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Artifact sanitation stopped. Check arguments and database access; no output payloads are logged.'
  );
  process.exitCode = 1;
});

import prisma from '@/lib/prisma';
import { decryptStoredSecret, encrypt } from '@/lib/encryption';
import { integrationKeyFingerprint } from '@/lib/integrations/credentials';

const apply = process.argv.includes('--apply');
const batchSize = 100;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;
  while (true) {
    const rows = await prisma.integration.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, key: true, keyFingerprint: true, previousKey: true, previousKeyFingerprint: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      scanned += 1;
      const plaintextKey = await decryptStoredSecret(row.key);
      const plaintextPrevious = row.previousKey ? await decryptStoredSecret(row.previousKey) : null;
      const keyNeedsEncryption = plaintextKey === row.key;
      const previousNeedsEncryption = Boolean(row.previousKey && plaintextPrevious === row.previousKey);
      const nextFingerprint = row.keyFingerprint ?? integrationKeyFingerprint(plaintextKey);
      const nextPreviousFingerprint = plaintextPrevious
        ? row.previousKeyFingerprint ?? integrationKeyFingerprint(plaintextPrevious)
        : null;
      if (!keyNeedsEncryption && !previousNeedsEncryption && row.keyFingerprint === nextFingerprint && row.previousKeyFingerprint === nextPreviousFingerprint) continue;
      changed += 1;
      if (!apply) continue;
      await prisma.integration.update({
        where: { id: row.id },
        data: {
          ...(keyNeedsEncryption ? { key: await encrypt(plaintextKey) } : {}),
          keyFingerprint: nextFingerprint,
          ...(row.previousKey ? {
            ...(previousNeedsEncryption ? { previousKey: await encrypt(plaintextPrevious!) } : {}),
            previousKeyFingerprint: nextPreviousFingerprint,
          } : {}),
        },
      });
    }
    cursor = rows[rows.length - 1].id;
  }
  process.stdout.write(`${apply ? 'Updated' : 'Would update'} ${changed} of ${scanned} integration credential records. No secret values were printed.\n`);
}

main().finally(() => prisma.$disconnect());

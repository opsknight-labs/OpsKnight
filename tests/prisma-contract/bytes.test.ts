import { afterAll, beforeAll, describe, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { isValidStatusPageLogoBytes } from '@/lib/status-pages/assets';
import { sanitizeCompressedArtifact } from '@/lib/runbooks/artifact-safety';
import { gzipSync } from 'node:zlib';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { describeValue } from './support/describe';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('bytes');
const RUN = `contract-bytes-${process.pid}-${Date.now()}`;

// Smallest valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createContractClient(requireEnv('CONTRACT_DATABASE_URL'));
  await prisma.user.create({
    data: { id: `${RUN}-user`, name: 'Bytes', email: `${RUN}@example.test` },
  });
});

afterAll(async () => {
  await prisma.userAvatar.deleteMany({ where: { userId: `${RUN}-user` } });
  await prisma.user.deleteMany({ where: { id: `${RUN}-user` } });
  await disconnectContractClients();
});

describe('Bytes columns', () => {
  it('round-trips through the model API', async () => {
    await prisma.userAvatar.create({
      data: { userId: `${RUN}-user`, data: PNG, mimeType: 'image/png' },
    });
    const avatar = await prisma.userAvatar.findUniqueOrThrow({
      where: { userId: `${RUN}-user` },
    });
    golden.observe('model.read', describeValue(avatar.data));
    golden.observe('model.byteLength', avatar.data.byteLength);
    golden.observe(
      'app.logoValidationOnModelBytes',
      await outcome(
        async () =>
          isValidStatusPageLogoBytes(
            'image/png',
            avatar.data as Parameters<typeof isValidStatusPageLogoBytes>[1]
          ),
        valid => valid
      )
    );
    golden.observe(
      'app.uint8ArrayCopyIsByteExact',
      Buffer.compare(Buffer.from(new Uint8Array(avatar.data)), PNG) === 0
    );
  });

  it('accepts Uint8Array and empty input on write', async () => {
    await prisma.userAvatar.update({
      where: { userId: `${RUN}-user` },
      data: { data: new Uint8Array([0, 1, 2, 254, 255]) },
    });
    golden.observe(
      'model.uint8ArrayWrite',
      describeValue(
        (await prisma.userAvatar.findUniqueOrThrow({ where: { userId: `${RUN}-user` } })).data
      )
    );
    await prisma.userAvatar.update({
      where: { userId: `${RUN}-user` },
      data: { data: Buffer.alloc(0) },
    });
    golden.observe(
      'model.emptyWrite',
      describeValue(
        (await prisma.userAvatar.findUniqueOrThrow({ where: { userId: `${RUN}-user` } })).data
      )
    );
  });

  it('round-trips through raw SQL', async () => {
    await prisma.$executeRaw`
      UPDATE "UserAvatar" SET data = ${PNG} WHERE "userId" = ${`${RUN}-user`}`;
    const rows = await prisma.$queryRaw<Array<{ data: Buffer }>>`
      SELECT data FROM "UserAvatar" WHERE "userId" = ${`${RUN}-user`}`;
    golden.observe('raw.read', describeValue(rows[0]?.data));
    golden.observe(
      'app.logoValidationOnRawBytes',
      await outcome(
        async () => isValidStatusPageLogoBytes('image/png', rows[0]!.data),
        valid => valid
      )
    );
  });

  it('feeds DB bytes into the runbook artifact sanitizer', async () => {
    const artifact = gzipSync(Buffer.from('contract artifact\n'));
    await prisma.userAvatar.update({
      where: { userId: `${RUN}-user` },
      data: { data: artifact },
    });
    const stored = await prisma.userAvatar.findUniqueOrThrow({ where: { userId: `${RUN}-user` } });
    golden.observe(
      'app.artifactSanitizer',
      await outcome(
        () => sanitizeCompressedArtifact(stored.data),
        result => ({ truncated: result.truncated, isBuffer: Buffer.isBuffer(result.content) })
      )
    );
  });
});

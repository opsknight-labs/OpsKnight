import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export function isValidStatusPageLogoBytes(mime: string, buffer: Buffer) {
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) return false;
  return (
    (mime === 'image/png' && buffer.length >= 45 &&
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      buffer.toString('ascii', 12, 16) === 'IHDR' &&
      buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0 &&
      buffer.toString('ascii', buffer.length - 8, buffer.length - 4) === 'IEND') ||
    (mime === 'image/jpeg' && buffer.length >= 16 && buffer[0] === 0xff &&
      buffer[1] === 0xd8 && buffer[2] === 0xff &&
      buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) ||
    (mime === 'image/gif' && buffer.length >= 14 &&
      ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)) &&
      buffer.readUInt16LE(6) > 0 && buffer.readUInt16LE(8) > 0 &&
      buffer[buffer.length - 1] === 0x3b) ||
    (mime === 'image/webp' && buffer.length >= 20 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.readUInt32LE(4) + 8 === buffer.length &&
      buffer.toString('ascii', 8, 12) === 'WEBP' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16)))
  );
}

export function parseStatusPageLogo(value: string) {
  if (value.length > 2_800_000) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  const metadata = value.slice(0, comma);
  const types = new Map([
    ['data:image/png;base64', 'image/png'],
    ['data:image/jpeg;base64', 'image/jpeg'],
    ['data:image/gif;base64', 'image/gif'],
    ['data:image/webp;base64', 'image/webp'],
  ]);
  const mime = types.get(metadata);
  if (!mime) return null;
  const payload = value.slice(comma + 1);
  if (!payload) return null;
  const buffer = Buffer.from(payload, 'base64');
  if (buffer.toString('base64') !== payload) return null;
  if (!isValidStatusPageLogoBytes(mime, buffer)) return null;
  return { mime, buffer };
}

export async function externalizeStatusPageLogo(
  tx: Prisma.TransactionClient,
  pageId: string,
  branding: Record<string, unknown>
) {
  if (typeof branding.logoUrl !== 'string' || !branding.logoUrl.startsWith('data:'))
    return branding;
  const parsed = parseStatusPageLogo(branding.logoUrl);
  if (!parsed) throw new Error('Invalid status page logo.');
  const id = createHash('sha256').update(pageId).update(parsed.buffer).digest('hex');
  await tx.$executeRaw`
    INSERT INTO "StatusPageAsset" ("id", "statusPageId", "contentType", "data")
    VALUES (${id}, ${pageId}, ${parsed.mime}, ${parsed.buffer}) ON CONFLICT ("id") DO NOTHING
  `;
  return {
    ...branding,
    logoUrl: `/api/status-page/logo/${encodeURIComponent(pageId)}?asset=${id}`,
  };
}

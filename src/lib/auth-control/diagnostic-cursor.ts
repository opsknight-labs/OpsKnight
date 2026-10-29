import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod/v3';
import { getNextAuthSecret } from '@/lib/secret-manager';
import type { DiagnosticQuery } from './diagnostic-contract';

const payloadSchema = z
  .object({
    v: z.literal(1),
    context: z.string().length(64),
    snapshotAt: z.string().datetime(),
    at: z.string().datetime(),
    id: z.string().min(1).max(128),
  })
  .strict();
export type DiagnosticCursor = z.infer<typeof payloadSchema>;
export function diagnosticContext(
  query: DiagnosticQuery,
  principal: string,
  policyVersion: number
) {
  const { after: _cursor, ...filters } = query;
  return createHash('sha256')
    .update(JSON.stringify({ principal, policyVersion, ...filters }))
    .digest('hex');
}
export async function encodeDiagnosticCursor(payload: DiagnosticCursor) {
  const body = Buffer.from(JSON.stringify(payloadSchema.parse(payload))).toString('base64url');
  const signature = createHmac('sha256', await getNextAuthSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}
export async function decodeDiagnosticCursor(value: string, context: string, now = Date.now()) {
  if (value.length > 4096) throw new Error('Invalid diagnostic cursor. Refresh this view.');
  const parts = value.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)))
    throw new Error('Invalid diagnostic cursor. Refresh this view.');
  const expected = createHmac('sha256', await getNextAuthSecret())
    .update(parts[0])
    .digest();
  const signature = Buffer.from(parts[1], 'base64url');
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
    throw new Error('Invalid diagnostic cursor. Refresh this view.');
  const payload = payloadSchema.parse(
    JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  );
  const snapshot = Date.parse(payload.snapshotAt);
  if (payload.context !== context || snapshot > now + 5000 || now - snapshot > 3600000)
    throw new Error('This diagnostic page expired or its filters changed. Refresh this view.');
  return payload;
}

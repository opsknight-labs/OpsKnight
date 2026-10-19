import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { MAX_DECODED_OUTPUT_BYTES, boundOutput } from '../../../agent/src/output-limits';
import { sanitizeOutputText } from '../../../agent/src/output-safety';
const unpack = promisify(gunzip);
const pack = promisify(gzip);
const MAX_RETAINED_BYTES = 1024 * 1024;
/** Validate gzip and UTF-8, bound decompression, and sanitize before any database write or download. */
export async function sanitizeCompressedArtifact(content: Uint8Array) {
  let decoded: Buffer;
  try {
    decoded = await unpack(content, { maxOutputLength: MAX_DECODED_OUTPUT_BYTES });
  } catch {
    throw new Error('Artifact must be valid gzip with at most 10 MiB of decoded text.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } catch {
    throw new Error('Artifact must contain valid UTF-8 text.');
  }
  const sanitized = sanitizeOutputText(text);
  const retained = boundOutput(sanitized, MAX_RETAINED_BYTES);
  return { content: await pack(Buffer.from(retained.text)), truncated: retained.truncated };
}

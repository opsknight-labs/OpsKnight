import { MAX_OUTPUT_PREVIEW_BYTES } from './types';
import { sanitizeOutputText } from '../../../agent/src/output-safety';

export function redactRunbookOutput(
  value: string,
  knownSecretValues: readonly string[] = []
): string {
  return Buffer.from(sanitizeOutputText(value, knownSecretValues))
    .subarray(0, MAX_OUTPUT_PREVIEW_BYTES)
    .toString('utf8');
}

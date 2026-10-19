import type { Prisma } from '@prisma/client';
import { sliceUtf8Safe } from '../../../agent/src/output-limits';
import { MAX_OUTPUT_PREVIEW_BYTES } from './types';
import { sanitizeOutputText } from '../../../agent/src/output-safety';

export function redactRunbookOutput(
  value: string,
  knownSecretValues: readonly string[] = []
): string {
  return sliceUtf8Safe(sanitizeOutputText(value, knownSecretValues), MAX_OUTPUT_PREVIEW_BYTES);
}

/** Evidence is signed by the Agent, but remains untrusted output at the persistence boundary. */
export function redactRunbookEvidence(
  value: Record<string, unknown> | undefined
): Prisma.InputJsonValue | undefined {
  return value === undefined
    ? undefined
    : (JSON.parse(sanitizeOutputText(JSON.stringify(value))) as Prisma.InputJsonValue);
}

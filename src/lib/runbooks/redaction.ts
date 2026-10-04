import { MAX_OUTPUT_PREVIEW_BYTES } from './types';

const CREDENTIAL_PATTERNS: RegExp[] = [
  // Inputs are byte-bounded before persistence; this pattern has no nested repetition.
  // eslint-disable-next-line security/detect-unsafe-regex
  /\b(authorization\s*:\s*)(?:bearer\s+|basic\s+)?[^\s,;]+/gi,
  /\b(password|passwd|pwd|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*([^\s,;]+)/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
];

function redactPrivateKeyBlocks(value: string): string {
  let output = value;
  let start = output.indexOf('-----BEGIN ');
  while (start >= 0) {
    const labelEnd = output.indexOf('PRIVATE KEY-----', start);
    if (labelEnd < 0) break;
    const end = output.indexOf('PRIVATE KEY-----', labelEnd + 16);
    if (end < 0) break;
    output = `${output.slice(0, start)}[REDACTED PRIVATE KEY]${output.slice(end + 16)}`;
    start = output.indexOf('-----BEGIN ', start + 22);
  }
  return output;
}

export function redactRunbookOutput(
  value: string,
  knownSecretValues: readonly string[] = []
): string {
  let redacted = value;
  for (const secret of knownSecretValues) {
    if (secret.length >= 4) redacted = redacted.split(secret).join('[REDACTED]');
  }
  redacted = redactPrivateKeyBlocks(redacted)
    .replace(CREDENTIAL_PATTERNS[0]!, '$1[REDACTED]')
    .replace(CREDENTIAL_PATTERNS[1]!, '$1=[REDACTED]')
    .replace(CREDENTIAL_PATTERNS[2]!, '[REDACTED AWS ACCESS KEY]');
  return Buffer.from(redacted).subarray(0, MAX_OUTPUT_PREVIEW_BYTES).toString('utf8');
}

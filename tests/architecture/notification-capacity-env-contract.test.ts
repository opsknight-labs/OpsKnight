import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const ALLOWED_CAPACITY_FILES = new Set([
  'src/lib/notification-capacity/cache.ts',
  'src/lib/notification-capacity/defaults.ts',
  'src/lib/notification-capacity/hard-limits.ts',
  'src/lib/notification-capacity/index.ts',
  'src/lib/notification-capacity/repository.ts',
  'src/lib/notification-capacity/resolver.ts',
  'src/lib/notification-capacity/schema.ts',
  'src/lib/notification-capacity/types.ts',
  // Single sanctioned legacy compatibility path — async DB resolver is the product contract.
  'src/lib/provider-capacity.ts',
  // Legacy fanout watermarks retained as deprecated helper; new code must use getEffectiveFanoutWatermarks().
  'src/lib/notification-fanout.ts',
]);

// Capacity-relevant env vars that must be owned by the control plane. Other NOTIFICATION_*
// vars (e.g. NOTIFICATION_PROVIDER_FEEDBACK_SECRET, NOTIFICATION_CONTROL_PLANE_PERSONAL) are
// intentionally not fenced — they are unrelated to provider rate/bulk/ceiling governance.
const CAPACITY_ENV_PATTERNS: RegExp[] = [
  /\bNOTIFICATION_(?:EMAIL|SMS|WHATSAPP|PUSH|SLACK|WEBHOOK)(?:_[A-Z0-9]+)?_(?:RATE_PER_SECOND|MAX_IN_FLIGHT)\b/,
  /\bNOTIFICATION_(?:EMAIL|SMS|WHATSAPP|PUSH|SLACK|WEBHOOK)_RATE_PER_SECOND\b/,
  /\bNOTIFICATION_(?:EMAIL|SMS|WHATSAPP|PUSH|SLACK|WEBHOOK)_MAX_IN_FLIGHT\b/,
  /\bNOTIFICATION_BULK_SHARE\b/,
  /\bNOTIFICATION_ADAPTIVE_BACKPRESSURE\b/,
  /\bNOTIFICATION_DEPLOYMENT_RATE_CEILING\b/,
  /\bNOTIFICATION_QUOTA_BLOCK_SIZE\b/,
  /\bNOTIFICATION_BULK_QUEUE_LOW_WATERMARK\b/,
  /\bNOTIFICATION_BULK_QUEUE_HIGH_WATERMARK\b/,
];

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const absolute = join(root, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) files.push(...sourceFiles(absolute));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(absolute);
  }
  return files;
}

describe('notification capacity env ownership', () => {
  it('forbids direct NOTIFICATION_* capacity env access outside notification-capacity/ (and the one legacy provider-capacity path)', () => {
    const files = sourceFiles(SRC_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(process.cwd(), file).split('\\').join('/');
      if (ALLOWED_CAPACITY_FILES.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      for (const pattern of CAPACITY_ENV_PATTERNS) {
        if (pattern.test(source)) {
          // Ensure pattern check is not fooled by lastIndex on global — re-create without /g.
          const fresh = new RegExp(pattern.source);
          if (fresh.test(source)) {
            violations.push(`${rel}: ${pattern.source}`);
            break;
          }
        }
      }
    }

    expect(
      violations,
      `Capacity env vars must be read only via src/lib/notification-capacity/resolver.ts (DB>env>default). ` +
        `Legacy read in src/lib/provider-capacity.ts is the only sanctioned fallback. ` +
        `Found direct capacity env access outside the control plane:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('keeps provider-capacity.ts documented as the single legacy compatibility path', () => {
    const source = readFileSync(join(SRC_ROOT, 'lib/provider-capacity.ts'), 'utf8');
    expect(source).toContain('Legacy synchronous resolver');
    expect(source).toContain('getEffectiveProviderCapacity');
  });
});

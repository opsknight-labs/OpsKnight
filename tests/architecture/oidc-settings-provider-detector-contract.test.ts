import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OIDC settings provider detection contract', () => {
  it('uses the canonical provider normalizer instead of a drifting local detector', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/(app)/settings/security/actions.ts'),
      'utf8'
    );

    expect(source).toContain("import { normalizeOidcProviderType } from '@/lib/oidc-provider'");
    expect(source).toContain('normalizeOidcProviderType(requestedProviderType, issuer)');
    expect(source).not.toContain('function detectProviderType(');
  });
});

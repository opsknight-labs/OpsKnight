// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const manifest = JSON.parse(readFileSync('security-capabilities.json', 'utf8'));

describe('security capability manifest', () => {
  it('matches its strict schema', () => {
    const schema = JSON.parse(
      readFileSync('docs/compliance/security-capabilities.schema.json', 'utf8')
    );
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it('keeps high-risk claims aligned with implementation evidence', () => {
    const encryption = readFileSync('src/lib/encryption.ts', 'utf8');
    expect(encryption).toContain("const algorithm = 'aes-256-gcm'");
    expect(encryption).toContain("const algorithm = 'aes-256-cbc'");
    expect(manifest.encryption.newSecretWrites).toContain('GCM');
    expect(manifest.encryption.legacyReads).toEqual(
      expect.arrayContaining(['AES-256-CBC-v1', 'AES-256-CBC-v2'])
    );

    const auth = readFileSync('src/lib/auth.ts', 'utf8');
    expect(auth).toContain("strategy: 'jwt'");
    expect(auth).toContain("sameSite: 'lax'");
    expect(manifest.sessions.sameSite).toBe('lax');

    const securityWorkflow = readFileSync('.github/workflows/security.yml', 'utf8');
    expect(securityWorkflow).toContain('github/codeql-action');
    expect(securityWorkflow).toContain('trufflesecurity/trufflehog');
    expect(manifest.securityAutomation.vulnerabilitySeverityGate).toBe(false);

    expect(manifest.identity.nativeServerVerifiedMfa).toBe(false);
    expect(manifest.identity.scimGroups).toBe(false);
    expect(manifest.audit.immutableOrWormStorage).toBe(false);
    expect(manifest.privacy.subjectErasure).toBe(false);
  });
});

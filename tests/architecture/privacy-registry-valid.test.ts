// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { personalDataRegistry } from '@/lib/privacy/registry';
import { DATA_CLASSIFICATIONS } from '@/lib/privacy/types';

describe('personal-data registry', () => {
  it('has unique, classified domains with purpose and lifecycle metadata', () => {
    expect(new Set(personalDataRegistry.map(item => item.domain)).size).toBe(
      personalDataRegistry.length
    );
    for (const item of personalDataRegistry) {
      expect(item.models.length).toBeGreaterThan(0);
      expect(item.fields.length).toBeGreaterThan(0);
      expect(item.purpose.length).toBeGreaterThan(0);
      expect(item.retention.current.length).toBeGreaterThan(0);
      expect(item.retention.target.length).toBeGreaterThan(0);
      expect(item.notes.length).toBeGreaterThan(0);
      for (const classification of item.classifications) {
        expect(DATA_CLASSIFICATIONS).toContain(classification);
      }
    }
  });

  it('keeps the processing inventory parseable and aligned with registry domains', () => {
    const document = parse(
      readFileSync('docs/compliance/data-processing-inventory.yaml', 'utf8')
    ) as {
      version: number;
      domains: Array<{ domain: string; purpose: string[]; retention: unknown; deletion: unknown }>;
    };
    expect(document.version).toBe(1);
    expect(document.domains.length).toBeGreaterThan(0);
    for (const domain of document.domains) {
      expect(domain.purpose.length).toBeGreaterThan(0);
      expect(domain.retention).toBeTruthy();
      expect(domain.deletion).toBeTruthy();
    }
    expect(document.domains.map(item => item.domain)).toContain('status-page-subscriber');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira deletion history preservation', () => {
  it('preserves historical identifiers while marking the remote issue unavailable', () => {
    const source = readFileSync('src/lib/jira-sync.ts', 'utf8');
    const deleteBranch = source.slice(source.indexOf('if (isDeleteWebhook(payload))'));
    expect(deleteBranch).toContain("externalStatus: 'Deleted in Jira'");
    expect(deleteBranch).not.toContain('externalKey: null');
    expect(deleteBranch).not.toContain('externalUrl: null');
  });
});

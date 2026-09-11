import { describe, expect, it } from 'vitest';
import { jiraActionItemLinkLockKey } from '@/lib/jira-concurrency';

describe('Jira concurrency primitives', () => {
  it('derives a deterministic per-action-item lock key', () => {
    expect(jiraActionItemLinkLockKey('action-123')).toBe(jiraActionItemLinkLockKey('action-123'));
  });

  it('separates different action items into different lock keys', () => {
    expect(jiraActionItemLinkLockKey('action-123')).not.toBe(
      jiraActionItemLinkLockKey('action-124')
    );
  });

  it('keeps dynamic Jira keys in their reserved namespace', () => {
    const key = jiraActionItemLinkLockKey('action-123');
    expect(key >> BigInt(48)).toBe(BigInt('0x4a49'));
  });
});

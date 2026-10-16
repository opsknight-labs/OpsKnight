import { describe, expect, it } from 'vitest';
import {
  isValidRunbookTag,
  parseRunbookMetadataForm,
  parseTagList,
} from '@/lib/runbooks/metadata-form';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('parseRunbookMetadataForm', () => {
  it('leaves ownerTeamId and tags undefined when the fields are absent', () => {
    const result = parseRunbookMetadataForm(form({ name: 'x' }));
    expect(result).toEqual({});
    expect('ownerTeamId' in result).toBe(false);
    expect('tags' in result).toBe(false);
  });

  it('maps an empty ownerTeamId to null to clear ownership', () => {
    expect(parseRunbookMetadataForm(form({ ownerTeamId: '' })).ownerTeamId).toBeNull();
    expect(parseRunbookMetadataForm(form({ ownerTeamId: '   ' })).ownerTeamId).toBeNull();
  });

  it('passes a trimmed ownerTeamId through', () => {
    expect(
      parseRunbookMetadataForm(form({ ownerTeamId: ' clh1234567890123456789012 ' })).ownerTeamId
    ).toBe('clh1234567890123456789012');
  });

  it('splits comma separated tags, trimming, lowercasing and dropping empties', () => {
    expect(parseRunbookMetadataForm(form({ tags: ' Linux, ,database,,p1 , linux' })).tags).toEqual([
      'linux',
      'database',
      'p1',
    ]);
  });

  it('maps an empty tags field to an empty list to clear tags', () => {
    expect(parseRunbookMetadataForm(form({ tags: '' })).tags).toEqual([]);
    expect(parseRunbookMetadataForm(form({ tags: ' , ' })).tags).toEqual([]);
  });
});

describe('runbook tag helpers', () => {
  it('parses tag lists', () => {
    expect(parseTagList('a,b , a')).toEqual(['a', 'b']);
  });

  it('validates tags like the server schema', () => {
    expect(isValidRunbookTag('k8s.prod_eu-1')).toBe(true);
    expect(isValidRunbookTag('-leading')).toBe(false);
    expect(isValidRunbookTag('has space')).toBe(false);
    expect(isValidRunbookTag('a'.repeat(41))).toBe(false);
  });
});

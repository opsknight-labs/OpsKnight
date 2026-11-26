// @vitest-environment node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTO_AVATAR_FILES, getDefaultAvatar, isDefaultAvatar } from '@/lib/avatar';
import { isSameAvatar } from '@/lib/avatar-presets';

describe('default avatar', () => {
  it('is stable for the same person and spreads across people', () => {
    expect(getDefaultAvatar('Ada', 'ada@example.com')).toBe(
      getDefaultAvatar('Ada', 'ada@example.com')
    );
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => getDefaultAvatar('x', `user${i}@example.com`))
    );
    expect(seen.size).toBeGreaterThan(15);
  });

  it('only hands out bundled files that exist, flagged as automatic', () => {
    for (const file of AUTO_AVATAR_FILES) {
      // Reads repo files named by our own constant, never by input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect(existsSync(join(process.cwd(), 'public/avatars', `${file}.svg`))).toBe(true);
    }
    const url = getDefaultAvatar('Ada', 'ada@example.com');
    expect(url).toMatch(/^\/avatars\/(knight|squire)\/[\w-]+\.svg\?auto=1$/);
    expect(isDefaultAvatar(url)).toBe(true);
  });

  it('treats a deliberate pick of the same picture as a custom avatar', () => {
    expect(isDefaultAvatar('/avatars/knight/sentinel.svg')).toBe(false);
    expect(
      isSameAvatar('/avatars/knight/sentinel.svg?auto=1', '/avatars/knight/sentinel.svg')
    ).toBe(true);
  });

  it('copes with empty input', () => {
    expect(getDefaultAvatar()).toMatch(/^\/avatars\//);
    expect(getDefaultAvatar('', '')).toMatch(/^\/avatars\//);
  });
});

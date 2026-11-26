// @vitest-environment node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/avatar/route';
import { buildAvatarLibrary, generatedAvatarUrl, isSameAvatar } from '@/lib/avatar-presets';

const library = buildAvatarLibrary('System Admin');
const all = library.flatMap(category => category.presets);

describe('avatar library', () => {
  it('has unique ids and urls, and enough to choose from', () => {
    expect(new Set(all.map(preset => preset.id)).size).toBe(all.length);
    expect(new Set(all.map(preset => preset.url)).size).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(50);
  });

  it('only offers urls the profile action accepts', () => {
    for (const preset of all) {
      expect(preset.url.startsWith('/api/avatar') || preset.url.startsWith('/avatars/')).toBe(true);
    }
  });

  it('points every bundled avatar at a file that exists', () => {
    const files = all.filter(preset => preset.url.startsWith('/avatars/'));
    expect(files.length).toBe(20);
    for (const preset of files) {
      // Test reads repo files by paths from our own constant library, never from input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect(existsSync(join(process.cwd(), 'public', preset.url)), preset.url).toBe(true);
    }
  });

  it('renders every generated avatar through the image route', async () => {
    for (const preset of all.filter(item => item.url.startsWith('/api/avatar'))) {
      const response = await GET(new NextRequest(`http://localhost${preset.url}`));
      expect(response.status, preset.url).toBe(200);
      expect(response.headers.get('content-type')).toContain('image/svg+xml');
      expect(await response.text()).toContain('<svg');
    }
  });

  it("builds the initials tiles from the person's own initials", () => {
    const initials = library.find(category => category.id === 'initials')!;
    expect(initials.presets.every(preset => preset.url.includes('seed=SA'))).toBe(true);
  });
});

describe('isSameAvatar', () => {
  it('compares bundled files by path and generated ones by what they draw', () => {
    expect(isSameAvatar('/avatars/avatar-1.png', '/avatars/avatar-1.png')).toBe(true);
    expect(isSameAvatar('/avatars/avatar-1.png', '/avatars/avatar-2.png')).toBe(false);
    const url = generatedAvatarUrl('micah', 'Ada', '6366f1');
    // Older saved urls carried format=svg and a different parameter order.
    expect(
      isSameAvatar(
        url,
        '/api/avatar?radius=50&seed=Ada&style=micah&backgroundColor=6366F1&format=svg'
      )
    ).toBe(true);
    expect(isSameAvatar(url, generatedAvatarUrl('micah', 'Grace', '6366f1'))).toBe(false);
    expect(isSameAvatar(null, url)).toBe(false);
  });
});

describe('/api/avatar', () => {
  it('does not fail on a literal percent sign in the seed', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/avatar?style=initials&seed=100%25')
    );
    expect(response.status).toBe(200);
  });

  it('keeps initials in other scripts instead of dropping them', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/avatar?style=initials&seed=${encodeURIComponent('दू')}`)
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('द');
  });
});

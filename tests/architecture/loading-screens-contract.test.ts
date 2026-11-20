import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Incident routes are reserved for the next release and keep their own loading screens.
const EXCLUDED = [join('incidents', 'loading.tsx'), join('incidents', '[id]', 'loading.tsx')];
const APP = join('src', 'app', '(app)');

function loadingFiles(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative walk
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative walk
    if (statSync(path).isDirectory()) return loadingFiles(path);
    return name === 'loading.tsx' ? [path] : [];
  });
}

describe('loading screens contract', () => {
  const files = loadingFiles(APP).filter(f => !EXCLUDED.some(e => f.endsWith(e)));

  it('finds the route loading files', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files)('%s uses the shared page skeleton presets and stays tiny', file => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative path
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(/from '@\/components\/patterns'/);
    expect(source.split('\n').length).toBeLessThanOrEqual(20);
  });
});

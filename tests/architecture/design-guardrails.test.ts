// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Ratchets: each count may only go down. When you fix some, lower the ceiling to match.
const ROOTS = [join('src', 'components'), join('src', 'app')];

// Incident surfaces, status pages and emails legitimately need raw hex (inline email styles, tenant brand colours).
const HEX_EXCLUDED = [
  `${sep}incident${sep}`,
  `${sep}incidents${sep}`,
  `${sep}status-page${sep}`,
  `${sep}status-pages${sep}`,
  `${sep}email`,
];

function sourceFiles(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative walk
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative walk
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = ROOTS.flatMap(sourceFiles).map(path => ({
  path,
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative path
  source: readFileSync(path, 'utf8'),
}));

function count(pattern: RegExp, include: (path: string) => boolean = () => true) {
  return files
    .filter(file => include(file.path))
    .reduce((total, file) => total + (file.source.match(pattern)?.length ?? 0), 0);
}

describe('design guardrails', () => {
  it('scans the component and app trees', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('does not add native window.confirm/alert dialogs', () => {
    // lower this as you fix them
    const CEILING = 1;
    expect(count(/\bwindow\.confirm\(|(?<![\w.$])alert\(|\bwindow\.alert\(/g)).toBeLessThanOrEqual(
      CEILING
    );
  });

  it('does not add hex colour literals in class names', () => {
    // lower this as you fix them
    const CEILING = 10;
    const counted = count(
      /\b(?:bg|text|border)-\[#/g,
      path => !HEX_EXCLUDED.some(excluded => path.includes(excluded))
    );
    expect(counted).toBeLessThanOrEqual(CEILING);
  });

  it('does not add arbitrary font sizes', () => {
    // lower this as you fix them
    const CEILING = 1381;
    expect(count(/\btext-\[\d/g)).toBeLessThanOrEqual(CEILING);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Next.js refuses to load a `'use server'` module that exports anything but async functions, and the
 * failure only shows in a production build (the page that imports the actions renders an error).
 * Types are erased, so `export type` is fine; `export const`, `export { schema }` and similar are not.
 */
const ROOTS = ['src/app/(app)/settings/intelligence', 'src/app/(app)/incidents'];

function findServerActionFiles(dir: string): string[] {
  const out: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks fixed repository roots
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks fixed repository roots
    if (statSync(path).isDirectory()) out.push(...findServerActionFiles(path));
    else if (/\.tsx?$/.test(name)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks fixed repository roots
      const source = readFileSync(path, 'utf8');
      if (/^\s*['"]use server['"];?/.test(source)) out.push(path);
    }
  }
  return out;
}

const NON_FUNCTION_EXPORT =
  /^export\s+(?:const|let|var|class|enum|\{|\*|default\s+(?!async\s+function))/gm;

function nonFunctionExports(source: string): string[] {
  return (source.match(NON_FUNCTION_EXPORT) ?? []).filter(
    line => !/^export\s+\{\s*type\b/.test(line)
  );
}

const files = ROOTS.flatMap(root => findServerActionFiles(join(process.cwd(), root))).map(file =>
  relative(process.cwd(), file)
);

describe("intelligence 'use server' modules", () => {
  it('finds the action modules', () => {
    expect(files).toContain('src/app/(app)/settings/intelligence/noise-controls/actions.ts');
    expect(files).toContain(
      'src/app/(app)/settings/intelligence/noise-controls/preview-actions.ts'
    );
  });

  it.each(files)('%s exports only async functions and types', file => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- files found under fixed roots
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(nonFunctionExports(source)).toEqual([]);
  });

  it('flags a re-exported schema, so the check cannot pass vacuously', () => {
    expect(
      nonFunctionExports(
        "'use server';\nexport type A = 1;\nexport async function f() {}\nexport { schema };\nexport const x = 1;"
      )
    ).toEqual(['export {', 'export const']);
  });
});

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every Intelligence server action and API route must check who is calling before it does anything. A new
 * one added without a check fails here, instead of shipping as an open door. The guards recognised are the
 * capability and actor helpers this codebase uses for that purpose, and the three shared route guards
 * (`authenticate`, `conversationActor`, `readSquireRequest`), each of which checks origin and session.
 */
const root = process.cwd();
const GUARD =
  /assertCapability\(|getCurrentAuthorizationActor\(|getUserPermissions\(|getCurrentUser\(|administrator\(|requireIntelligence\w*\(|authenticate\(|conversationActor\(|readSquireRequest\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Each exported function with its own body, split at the next top-level export. */
function exportedFunctions(source: string): Array<{ name: string; body: string }> {
  return source
    .split(/\n(?=export (?:async )?function )/)
    .slice(1)
    .map(part => ({
      name: /^export (?:async )?function (\w+)/.exec(part)?.[1] ?? '?',
      body: part.split(/\nexport /)[0] ?? part,
    }));
}

describe('Intelligence entry points check the caller first', () => {
  const actionFiles = walk(join(root, 'src/app/(app)/settings/intelligence')).filter(
    file =>
      /\.tsx?$/.test(file) &&
      /^\s*['"]use server['"]/.test(readFileSync(file, 'utf8').slice(0, 200))
  );
  const routeFiles = walk(join(root, 'src/app/api/intelligence')).filter(file =>
    file.endsWith('route.ts')
  );

  it('finds the actions and routes it is meant to guard', () => {
    expect(actionFiles.length).toBeGreaterThan(10);
    expect(routeFiles.length).toBeGreaterThan(8);
  });

  it.each(actionFiles.map(file => [relative(root, file), file]))(
    'every server action in %s calls an authorization helper',
    (_name, file) => {
      const unguarded = exportedFunctions(readFileSync(file, 'utf8'))
        .filter(fn => !GUARD.test(fn.body))
        .map(fn => fn.name);
      expect(unguarded).toEqual([]);
    }
  );

  it.each(routeFiles.map(file => [relative(root, file), file]))(
    'every handler in %s resolves the signed-in actor',
    (_name, file) => {
      const unguarded = exportedFunctions(readFileSync(file, 'utf8'))
        .filter(fn => /^(GET|POST|PUT|PATCH|DELETE)$/.test(fn.name) && !GUARD.test(fn.body))
        .map(fn => fn.name);
      expect(unguarded).toEqual([]);
    }
  );
});

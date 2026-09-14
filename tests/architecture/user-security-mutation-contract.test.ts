/* eslint-disable security/detect-non-literal-fs-filename */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function findFiles(dir: string, ext = '.ts'): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.next') {
        files.push(...findFiles(full, ext));
      }
    } else if (full.endsWith(ext) || full.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

const ALLOWED_SECURITY_MUTATION_FILES = new Set([
  'src/lib/users/admin-invariants.ts',
  'src/lib/auth.ts',
  'src/lib/password-reset.ts',
  'src/app/set-password/actions.ts',
  'src/app/(app)/settings/security/actions.ts',
  'src/app/(app)/teams/actions.ts',
  'src/lib/teams/membership-commands.ts',
]);

function hasSecurityFieldMutation(content: string): boolean {
  const updateRegex = /\buser\.(?:update|updateMany)\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = updateRegex.exec(content)) !== null) {
    const body = match[1];
    const dataMatch = body.match(/\bdata\s*:\s*\{([^}]*)\}/);
    if (dataMatch && /\b(role|status|tokenVersion)\s*:/.test(dataMatch[1])) {
      return true;
    }
  }
  return false;
}

describe('user security mutation contract', () => {
  it('prevents direct writes to role, status, or tokenVersion outside approved security modules', () => {
    const srcFiles = findFiles('src');
    const unauthorizedMutations: string[] = [];

    for (const file of srcFiles) {
      const normalized = file.replace(/\\/g, '/');
      if (ALLOWED_SECURITY_MUTATION_FILES.has(normalized)) continue;

      const content = readFileSync(file, 'utf8');
      if (hasSecurityFieldMutation(content)) {
        unauthorizedMutations.push(normalized);
      }
    }

    expect(
      unauthorizedMutations,
      `Found direct user security mutations outside approved security boundaries: ${unauthorizedMutations.join(', ')}`
    ).toEqual([]);
  });

  it('all approved security modules invalidate session security projection', () => {
    for (const file of ALLOWED_SECURITY_MUTATION_FILES) {
      const content = readFileSync(file, 'utf8');
      expect(
        content.includes('invalidateSessionSecurityProjection') ||
          content.includes('updateUserSecurityState') ||
          content.includes('bulkUpdateUserSecurityState'),
        `${file} must invalidate session security projections`
      ).toBe(true);
    }
  });
});

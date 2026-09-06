import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');
const API_ROOT = join(SRC_ROOT, 'app', 'api');
const APP_ROOT = join(SRC_ROOT, 'app');
const LEGACY_FRIENDLY_ERROR_PATH = join(SRC_ROOT, 'lib', 'user-friendly-errors.ts');
const ERROR_IDENTIFIER = String.raw`(?:error|err|e|[A-Za-z_$][\w$]*(?:Error|Err))`;
const MESSAGE_ALIAS = String.raw`(?:message|msg)`;

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const absolute = join(root, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) files.push(...sourceFiles(absolute));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(absolute);
  }
  return files;
}

function serverActionFiles(): string[] {
  return sourceFiles(APP_ROOT).filter(file => {
    const name = basename(file);
    return name === 'actions.ts' || name.endsWith('-actions.ts');
  });
}

function findViolations(pattern: RegExp, files = sourceFiles(API_ROOT)): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (pattern.test(source)) violations.push(relative(process.cwd(), file));
    pattern.lastIndex = 0;
  }
  return violations;
}

describe('public API error contract architecture', () => {
  it('does not derive HTTP or domain semantics from error-message text', () => {
    const methodMatching = new RegExp(
      String.raw`\b${ERROR_IDENTIFIER}(?:\?\.|\.)message(?:\?\.|\.)(?:includes|startsWith|endsWith|match|search)\s*\(`,
      'g'
    );
    const directComparison = new RegExp(
      String.raw`\b${ERROR_IDENTIFIER}(?:\?\.|\.)message\s*(?:===|!==|==|!=)\s*['"\x60]`,
      'g'
    );
    const normalizedMethodMatching = new RegExp(
      String.raw`\bconst\s+${MESSAGE_ALIAS}\s*=\s*${ERROR_IDENTIFIER}\s+instanceof\s+Error\s*\?\s*${ERROR_IDENTIFIER}(?:\?\.|\.)message[\s\S]{0,1600}?\b${MESSAGE_ALIAS}(?:\?\.|\.)(?:includes|startsWith|endsWith|match|search)\s*\(`,
      'g'
    );
    const normalizedComparison = new RegExp(
      String.raw`\bconst\s+${MESSAGE_ALIAS}\s*=\s*${ERROR_IDENTIFIER}\s+instanceof\s+Error\s*\?\s*${ERROR_IDENTIFIER}(?:\?\.|\.)message[\s\S]{0,1600}?\b${MESSAGE_ALIAS}\s*(?:===|!==|==|!=)\s*['"\x60]`,
      'g'
    );

    const violations = new Set([
      ...findViolations(methodMatching),
      ...findViolations(directComparison),
      ...findViolations(normalizedMethodMatching),
      ...findViolations(normalizedComparison),
    ]);

    expect(
      [...violations],
      'Public API routes must branch on AppError/code/type, never English error text.'
    ).toEqual([]);
  });

  it('does not flatten server-action errors through presentation helpers', () => {
    const violations = findViolations(/\bgetUserFacingErrorMessage\s*\(/g, serverActionFiles());
    expect(
      violations,
      'Server actions should preserve AppError identity instead of translating it into presentation strings.'
    ).toEqual([]);
  });

  it('removes the legacy friendly-error shim and prevents source from importing it again', () => {
    expect(existsSync(LEGACY_FRIENDLY_ERROR_PATH)).toBe(false);

    const violations = sourceFiles(SRC_ROOT).filter(file => {
      const source = readFileSync(file, 'utf8');
      return source.includes('user-friendly-errors') || /\bgetUserFriendlyError\b/.test(source);
    });

    expect(
      violations.map(file => relative(process.cwd(), file)),
      'Production source must use the code-first user-facing-error API directly.'
    ).toEqual([]);
  });

  it('keeps shared API and integration boundaries independent of presentation helpers', () => {
    const sources = [
      readFileSync('src/lib/api-response.ts', 'utf8'),
      readFileSync('src/lib/integrations/app-error.ts', 'utf8'),
    ];

    for (const source of sources) {
      expect(source).not.toContain('user-facing-error');
      expect(source).not.toContain('getUserFacingErrorMessage');
    }
  });
});

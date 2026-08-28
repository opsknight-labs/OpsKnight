import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const API_ROOT = join(process.cwd(), 'src', 'app', 'api');
const APP_ROOT = join(process.cwd(), 'src', 'app');
const LEGACY_FRIENDLY_ERROR_PATH = join(process.cwd(), 'src', 'lib', 'user-friendly-errors.ts');
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

  it('does not call the legacy friendly-error compatibility shim from route handlers', () => {
    const violations = findViolations(/\bgetUserFriendlyError\s*\(/g);
    expect(
      violations,
      'API routes should use AppError + jsonError instead of legacy presentation helpers.'
    ).toEqual([]);
  });

  it('does not flatten server-action errors through the legacy compatibility shim', () => {
    const violations = findViolations(/\bgetUserFriendlyError\s*\(/g, serverActionFiles());
    expect(
      violations,
      'Server actions should preserve AppError identity instead of translating it back into string-only errors.'
    ).toEqual([]);
  });

  it('keeps the legacy compatibility shim free of semantic message inference', () => {
    const source = readFileSync(LEGACY_FRIENDLY_ERROR_PATH, 'utf8');

    expect(source).not.toMatch(/\.(?:includes|startsWith|endsWith|match|search)\s*\(/);
    expect(source).not.toMatch(
      /unauthori[sz]ed|required|not found|network|timeout|unique constraint|foreign key constraint/i
    );
  });

  it('keeps shared API and integration boundaries independent of the legacy shim', () => {
    const files = [
      join(process.cwd(), 'src', 'lib', 'api-response.ts'),
      join(process.cwd(), 'src', 'lib', 'integrations', 'app-error.ts'),
    ];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('user-friendly-errors');
      expect(source).not.toContain('getUserFriendlyError');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const API_ROOT = join(process.cwd(), 'src', 'app', 'api');
const APP_ROOT = join(process.cwd(), 'src', 'app');
const FRIENDLY_ERROR_FORMATTER = join(process.cwd(), 'src', 'lib', 'user-friendly-errors.ts');
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

  it('does not call the legacy friendly-error translator from route handlers', () => {
    const violations = findViolations(/\bgetUserFriendlyError\s*\(/g);
    expect(
      violations,
      'getUserFriendlyError is a compatibility boundary; API routes should use AppError + jsonError.'
    ).toEqual([]);
  });

  it('does not flatten server-action errors through the legacy friendly-error translator', () => {
    const violations = findViolations(/\bgetUserFriendlyError\s*\(/g, serverActionFiles());
    expect(
      violations,
      'Server actions should preserve AppError identity instead of translating it back into string-only errors.'
    ).toEqual([]);
  });

  it('keeps the UI compatibility formatter free of English-text classification rules', () => {
    const source = readFileSync(FRIENDLY_ERROR_FORMATTER, 'utf8');
    expect(source).not.toMatch(/\.includes\s*\(/);
    expect(source).not.toMatch(/\.startsWith\s*\(/);
    expect(source).not.toMatch(/\.endsWith\s*\(/);
    expect(source).not.toMatch(/\.match\s*\(/);
    expect(source).not.toMatch(/\.search\s*\(/);
    expect(source).not.toMatch(/new\s+RegExp\s*\(/);
  });
});
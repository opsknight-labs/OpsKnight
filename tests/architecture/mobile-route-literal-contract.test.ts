import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MOBILE_DIRS = ['src/components/mobile', 'src/app/(mobile)/m'];

// Desktop-surface route roots. Mobile UI must reach these through
// `appRoutes`/`toMobilePath` (which always resolve to the `/m/**` mirror),
// never as a hardcoded literal — a mobile route must never depend on
// middleware guessing it should have been `/m/...`.
const DESKTOP_ROUTE_ROOTS = [
  'login',
  'incidents',
  'services',
  'teams',
  'users',
  'policies',
  'schedules',
  'analytics',
  'notifications',
  'postmortems',
  'settings',
  'forgot-password',
];

const FORBIDDEN_LITERAL = new RegExp(
  `(?:href|router\\.push|router\\.replace|redirect)\\s*[=(]\\s*["'\`]\\/(?:${DESKTOP_ROUTE_ROOTS.join('|')})(?:["'\`/?])`,
  'g'
);

// Explicit, labelled escape hatches (e.g. "Open desktop workspace") are the
// only allowed exception, and those already route through /api/prefer-desktop
// rather than a literal desktop page path, so no file-level exemption list
// is required today. Add one here only alongside a genuine, reviewed case.
const EXEMPT_FILES = new Set<string>();

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('mobile route-literal architecture contract', () => {
  it('never hardcodes a desktop-surface route literal in mobile UI code', () => {
    const violations: string[] = [];

    for (const dir of MOBILE_DIRS) {
      for (const file of listSourceFiles(dir)) {
        if (EXEMPT_FILES.has(file)) continue;
        const content = fs.readFileSync(file, 'utf8');
        const matches = content.match(FORBIDDEN_LITERAL);
        if (matches) violations.push(`${file}: ${matches.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

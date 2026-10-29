import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MOBILE_DIRS = [
  'src/components/mobile',
  'src/app/(mobile)/m',
  // Mobile login/recovery aliases: thin re-exports of the shared auth pages,
  // but a wrong-surface redirect nested inside them is exactly the bug class
  // this contract exists to catch.
  'src/app/(public)/m',
];

// Desktop-surface route roots. Mobile UI must reach these through
// `appRoutes`/`toMobilePath` (which always resolve to the `/m/**` mirror),
// never as a hardcoded literal — a mobile route must never depend on
// middleware guessing it should have been `/m/...`.
//
// Kept as a literal (not built via `new RegExp(...)`) so this stays a fixed,
// non-attacker-controlled pattern rather than a dynamic-regex construction
// that static analysis would otherwise need to flag. If you add a route
// root here, add it to both this comment and the alternation below.
// login | incidents | services | teams | users | policies | schedules |
// analytics | notifications | postmortems | settings | forgot-password
const FORBIDDEN_LITERAL =
  /(?:href|router\.push|router\.replace|redirect)\s*[=(]\s*["'`]\/(?:login|incidents|services|teams|users|policies|schedules|analytics|notifications|postmortems|settings|forgot-password)(?:["'`/?])/g;

// Explicit, labelled escape hatches (e.g. "Open desktop workspace") are the
// only allowed exception, and those already route through /api/prefer-desktop
// rather than a literal desktop page path, so no file-level exemption list
// is required today. Add one here only alongside a genuine, reviewed case.
const EXEMPT_FILES = new Set<string>();

function listSourceFiles(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed, hardcoded MOBILE_DIRS/recursion, not user input
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed, hardcoded MOBILE_DIRS/recursion, not user input
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// The shared canonical login page is rendered for both surfaces (the mobile
// alias under src/app/(public)/m/login is a thin re-export of it), so any
// signout destination it hardcodes must also stay surface-aware.
const SHARED_AUTH_PAGES = ['src/app/login/page.tsx'];

describe('mobile route-literal architecture contract', () => {
  it('never hardcodes a desktop-surface route literal in mobile UI code', () => {
    const violations: string[] = [];

    for (const dir of MOBILE_DIRS) {
      for (const file of listSourceFiles(dir)) {
        if (EXEMPT_FILES.has(file)) continue;
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- file discovered from fixed MOBILE_DIRS, not user input
        const content = fs.readFileSync(file, 'utf8');
        const matches = content.match(FORBIDDEN_LITERAL);
        if (matches) violations.push(`${file}: ${matches.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  // The direct-literal check above misses a desktop route hidden as a query
  // value one level deeper, e.g. `redirect('/api/auth/signout?callbackUrl=
  // /login?error=...')` -- exactly how a mobile session-expiry redirect
  // previously escaped to the desktop login page. Decode and inspect the
  // actual signout destination instead of pattern-matching the outer string.
  it('never signs a mobile flow out onto the desktop login page', () => {
    const violations: string[] = [];
    const signoutCallback = /\/api\/auth\/signout\?callbackUrl=([^'"`\s)]+)/g;

    const files = MOBILE_DIRS.flatMap(listSourceFiles).concat(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed SHARED_AUTH_PAGES literal list, not user input
      SHARED_AUTH_PAGES.filter(file => fs.existsSync(file))
    );

    for (const file of files) {
      if (EXEMPT_FILES.has(file)) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- file discovered from fixed MOBILE_DIRS/SHARED_AUTH_PAGES, not user input
      const content = fs.readFileSync(file, 'utf8');
      for (const match of content.matchAll(signoutCallback)) {
        const raw = match[1];
        let decoded = raw;
        try {
          decoded = decodeURIComponent(raw);
        } catch {
          // Not URL-encoded; inspect the raw literal as-is.
        }
        if (decoded === '/login' || decoded.startsWith('/login?') || decoded.startsWith('/login#')) {
          violations.push(`${file}: signs out to desktop "${decoded}" (use forcedSignOutUrl)`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

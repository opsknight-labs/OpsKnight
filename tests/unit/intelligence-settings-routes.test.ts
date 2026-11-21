import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTELLIGENCE_SETTINGS_GROUPS,
  INTELLIGENCE_SETTINGS_ROOT,
  LEGACY_INTELLIGENCE_ROUTES,
  intelligenceSettingsHref,
  intelligenceSettingsPath,
  legacyIntelligenceRedirect,
  serializeSearchParams,
} from '@/lib/intelligence/settings/routes';

const redirect = vi.hoisted(() =>
  vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  })
);
vi.mock('next/navigation', () => ({ redirect }));
// The page access rule is covered by tests/unit/access-control.test.ts; here only the redirect matters.
const requirePageAccess = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/access/server', () => ({ requirePageAccess }));

const APP_DIR = join(process.cwd(), 'src/app/(app)');
const SETTINGS_DIR = join(APP_DIR, 'settings/intelligence');
const pageFile = (route: string) => join(APP_DIR, route, 'page.tsx');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths
const read = (file: string) => readFileSync(file, 'utf8');

function walk(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks fixed repository roots
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks fixed repository roots
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every `id="…"` a settings page can render: the pages, their sections and the settings components. */
const renderedIds = new Set(
  [...walk(SETTINGS_DIR), ...walk(join(process.cwd(), 'src/components/settings'))].flatMap(file =>
    [...read(file).matchAll(/\bid="([a-z0-9-]+)"/g)].map(match => match[1])
  )
);

beforeEach(() => {
  redirect.mockClear();
});

describe('intelligence settings groups', () => {
  it('has exactly the five groups, in navigation order', () => {
    expect(INTELLIGENCE_SETTINGS_GROUPS.map(group => group.label)).toEqual([
      'Engine',
      'Noise controls',
      'Services & changes',
      'Assistant',
      'Evaluation & spend',
    ]);
  });

  it.each(INTELLIGENCE_SETTINGS_GROUPS.map(group => [group.label, group] as const))(
    '%s is a real page that renders every section it advertises',
    (_label, group) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths
      expect(existsSync(pageFile(group.href))).toBe(true);
      expect(read(pageFile(group.href))).not.toMatch(/legacyIntelligenceRedirect/);
      for (const section of group.sections) {
        expect(renderedIds, `${group.id}#${section.id}`).toContain(section.id);
      }
    }
  );

  it('gives every section one home: no id is advertised by two groups', () => {
    const ids = INTELLIGENCE_SETTINGS_GROUPS.flatMap(group =>
      group.sections.map(section => section.id)
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds links to a group and to its sections, and refuses unknown sections', () => {
    expect(intelligenceSettingsPath('engine')).toBe('/settings/intelligence');
    expect(intelligenceSettingsHref('services', 'alert-quality')).toBe(
      '/settings/intelligence/services#alert-quality'
    );
    expect(() => intelligenceSettingsHref('engine', 'alert-quality')).toThrow(/Unknown section/);
  });
});

describe('earlier routes', () => {
  it('covers every page that existed before the regrouping', () => {
    expect(LEGACY_INTELLIGENCE_ROUTES.map(route => route.from).sort()).toEqual([
      '/settings/intelligence/ai/memory',
      '/settings/intelligence/connections',
      '/settings/intelligence/insights',
      '/settings/intelligence/quality',
      '/settings/intelligence/response',
    ]);
  });

  it.each(LEGACY_INTELLIGENCE_ROUTES.map(route => [route.from, route] as const))(
    '%s redirects to an existing page and section, keeping the query string',
    async (from, route) => {
      const target = INTELLIGENCE_SETTINGS_GROUPS.find(group => group.id === route.group)!;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths
      expect(existsSync(pageFile(target.href))).toBe(true);
      expect(target.sections.map(section => section.id)).toContain(route.section);
      expect(LEGACY_INTELLIGENCE_ROUTES.map(legacy => legacy.from as string)).not.toContain(
        target.href
      );

      // The route's own page performs the redirect.
      const page = (await import(/* @vite-ignore */ pageFile(from))) as {
        default: (props: { searchParams?: Promise<Record<string, string>> }) => Promise<never>;
      };
      await expect(
        page.default({ searchParams: Promise.resolve({ serviceId: 'svc 1', q: 'pay' }) })
      ).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledWith(
        `${target.href}?serviceId=svc+1&q=pay#${route.section}`
      );

      redirect.mockClear();
      await expect(page.default({})).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledWith(`${target.href}#${route.section}`);
    }
  );

  it('keeps repeated parameters and drops undefined ones', () => {
    expect(serializeSearchParams({ a: ['1', '2'], b: undefined, c: 'x y' })).toBe('?a=1&a=2&c=x+y');
    expect(serializeSearchParams(undefined)).toBe('');
    expect(legacyIntelligenceRedirect('/settings/intelligence/quality', { after: 'abc' })).toBe(
      '/settings/intelligence/evaluation?after=abc#grouping-quality'
    );
  });
});

describe('links into intelligence settings', () => {
  const groupPaths = new Set<string>(INTELLIGENCE_SETTINGS_GROUPS.map(group => group.href));
  const legacyPaths = new Set<string>(LEGACY_INTELLIGENCE_ROUTES.map(route => route.from));
  const sectionsByPath = new Map<string, string[]>(
    INTELLIGENCE_SETTINGS_GROUPS.map(group => [
      group.href,
      group.sections.map(section => section.id),
    ])
  );
  // Anchors that exist on a page without being listed in its "on this page" links.
  const EXTRA_ANCHORS = new Set(['model-prices']);

  const links = walk(join(process.cwd(), 'src'))
    .filter(file => !file.endsWith('lib/intelligence/settings/routes.ts'))
    .flatMap(file =>
      [...read(file).matchAll(/["'`](\/settings\/intelligence[^"'`\s]*)["'`]/g)].map(
        match => [file.replace(`${process.cwd()}/`, ''), match[1]] as const
      )
    )
    // Imports of the colocated server actions are module paths, not links.
    .filter(([, link]) => !/actions$/.test(link));

  it('finds the links', () => {
    expect(links.length).toBeGreaterThan(20);
  });

  it('never links to a route that only redirects, and only to sections that exist', () => {
    const problems: string[] = [];
    for (const [file, link] of links) {
      const [pathAndQuery, fragment] = link.split('#');
      const path = pathAndQuery.split('?')[0].replace(/\/$/, '');
      if (file.includes('/settings/intelligence/') && file.endsWith('/page.tsx')) {
        // The redirect pages name their own (earlier) route.
        if (read(join(process.cwd(), file)).includes('legacyIntelligenceRedirect')) continue;
      }
      if (legacyPaths.has(path)) problems.push(`${file}: ${link} is a redirect`);
      else if (path.startsWith(`${INTELLIGENCE_SETTINGS_ROOT}/services/`)) continue;
      // The metric templates sub-page is a real page that kept its address under the earlier folder.
      else if (path === `${INTELLIGENCE_SETTINGS_ROOT}/response/metrics`) continue;
      else if (!groupPaths.has(path)) problems.push(`${file}: ${link} is not a settings page`);
      else if (
        fragment &&
        !fragment.includes('$') &&
        !sectionsByPath.get(path)!.includes(fragment) &&
        !EXTRA_ANCHORS.has(fragment)
      ) {
        problems.push(`${file}: ${link} names an unknown section`);
      }
    }
    expect(problems).toEqual([]);
  });
});

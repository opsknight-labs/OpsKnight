import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { TtlCache } from './cache';

/**
 * "Suggested checks": investigation prompts shown with incident answers when the title matches a pattern.
 * The built-in library covers common failure shapes; administrators can add, edit, disable or reorder
 * templates, and the live library is cached for a minute. Patterns are plain substrings or very small
 * regular expressions, validated and bounded so a template can never make matching slow.
 */

export interface CheckTemplate {
  id: string;
  title: string;
  pattern: string;
  checks: string[];
  enabled: boolean;
  position: number;
  builtIn: boolean;
}

export const BUILT_IN_CHECKS: ReadonlyArray<Omit<CheckTemplate, 'id' | 'enabled' | 'builtIn'>> = [
  {
    title: 'Connection pool exhaustion',
    pattern: 'pool|too many connections|connection.*exhaust',
    position: 10,
    checks: [
      'Compare active connections, long-running transactions and pool utilization.',
      'Check pool limits against database capacity and recent configuration changes.',
    ],
  },
  {
    title: 'Disk or storage full',
    pattern: 'disk|no space|storage.*full|inode',
    position: 20,
    checks: [
      'Check filesystem and inode utilization and identify which paths are growing.',
      'Review retention and recent writes before removing data.',
    ],
  },
  {
    title: 'Certificates and TLS',
    pattern: 'cert|tls|ssl|handshake',
    position: 30,
    checks: [
      'Check certificate expiry, hostname coverage and the served certificate chain.',
      'Compare the failing endpoint with recent certificate or ingress changes.',
    ],
  },
  {
    title: 'Queues and consumer lag',
    pattern: 'kafka|queue|lag|backlog|consumer',
    position: 40,
    checks: [
      'Compare incoming traffic with consumer throughput, lag and error rates.',
      'Check consumer health and downstream dependencies for bottlenecks.',
    ],
  },
  {
    title: 'Errors, timeouts and latency',
    pattern: '5xx|error rate|timeout|latency|slow|p99',
    position: 50,
    checks: [
      'Compare error rate and latency with the last healthy period and recent deployments.',
      'Check upstream dependencies and resource saturation to narrow the affected path.',
    ],
  },
  {
    title: 'Memory and CPU saturation',
    pattern: 'oom|out of memory|memory|cpu|throttl',
    position: 60,
    checks: [
      'Compare memory and CPU with the limits and with the last healthy period; look for a leak or a traffic step.',
      'Check whether a recent deployment or configuration change altered limits or workload.',
    ],
  },
  {
    title: 'DNS and connectivity',
    pattern: 'dns|resolve|unreachable|connection refused|network',
    position: 70,
    checks: [
      'Confirm name resolution and reachability from the affected hosts, not only from your workstation.',
      'Compare with recent network, firewall or service-discovery changes.',
    ],
  },
];

const DEFAULT_CHECKS = [
  'Confirm the affected service, customer impact and whether the alert is still firing.',
  'Compare recent deployments, dependency health and similar resolved incidents.',
];

export const checkTemplateInputSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    pattern: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .refine(
        value => safePattern(value) !== null,
        'Use a plain phrase or a simple pattern with | and .* only'
      ),
    checks: z.array(z.string().trim().min(5).max(300)).min(1).max(6),
    enabled: z.boolean().default(true),
    position: z.number().int().min(0).max(10_000).default(100),
  })
  .strict();
export type CheckTemplateInput = z.infer<typeof checkTemplateInputSchema>;

/**
 * Compiles a template pattern. Only lower-case words, digits, spaces, `|` alternation and `.*` wildcards are
 * accepted; anything else is rejected, so the result is a simple, linear-time pattern.
 */
export function safePattern(pattern: string): RegExp | null {
  const value = pattern.trim().toLowerCase();
  if (!value || value.length > 200) return null;
  if (!/^[a-z0-9 _/%:.*|-]+$/.test(value)) return null;
  if (/\*\*|\.\.|\|\||^\||\|$/.test(value)) return null;
  const source = value
    .split('|')
    .map(part =>
      part
        .split('.*')
        .map(piece => piece.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
        .join('.*')
    )
    .join('|');
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- the source is built from an allow-listed alphabet above
    return new RegExp(source);
  } catch {
    return null;
  }
}

const cache = new TtlCache<CheckTemplate[]>(60_000, 1);

export async function listCheckTemplates(): Promise<CheckTemplate[]> {
  const cached = cache.get('all');
  if (cached) return cached;
  let custom: CheckTemplate[] = [];
  try {
    const rows = await prisma.squireCheckTemplate.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    custom = rows.map(row => ({
      id: row.id,
      title: row.title,
      pattern: row.pattern,
      checks: row.checks,
      enabled: row.enabled,
      position: row.position,
      builtIn: false,
    }));
  } catch {
    custom = [];
  }
  const all = [
    ...custom,
    ...BUILT_IN_CHECKS.map(template => ({
      ...template,
      id: `builtin:${template.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      enabled: true,
      builtIn: true,
    })),
  ].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  cache.set('all', all);
  return all;
}

/** The checks for an incident title: the first enabled matching template, or the generic defaults. */
export async function checksFor(
  title: string
): Promise<{ title: string | null; checks: string[] }> {
  const text = title.toLowerCase();
  for (const template of await listCheckTemplates()) {
    if (!template.enabled) continue;
    const pattern = safePattern(template.pattern);
    if (pattern?.test(text)) return { title: template.title, checks: template.checks.slice(0, 6) };
  }
  return { title: null, checks: DEFAULT_CHECKS };
}

export async function saveCheckTemplate(
  id: string | null,
  input: unknown,
  actorId: string
): Promise<CheckTemplate> {
  const parsed = checkTemplateInputSchema.parse(input);
  const row = id
    ? await prisma.squireCheckTemplate.update({ where: { id }, data: parsed })
    : await prisma.squireCheckTemplate.create({ data: { ...parsed, createdById: actorId } });
  cache.clear();
  return { ...row, builtIn: false };
}

export async function deleteCheckTemplate(id: string): Promise<boolean> {
  const result = await prisma.squireCheckTemplate.deleteMany({ where: { id } });
  cache.clear();
  return result.count > 0;
}

/** Test hook. */
export function resetCheckTemplateCache(): void {
  cache.clear();
}

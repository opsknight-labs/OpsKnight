import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2, CircleDashed, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { complianceControls } from '@/lib/compliance/controls';
import { evidenceSourceUrl } from '@/lib/compliance/evidence';
import { frameworks } from '@/lib/compliance/frameworks';
import { getReadiness } from '@/lib/compliance/readiness';
import type { ComplianceControl, ControlStatus } from '@/lib/compliance/types';
import { discoverSubjectData, subjectDiscoveryInputSchema } from '@/lib/privacy/discovery';
import { personalDataRegistry } from '@/lib/privacy/registry';
import { getUserPermissions } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import type { Prisma } from '@prisma/client';

const USER_SEARCH_PAGE_SIZE = 30;

const statusPresentation: Record<
  ControlStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  IMPLEMENTED: {
    label: 'Implemented',
    className: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  PARTIAL: {
    label: 'Partial',
    className: 'border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: TriangleAlert,
  },
  MISSING: {
    label: 'Missing',
    className: 'border-rose-600/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    icon: CircleDashed,
  },
};

const navigation = [
  ['overview', 'Overview'],
  ['security', 'Security'],
  ['privacy', 'Privacy'],
  ['cra', 'CRA'],
  ['evidence', 'Evidence'],
] as const;

export default async function SecurityCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; q?: string; page?: string }>;
}) {
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes(CAPABILITIES.ADMIN_MANAGE)) redirect('/settings');

  const params = await searchParams;
  const query = params.q?.trim().slice(0, 100) ?? '';
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const userWhere = (
    query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}
  ) satisfies Prisma.UserWhereInput;
  const parsedSubject = subjectDiscoveryInputSchema.safeParse({
    userId: params.userId,
    actorUserId: permissions.id,
  });
  const [users, userCount, selectedUser, discovery] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true, email: true, status: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      skip: (page - 1) * USER_SEARCH_PAGE_SIZE,
      take: USER_SEARCH_PAGE_SIZE,
    }),
    prisma.user.count({ where: userWhere }),
    parsedSubject.success
      ? prisma.user.findUnique({
          where: { id: parsedSubject.data.userId },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve(null),
    parsedSubject.success ? discoverSubjectData(parsedSubject.data) : Promise.resolve(null),
  ]);
  const pageCount = Math.max(1, Math.ceil(userCount / USER_SEARCH_PAGE_SIZE));
  const userSearchHref = (targetPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set('q', query);
    search.set('page', String(targetPage));
    return `/settings/security-compliance?${search.toString()}#privacy`;
  };
  const overall = getReadiness();
  const securityControls = complianceControls.filter(control => control.id.startsWith('SEC-'));
  const privacyControls = complianceControls.filter(control => control.id.startsWith('PRIV-'));
  const craControls = complianceControls.filter(control =>
    control.frameworks.some(framework => framework === 'CRA')
  );

  return (
    <div className="space-y-6 pb-12">
      <DetailHeroBanner
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'Security & Compliance' }}
        tag="Read-only readiness diagnostics"
        title="Security & Compliance"
        subtitle="Repository controls, known gaps, privacy coverage, and source evidence. Counts describe this curated catalogue; they are not certification or legal conclusions."
        icon={
          <div className="rounded-2xl border border-primary-foreground/25 bg-primary-foreground/15 p-3.5 text-primary-foreground">
            <ShieldCheck className="h-8 w-8" />
          </div>
        }
        stats={[
          {
            label: 'Implemented',
            value: String(overall.IMPLEMENTED),
            subtext: 'Catalogue controls',
          },
          { label: 'Partial', value: String(overall.PARTIAL), subtext: 'Gaps remain' },
          { label: 'Missing', value: String(overall.MISSING), subtext: 'Future work' },
        ]}
      />

      <nav aria-label="Compliance sections" className="flex flex-wrap gap-2">
        {navigation.map(([id, label]) => (
          <Link
            key={id}
            href={`#${id}`}
            className="rounded-full border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            {label}
          </Link>
        ))}
      </nav>

      <section id="overview" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-bold">Overview</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {frameworks.map(framework => {
            const counts = getReadiness(framework.id);
            return (
              <Card key={framework.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{framework.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Implemented</span>
                    <strong>{counts.IMPLEMENTED}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Partial</span>
                    <strong>{counts.PARTIAL}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Missing</span>
                    <strong>{counts.MISSING}</strong>
                  </div>
                  <a
                    href={framework.source}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs text-primary hover:underline"
                  >
                    Primary framework source
                  </a>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <ControlSection id="security" title="Security controls" controls={securityControls} />

      <section id="privacy" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-bold">Privacy</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal-data registry</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {personalDataRegistry.map(domain => (
                <div key={domain.domain} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{domain.domain}</strong>
                    <Badge variant="outline">
                      {domain.discoverable.toLowerCase().replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{domain.purpose.join(' · ')}</p>
                  <p className="mt-2 text-xs">
                    <span className="font-medium">Current retention:</span>{' '}
                    {domain.retention.current}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subject discovery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form method="get" className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor="subject-query" className="sr-only">
                  Search workspace users
                </label>
                <input
                  id="subject-query"
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder="Search by name or email"
                  className="min-h-10 flex-1 rounded-md border bg-background px-3 text-sm"
                />
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold"
                >
                  <Search className="h-4 w-4" /> Search users
                </button>
              </form>
              <form method="get" className="flex flex-col gap-2 sm:flex-row">
                {query && <input type="hidden" name="q" value={query} />}
                <input type="hidden" name="page" value={page} />
                <label htmlFor="userId" className="sr-only">
                  Workspace user
                </label>
                <select
                  id="userId"
                  name="userId"
                  defaultValue={params.userId ?? ''}
                  className="min-h-10 flex-1 rounded-md border bg-background px-3 text-sm"
                  required
                >
                  <option value="">Select a workspace user</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name} — {user.email} ({user.status})
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  <Search className="h-4 w-4" /> Discover counts
                </button>
              </form>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {userCount === 0
                    ? 'No users found'
                    : `Page ${Math.min(page, pageCount)} of ${pageCount} · ${userCount} users`}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link href={userSearchHref(page - 1)} className="font-medium hover:underline">
                      Previous
                    </Link>
                  )}
                  {page < pageCount && (
                    <Link href={userSearchHref(page + 1)} className="font-medium hover:underline">
                      Next
                    </Link>
                  )}
                </div>
              </div>
              {params.userId && !parsedSubject.success && (
                <p className="text-sm text-destructive">The selected user identifier is invalid.</p>
              )}
              {discovery && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    Direct relations for{' '}
                    {selectedUser
                      ? `${selectedUser.name} (${selectedUser.email})`
                      : discovery.subjectUserId}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(discovery.counts).map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                      >
                        <span className="break-all text-muted-foreground">{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-sm font-semibold">Coverage limits</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {discovery.limitations.map(item => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                This operation returns counts only. It does not export, change, anonymize, or delete
                data.
              </p>
            </CardContent>
          </Card>
        </div>
        <ControlCards controls={privacyControls} />
      </section>

      <ControlSection id="cra" title="CRA readiness" controls={craControls} />

      <section id="evidence" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-bold">Evidence sources</h2>
        <p className="text-sm text-muted-foreground">
          Links point to source on the main branch. A source path proves the implementation or
          documentation exists; it does not prove an operating control succeeded in a particular
          deployment.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          {complianceControls.map(control => (
            <Card key={control.id}>
              <CardContent className="pt-5">
                <p className="font-mono text-xs text-muted-foreground">{control.id}</p>
                <p className="font-semibold">{control.title}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {control.evidence.map(path => (
                    <a
                      key={path}
                      href={evidenceSourceUrl(path)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border px-2 py-1 font-mono text-xs text-primary hover:bg-muted"
                    >
                      {path}
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function ControlSection({
  id,
  title,
  controls,
}: {
  id: string;
  title: string;
  controls: readonly ComplianceControl[];
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <h2 className="text-xl font-bold">{title}</h2>
      <ControlCards controls={controls} />
    </section>
  );
}

function ControlCards({ controls }: { controls: readonly ComplianceControl[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {controls.map(control => {
        const presentation = statusPresentation[control.status];
        const StatusIcon = presentation.icon;
        return (
          <Card key={control.id}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{control.id}</p>
                  <h3 className="font-semibold">{control.title}</h3>
                </div>
                <Badge variant="outline" className={presentation.className}>
                  <StatusIcon className="mr-1 h-3 w-3" />
                  {presentation.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{control.implementation}</p>
              <p className="text-xs">
                <span className="font-semibold">Owner:</span> {control.owner.toLowerCase()}
              </p>
              {control.gaps.length > 0 && (
                <div className="rounded-md bg-muted/50 p-3 text-xs">
                  <span className="font-semibold">Remaining:</span> {control.gaps.join(' ')}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

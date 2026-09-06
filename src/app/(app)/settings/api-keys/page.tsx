import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import ApiKeysPanel, { type ApiKey } from '@/components/settings/ApiKeysPanel';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Badge } from '@/components/ui/shadcn/badge';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { Key, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';

export default async function ApiKeysSettingsPage() {
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: { id: true, timeZone: true, role: true },
      })
    : null;
  const timeZone = getUserTimeZone(user ?? undefined);
  const rawKeys = user
    ? await prisma.apiKey.findMany({
        where: user.role === 'ADMIN' ? undefined : { userId: user.id },
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const now = new Date();
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const formattedKeys: ApiKey[] = rawKeys.map(key => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    ownerEmail: key.user.email,
    createdAt: formatDateTime(key.createdAt, timeZone, { format: 'date' }),
    lastUsedAt: key.lastUsedAt
      ? formatDateTime(key.lastUsedAt, timeZone, { format: 'date' })
      : null,
    revokedAt: key.revokedAt ? formatDateTime(key.revokedAt, timeZone, { format: 'date' }) : null,
    expiresAt: key.expiresAt ? formatDateTime(key.expiresAt, timeZone, { format: 'date' }) : null,
    expired: !!key.expiresAt && key.expiresAt <= now,
  }));

  // Aggregated Stats
  const totalKeys = formattedKeys.length;
  const activeKeysCount = formattedKeys.filter(k => !k.revokedAt && !k.expired).length;
  const revokedKeysCount = formattedKeys.filter(k => Boolean(k.revokedAt)).length;
  const expiringSoonCount = rawKeys.filter(
    k => !k.revokedAt && k.expiresAt && k.expiresAt > now && k.expiresAt <= fourteenDaysFromNow
  ).length;

  return (
    <div className="space-y-6">
      {/* Centralized Glassmorphic Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'API Keys',
        }}
        tag="Programmatic Access & Integration Tokens"
        title="API Keys & Access Tokens"
        subtitle="Generate, rotate, and manage secure API credentials for automation, CI/CD pipelines, and telemetry ingestion."
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <Key className="h-8 w-8" />
          </div>
        }
        badges={
          <>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-[10px] font-bold uppercase tracking-wider"
            >
              Bearer Auth
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-xs"
            >
              {activeKeysCount} {activeKeysCount === 1 ? 'Key' : 'Keys'} Active
            </Badge>
          </>
        }
        stats={[
          {
            label: 'Total Keys',
            value: `${totalKeys}`,
            icon: <Key className="h-3.5 w-3.5" />,
            subtext: 'Configured in workspace',
          },
          {
            label: 'Active Keys',
            value: `${activeKeysCount}`,
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            subtext: 'Valid & unrevoked',
          },
          {
            label: 'Revoked',
            value: `${revokedKeysCount}`,
            icon: <ShieldAlert className="h-3.5 w-3.5" />,
            subtext: 'Access disabled',
          },
          {
            label: 'Expiring Soon',
            value: `${expiringSoonCount}`,
            icon: <Clock className="h-3.5 w-3.5" />,
            subtext: 'Within 14 days',
          },
        ]}
      />

      {/* Main Settings Section */}
      <SettingsSection
        title="Programmatic Credentials"
        description="Manage integration tokens and webhook authorization credentials across your workspace."
        footer={
          <p className="text-xs text-muted-foreground">
            API keys authenticate via HTTP Bearer headers. Never share API keys or commit secrets to
            public version control.
          </p>
        }
      >
        <ApiKeysPanel
          keys={formattedKeys}
          canCreateWriteKeys={
            user ? hasCapability(user.role, CAPABILITIES.OPERATIONS_MANAGE) : false
          }
        />
      </SettingsSection>
    </div>
  );
}

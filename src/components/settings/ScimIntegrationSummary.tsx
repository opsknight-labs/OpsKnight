import Link from 'next/link';
import { ArrowRight, KeyRound, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';

/**
 * Read-only SCIM status for the SSO workspace. The dedicated SCIM tab is the single place
 * that edits SCIM configuration or issues credentials, so this summary can never hold stale,
 * independently editable state. It shows only values OpsKnight actually persists.
 */
export default function ScimIntegrationSummary({
  enabled,
  hasSecretToken,
  tokenHint,
  source,
  updatedAt,
  tenantUrl,
}: {
  enabled: boolean;
  hasSecretToken: boolean;
  tokenHint: string | null;
  source: 'DATABASE' | 'ENV' | 'NONE';
  updatedAt: string | null;
  tenantUrl: string;
}) {
  const ready = enabled && hasSecretToken;
  return (
    <div className="min-w-0 rounded-lg border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-muted p-2.5 text-muted-foreground shrink-0">
            <UserCheck className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">SCIM 2.0 provisioning</h3>
              <Badge variant={ready ? 'success' : 'neutral'} className="text-2xs">
                {ready ? 'Enabled' : enabled ? 'Token required' : 'Disabled'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              SCIM owns account lifecycle (create, update, deactivate) independently of SSO sign-in.
              Configure it, and manage its token, in the dedicated SCIM section.
            </p>
          </div>
        </div>
        <Link
          href="/settings/system?section=scim"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors"
        >
          Manage SCIM
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <dl className="grid gap-3 text-xs sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Tenant URL</dt>
          <dd className="mt-0.5 break-all font-mono text-2xs text-foreground">{tenantUrl}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Bearer token</dt>
          <dd className="mt-0.5 flex items-center gap-1 text-foreground">
            <KeyRound className="h-3 w-3 text-muted-foreground" aria-hidden />
            {hasSecretToken
              ? `${tokenHint ? `…${tokenHint}` : 'Configured'}${source === 'ENV' ? ' (environment)' : ''}`
              : 'Not generated'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Last configuration change</dt>
          <dd className="mt-0.5 text-foreground">
            {updatedAt
              ? new Date(updatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
              : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

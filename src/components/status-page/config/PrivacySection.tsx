'use client';

import StatusPagePrivacySettings from '@/components/status-page/StatusPagePrivacySettings';
import { Network } from 'lucide-react';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { MAX_IP_ALLOW_ENTRIES } from '@/lib/status-pages/ip-allow-list';
import type { StatusPageConfigState } from './useStatusPageConfigState';

export default function PrivacySection({ ctx }: { ctx: StatusPageConfigState }) {
  const {
    privacySettings,
    setPrivacySettings,
    setFormData,
    ipAllowListText,
    setIpAllowListText,
    ipAllowListEntries,
    ipAllowListInvalid,
  } = ctx;
  return (
    <div className="flex flex-col gap-5">
      <StatusPagePrivacySettings
        settings={privacySettings}
        onChange={settings => {
          setPrivacySettings(settings);
          setFormData(prev => ({
            ...prev,
            ...(settings.showTeamInformation !== undefined
              ? { showServiceOwners: settings.showTeamInformation }
              : {}),
            ...(settings.showServiceRegions === false
              ? { showServicesByRegion: false, showRegionHeatmap: false }
              : {}),
            ...(settings.showServiceMetrics !== undefined
              ? { showMetrics: settings.showServiceMetrics }
              : {}),
            ...(settings.showRecentIncidents !== undefined
              ? { showIncidents: settings.showRecentIncidents }
              : {}),
          }));
        }}
      />
      <StatusPageSectionCard
        title="Network access"
        description="Optionally restrict a private page to your office or VPN. Visitors must still sign in."
        icon={<Network className="h-4 w-4" />}
      >
        <label
          htmlFor="status-page-ip-allow-list"
          className="block text-xs font-semibold text-foreground"
        >
          Allowed IP addresses and CIDR ranges
        </label>
        <textarea
          id="status-page-ip-allow-list"
          value={ipAllowListText}
          onChange={event => setIpAllowListText(event.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={'203.0.113.0/24\n2001:db8::/32'}
          aria-describedby="status-page-ip-allow-list-help"
          aria-invalid={ipAllowListInvalid.length > 0}
          disabled={!privacySettings.requireAuth}
          className="mt-1.5 w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-xs leading-5 text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
        />
        <p id="status-page-ip-allow-list-help" className="mt-1.5 text-[11px] text-muted-foreground">
          {!privacySettings.requireAuth
            ? 'Turn on sign-in above to use an allow-list.'
            : 'One per line. Empty means any network. Use only on pages served directly or behind a proxy configured to forward the real client address.'}{' '}
          {ipAllowListEntries.length}/{MAX_IP_ALLOW_ENTRIES} entries.
        </p>
        {ipAllowListInvalid.length > 0 && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            Not a valid address or CIDR range: {ipAllowListInvalid.slice(0, 3).join(', ')}
          </p>
        )}
      </StatusPageSectionCard>
    </div>
  );
}

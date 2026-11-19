'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Switch } from '@/components/ui/shadcn/switch';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { useBundlePreference } from '@/components/settings/useBundlePreference';
import type { NoiseOverview } from '@/lib/notification-noise/loader';
import { share, type NoiseReport } from '@/lib/notification-noise/report';
import { isNightHour } from '@/lib/oncall-load/metrics';

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** 24 bars, one per local hour. Decorative next to the sentence that states the busiest hour. */
function PagesByHour({ report }: { report: NoiseReport }) {
  const max = Math.max(...report.byHour.map(entry => entry.pages));
  const busiest = report.byHour.reduce((top, entry) => (entry.pages > top.pages ? entry : top));
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Most pages arrive around{' '}
        <span className="font-medium text-foreground">{hourLabel(busiest.hour)}</span> your time.
        Solid bars are the pages you acted on.
      </p>
      <div aria-hidden="true" className="flex h-16 items-end gap-0.5">
        {report.byHour.map(entry => (
          <div
            key={entry.hour}
            title={`${hourLabel(entry.hour)}: ${entry.pages} pages, ${entry.acted} acted on`}
            className="flex flex-1 flex-col justify-end overflow-hidden rounded-t-sm bg-primary/25"
            style={{ height: entry.pages ? `${Math.max(6, (entry.pages / max) * 100)}%` : '2px' }}
          >
            {/* The solid part is the share of that hour's pages you acted on. */}
            <div
              className="bg-primary"
              style={{ height: entry.pages ? `${(entry.acted / entry.pages) * 100}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="flex justify-between text-xs tabular-nums text-muted-foreground"
      >
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}

export default function NoiseSection({
  overview,
  suggestions,
}: {
  overview: NoiseOverview;
  /** Server-rendered InsightsPanel of the person's stored noise insights; null when there are none. */
  suggestions?: ReactNode;
}) {
  const { report } = overview;
  const bundle = useBundlePreference(overview.bundleLowUrgencyPages);
  const nightPages = report.byHour
    .filter(entry => isNightHour(entry.hour))
    .reduce((sum, entry) => sum + entry.pages, 0);

  return (
    <SettingsSection
      title="Noise"
      description="How often you are paged, how often it needed you, and ways to cut what did not"
    >
      <SettingsRow
        label="Bundle low-urgency pages"
        description="The first low-urgency page arrives at once. Others within five minutes arrive together as one. High-urgency pages are never bundled."
        htmlFor="bundle-low-urgency-pages"
      >
        <Switch
          id="bundle-low-urgency-pages"
          checked={bundle.enabled}
          disabled={bundle.saving}
          onCheckedChange={bundle.set}
        />
      </SettingsRow>

      {report.pages > 0 && (
        <SettingsRow
          label={`Last ${report.days} days`}
          description={`${report.pages} pages, ${share(report.acted, report.pages)}% acted on, ${report.autoResolved} resolved by themselves within minutes, ${nightPages} at night`}
        >
          <div className="space-y-5">
            <PagesByHour report={report} />
            <table className="w-full text-sm">
              <caption className="sr-only">Pages received and acted on, by service</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-2 font-medium">
                    Service
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Pages
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Acted on
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    <span className="sr-only">Tune</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.byService.slice(0, 5).map(service => (
                  <tr key={service.serviceId}>
                    <td className="max-w-0 truncate py-2 pr-3">{service.serviceName}</td>
                    <td className="py-2 text-right tabular-nums">{service.pages}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {share(service.acted, service.pages)}%
                    </td>
                    <td className="py-1 pl-3 text-right">
                      <Link
                        href={`/services/${encodeURIComponent(service.serviceId)}/notifications`}
                        aria-label={`Tune ${service.serviceName}`}
                        className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
                      >
                        Tune
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsRow>
      )}

      {suggestions && (
        <SettingsRow
          label="Suggestions"
          description="Each opens the setting; nothing changes until you save it there"
        >
          {suggestions}
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

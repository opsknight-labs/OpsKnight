'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Switch } from '@/components/ui/shadcn/switch';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { useBundlePreference } from '@/components/settings/useBundlePreference';
import type { NoiseOverview } from '@/lib/notification-noise/loader';
import { share, type NoiseReport } from '@/lib/notification-noise/report';

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
      </p>
      <div aria-hidden="true" className="flex h-16 items-end gap-0.5">
        {report.byHour.map(entry => (
          <div
            key={entry.hour}
            title={`${hourLabel(entry.hour)}: ${entry.pages} pages, ${entry.acted} acted on`}
            className="flex-1 rounded-t-sm bg-primary/70"
            style={{ height: entry.pages ? `${Math.max(6, (entry.pages / max) * 100)}%` : '2px' }}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="flex justify-between font-mono text-[10px] text-muted-foreground"
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

export default function NoiseSection({ overview }: { overview: NoiseOverview }) {
  const { report, insights } = overview;
  const bundle = useBundlePreference(overview.bundleLowUrgencyPages);

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
          description={`${report.pages} pages, ${share(report.acted, report.pages)}% acted on, ${report.autoResolved} resolved by themselves within minutes`}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SettingsRow>
      )}

      {insights.length > 0 && (
        <SettingsRow
          label="Suggestions"
          description="Each opens the setting; nothing changes until you save it there"
        >
          <ul className="divide-y divide-border">
            {insights.map(item => (
              <li
                key={`${item.kind}:${item.key}`}
                className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.summary}</p>
                </div>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="min-h-11 shrink-0 md:min-h-9"
                >
                  <Link href={item.draftHref} aria-label={`Review: ${item.title}`}>
                    Review
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

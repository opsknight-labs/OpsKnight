'use client';

import Link from 'next/link';
import { ChevronRight, Layers } from 'lucide-react';
import MobileSettingCard from '@/components/mobile/MobileSettingCard';
import { MobileSwitch } from '@/components/mobile/MobileSwitch';
import { useBundlePreference } from '@/components/settings/useBundlePreference';
import type { NoiseOverview } from '@/lib/notification-noise/loader';
import { share } from '@/lib/notification-noise/report';

/** Mobile counterpart of the settings "Noise" section: the opt-in, one summary line, the suggestions. */
export default function MobileNoiseCard({ overview }: { overview: NoiseOverview }) {
  const { report, insights } = overview;
  const bundle = useBundlePreference(overview.bundleLowUrgencyPages);

  return (
    <MobileSettingCard
      icon={<Layers className="h-5 w-5" aria-hidden="true" />}
      title="Bundle low-urgency pages"
      status={bundle.enabled ? 'On' : 'Off'}
      action={
        <MobileSwitch
          aria-label="Bundle low-urgency pages"
          checked={bundle.enabled}
          disabled={bundle.saving}
          onCheckedChange={bundle.set}
        />
      }
      description={
        <>
          The first low-urgency page arrives at once; others within five minutes arrive together.
          High-urgency pages are never bundled.
          {report.pages > 0 && (
            <span className="mt-2 block text-foreground">
              Last {report.days} days: {report.pages} pages, {share(report.acted, report.pages)}%
              acted on.
            </span>
          )}
        </>
      }
    >
      {insights.length > 0 && (
        <ul className="divide-y divide-border/70 border-t border-border/70">
          {insights.map(item => (
            <li key={`${item.kind}:${item.key}`}>
              <Link
                href={item.draftHref}
                className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm text-foreground"
              >
                <span className="min-w-0">{item.title}</span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MobileSettingCard>
  );
}

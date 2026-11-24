'use client';

import { useState, useTransition } from 'react';
import { notify as toast } from '@/lib/toast';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  runServiceReviewsNow,
  saveServiceReviewSettings,
  sendServiceReviewPreview,
  setTeamServicesInReview,
} from '@/app/(app)/settings/service-review-actions';

type Run = {
  period: string;
  kind: string;
  recipient: string;
  status: string;
  serviceCount: number;
  createdAt: string;
};

type Props = {
  config: {
    enabled: boolean;
    freezeWarningEnabled: boolean;
    dayOfMonth: number;
    hour: number;
    timeZone: string;
    summaryEmails: string[];
  };
  teams: Array<{ id: string; name: string; included: number; total: number }>;
  runs: Run[];
};

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong.');

/** Admin switch, schedule, summary recipients, team opt-in and recent runs. Everything is off by default. */
export default function ServiceReviewAdminPanel({ config, teams, runs }: Props) {
  const [form, setForm] = useState({ ...config, summaryEmails: config.summaryEmails.join(', ') });
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<void>) => startTransition(() => work().catch(fail));

  const save = () =>
    run(async () => {
      await saveServiceReviewSettings({
        enabled: form.enabled,
        freezeWarningEnabled: form.freezeWarningEnabled,
        dayOfMonth: Number(form.dayOfMonth),
        hour: Number(form.hour),
        timeZone: form.timeZone,
        summaryEmails: form.summaryEmails
          .split(',')
          .map(e => e.trim())
          .filter(Boolean),
      });
      toast.success('Service review settings saved');
    });

  return (
    <SettingsSection
      title="Monthly service reviews"
      description="A monthly digest of SLO attainment, error budget, downtime and incidents. Off until you turn it on; each person gets one email for only their own services."
      footer={
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={pending}>
            Save
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await sendServiceReviewPreview();
                toast.success(
                  r.sent ? 'Preview sent to your email' : 'Nothing to report in last month'
                );
              })
            }
          >
            Send preview to me
          </Button>
          <Button
            variant="outline"
            disabled={pending || !config.enabled}
            onClick={() =>
              run(async () => {
                const r = await runServiceReviewsNow();
                toast.success(
                  `Sent ${r.sent}, already sent ${r.alreadySent}, skipped ${r.skipped}, failed ${r.failed}`
                );
              })
            }
          >
            Run now
          </Button>
        </div>
      }
    >
      <SettingsRow label="Enable service reviews" description="Nothing is sent while this is off.">
        <Switch
          checked={form.enabled}
          onCheckedChange={enabled => setForm(f => ({ ...f, enabled }))}
          aria-label="Enable service reviews"
        />
      </SettingsRow>
      <SettingsRow
        label="Warn when an error budget is exhausted"
        description="Adds a banner on the business service and raises change risk. Advisory only, never blocks a deploy."
      >
        <Switch
          checked={form.freezeWarningEnabled}
          onCheckedChange={freezeWarningEnabled => setForm(f => ({ ...f, freezeWarningEnabled }))}
          aria-label="Warn when an error budget is exhausted"
        />
      </SettingsRow>
      <SettingsRow
        label="Schedule"
        description="Day of month (1 to 28) and hour in the time zone below."
        htmlFor="sr-day"
      >
        <div className="flex gap-2">
          <Input
            id="sr-day"
            type="number"
            min={1}
            max={28}
            className="w-20"
            aria-label="Day of month"
            value={form.dayOfMonth}
            onChange={e => setForm(f => ({ ...f, dayOfMonth: Number(e.target.value) }))}
          />
          <Input
            type="number"
            min={0}
            max={23}
            className="w-20"
            aria-label="Hour"
            value={form.hour}
            onChange={e => setForm(f => ({ ...f, hour: Number(e.target.value) }))}
          />
          <Input
            className="w-56"
            aria-label="Time zone"
            value={form.timeZone}
            onChange={e => setForm(f => ({ ...f, timeZone: e.target.value }))}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        label="Portfolio summary recipients"
        description="Existing users, by email, who also get the whole-portfolio summary."
        htmlFor="sr-summary"
      >
        <Input
          id="sr-summary"
          placeholder="cto@example.com, vp@example.com"
          value={form.summaryEmails}
          onChange={e => setForm(f => ({ ...f, summaryEmails: e.target.value }))}
        />
      </SettingsRow>
      <SettingsRow
        label="Services included"
        description="Choose teams whose business services appear in the review. Owners and teammates who opt in then receive it."
      >
        <ul className="space-y-2">
          {teams.length === 0 ? (
            <li className="text-sm text-muted-foreground">No teams own business services yet.</li>
          ) : null}
          {teams.map(team => (
            <li key={team.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {team.name}{' '}
                <span className="text-muted-foreground">
                  ({team.included} of {team.total})
                </span>
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await setTeamServicesInReview(team.id, true);
                      toast.success(`${r.count} services included`);
                    })
                  }
                >
                  Include all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await setTeamServicesInReview(team.id, false);
                      toast.success(`${r.count} services removed`);
                    })
                  }
                >
                  Remove all
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </SettingsRow>
      <SettingsRow
        label="Recent runs"
        description="One row per month and recipient; a rerun never sends again."
      >
        <ul className="space-y-1 text-sm">
          {runs.length === 0 ? <li className="text-muted-foreground">No runs yet.</li> : null}
          {runs.slice(0, 10).map(r => (
            <li key={`${r.period}-${r.kind}-${r.recipient}`} className="flex justify-between gap-3">
              <span>
                {r.period} · {r.kind === 'SUMMARY' ? 'Summary' : 'Digest'} · {r.recipient}
              </span>
              <span className="text-muted-foreground">
                {r.status.toLowerCase()} · {r.serviceCount} services
              </span>
            </li>
          ))}
        </ul>
      </SettingsRow>
    </SettingsSection>
  );
}

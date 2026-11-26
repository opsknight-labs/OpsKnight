'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { notify as toast } from '@/lib/toast';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { nextReviewRun } from '@/lib/business-services/reviews/period';
import TimeZoneSelect from '@/components/TimeZoneSelect';
import ConfirmDialog from '@/components/ConfirmDialog';
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

const RUN_STATUS: Record<string, string> = {
  SENT: 'Sent',
  SKIPPED: 'Skipped, nothing to report',
  FAILED: 'Failed',
  PENDING: 'Sending',
};

/** Admin switch, schedule, summary recipients, team opt-in and recent runs. Everything is off by default. */
export default function ServiceReviewAdminPanel({ config, teams, runs }: Props) {
  // Day and hour stay strings while typing: Number('') is 0, which would save an empty box as a valid value.
  const [form, setForm] = useState({
    ...config,
    dayOfMonth: String(config.dayOfMonth),
    hour: String(config.hour),
    summaryEmails: config.summaryEmails.join(', '),
  });
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  // Per action, so saving does not grey out the team buttons and one team does not block another.
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = useTransition();
  const [confirmRun, setConfirmRun] = useState(false);
  const busy = (key: string) => busyKeys.has(key);
  const run = (key: string, work: () => Promise<void>) => {
    setBusyKeys(current => new Set(current).add(key));
    startTransition(async () => {
      await work().catch(fail);
      setBusyKeys(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    });
  };
  const day = Number(form.dayOfMonth);
  const hour = Number(form.hour);
  let validZone = true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: form.timeZone });
  } catch {
    validZone = false;
  }
  const nextRun =
    form.enabled &&
    validZone &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= 28 &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    form.dayOfMonth.trim() !== '' &&
    form.hour.trim() !== ''
      ? nextReviewRun(new Date(), { dayOfMonth: day, hour, timeZone: form.timeZone })
      : null;

  const save = () =>
    run('save', async () => {
      if (form.dayOfMonth.trim() === '' || form.hour.trim() === '') {
        toast.error('Enter a day of the month and an hour.');
        return;
      }
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: form.timeZone });
      } catch {
        toast.error('Enter a valid IANA time zone, for example Europe/Berlin.');
        return;
      }
      const saved = await saveServiceReviewSettings({
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
      if (!saved.success) {
        toast.error(saved.error);
        return;
      }
      toast.success('Service review settings saved');
      router.refresh();
    });

  return (
    <SettingsSection
      title="Monthly service reviews"
      description="A monthly digest of SLO attainment, error budget, downtime and incidents. Off until you turn it on; each person gets one email for only their own services."
      footer={
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy('save')}>
            {busy('save') ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="outline"
            disabled={busy('preview')}
            onClick={() =>
              run('preview', async () => {
                const r = await sendServiceReviewPreview();
                if (!r.success) {
                  toast.error(r.error);
                  return;
                }
                toast.success(
                  r.sent ? 'Preview sent to your email' : 'Nothing to report in last month'
                );
              })
            }
          >
            {busy('preview') ? 'Sending…' : 'Send preview to me'}
          </Button>
          <Button
            variant="outline"
            disabled={busy('run') || !config.enabled}
            onClick={() => setConfirmRun(true)}
          >
            {busy('run') ? 'Sending reviews…' : 'Run now'}
          </Button>
          <ConfirmDialog
            isOpen={confirmRun}
            variant="info"
            title="Send the service reviews now?"
            message="Every included owner gets their review now, outside the schedule. Reviews already sent for this period are skipped, so nobody gets one twice."
            confirmText="Send now"
            cancelText="Not now"
            onCancel={() => setConfirmRun(false)}
            onConfirm={() => {
              setConfirmRun(false);
              run('run', async () => {
                const r = await runServiceReviewsNow();
                toast.success(
                  `Sent ${r.sent}, already sent ${r.alreadySent}, skipped ${r.skipped}, failed ${r.failed}`
                );
                router.refresh();
              });
            }}
          />
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
            onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))}
          />
          <Input
            type="number"
            min={0}
            max={23}
            className="w-20"
            aria-label="Hour"
            value={form.hour}
            onChange={e => setForm(f => ({ ...f, hour: e.target.value }))}
          />
          <div className="w-64">
            <TimeZoneSelect
              name="timeZone"
              id="sr-timezone"
              defaultValue={form.timeZone}
              onChange={timeZone => setForm(f => ({ ...f, timeZone }))}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {!form.enabled
            ? 'Turn on service reviews to schedule the next run.'
            : nextRun
              ? `Next run: ${formatDateTime(nextRun, form.timeZone, { format: 'datetime' })} (${form.timeZone})${form.timeZone === userTimeZone ? '' : `, ${formatDateTime(nextRun, userTimeZone, { format: 'datetime' })} your time`}.`
              : 'Enter a day from 1 to 28 and an hour from 0 to 23 to see the next run.'}
        </p>
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
                  disabled={busy(`team:${team.id}`) || team.included === team.total}
                  onClick={() =>
                    run(`team:${team.id}`, async () => {
                      const r = await setTeamServicesInReview(team.id, true);
                      toast.success(`${r.count} services included`);
                      router.refresh();
                    })
                  }
                >
                  Include all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy(`team:${team.id}`) || team.included === 0}
                  onClick={() =>
                    run(`team:${team.id}`, async () => {
                      const r = await setTeamServicesInReview(team.id, false);
                      toast.success(`${r.count} services removed`);
                      router.refresh();
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
            <li
              key={`${r.period}-${r.kind}-${r.recipient}`}
              className="flex flex-wrap justify-between gap-x-3"
            >
              <span>
                {r.period} · {r.kind === 'SUMMARY' ? 'Summary' : 'Digest'} · {r.recipient}
              </span>
              <span className="text-muted-foreground tabular-nums">
                <span
                  className={r.status === 'FAILED' ? 'font-medium text-destructive' : undefined}
                >
                  {RUN_STATUS[r.status] ?? r.status}
                </span>{' '}
                · {r.serviceCount} {r.serviceCount === 1 ? 'service' : 'services'} ·{' '}
                <time dateTime={r.createdAt}>
                  {formatDateTime(r.createdAt, userTimeZone, { format: 'datetime' })}
                </time>
              </span>
            </li>
          ))}
        </ul>
      </SettingsRow>
    </SettingsSection>
  );
}

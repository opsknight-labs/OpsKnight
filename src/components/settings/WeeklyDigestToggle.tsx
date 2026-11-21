'use client';

import { useState, useTransition } from 'react';
import { notify as toast } from '@/lib/toast';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Switch } from '@/components/ui/shadcn/switch';
import { setMyWeeklyDigest, setWorkspaceWeeklyDigest } from '@/app/(app)/settings/digest-actions';

/**
 * One switch for the weekly analytics summary. `scope="me"` is the user's own opt-out
 * (profile); `scope="workspace"` is the admin switch for everyone.
 */
export default function WeeklyDigestToggle({
  scope,
  enabled,
  workspaceEnabled = true,
  emailReady = true,
}: {
  scope: 'me' | 'workspace';
  enabled: boolean;
  /** For scope="me": when an admin turned it off, the user's switch can't send anything. */
  workspaceEnabled?: boolean;
  /** False when no email provider is configured: nothing can be sent yet. */
  emailReady?: boolean;
}) {
  const [checked, setChecked] = useState(enabled);
  const [isPending, startTransition] = useTransition();
  const me = scope === 'me';

  const onChange = (next: boolean) => {
    setChecked(next);
    startTransition(async () => {
      try {
        await (me ? setMyWeeklyDigest(next) : setWorkspaceWeeklyDigest(next));
        toast.success(next ? 'Weekly summary turned on' : 'Weekly summary turned off');
      } catch (error) {
        setChecked(!next);
        toast.error(error instanceof Error ? error.message : 'Could not save. Try again.');
      }
    });
  };

  return (
    <SettingsSection
      title="Weekly analytics summary"
      description={
        me
          ? 'Every Monday: last week’s incidents, response times, SLA and on-call load for everything you can see.'
          : 'Every Monday, each person with analytics access gets a summary of last week for everything they can see. People can still opt out themselves.'
      }
    >
      <SettingsRow
        label={me ? 'Email me the weekly summary' : 'Send the weekly summary to everyone'}
        description={
          me && !workspaceEnabled
            ? 'Turned off for this workspace by an administrator.'
            : !emailReady
              ? me
                ? 'No email provider is set up yet, so nothing is sent until an administrator configures one.'
                : 'No email provider is configured yet. Summaries start once one is set up above.'
              : 'On by default. Separate from incident alert emails; saved weekly views are managed on the Analytics page.'
        }
      >
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          disabled={isPending || (me && !workspaceEnabled)}
          aria-label={
            me
              ? 'Email me the weekly analytics summary'
              : 'Send the weekly analytics summary to everyone'
          }
        />
      </SettingsRow>
    </SettingsSection>
  );
}

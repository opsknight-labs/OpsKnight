'use client';

import { useActionState, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { updateNotificationPreferences } from '@/app/(app)/settings/actions';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Loader2, Save } from 'lucide-react';
import { notify as toast } from '@/lib/toast';

type State = {
  error?: string | null;
  success?: boolean;
};

type Props = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
  phoneNumber: string | null;
};

export default function NotificationPreferencesForm({
  emailEnabled,
  smsEnabled,
  pushEnabled,
  whatsappEnabled,
  phoneNumber: initialPhoneNumber,
}: Props) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<State, FormData>(
    updateNotificationPreferences,
    { error: null, success: false }
  );

  const [emailChecked, setEmailChecked] = useState(emailEnabled);
  const [smsChecked, setSmsChecked] = useState(smsEnabled);
  const [pushChecked, setPushChecked] = useState(pushEnabled);
  const [whatsappChecked, setWhatsappChecked] = useState(whatsappEnabled);
  const [phone, setPhone] = useState(initialPhoneNumber || '');
  const [pushPermissionStatus, setPushPermissionStatus] = useState<
    'granted' | 'denied' | 'default' | 'unsupported'
  >(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  const requestPushPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        setPushPermissionStatus(permission);
        if (permission === 'granted') {
          setPushChecked(true);
          toast.success('Browser notification permission granted!');
        } else if (permission === 'denied') {
          toast.error('Notifications blocked by browser. Please enable them in browser settings.');
        }
      } catch (_err) {
        toast.error('Failed to request notification permission');
      }
    }
  };

  useEffect(() => {
    if (state?.success) {
      toast.success('Notification preferences saved successfully');
      const timer = setTimeout(() => {
        router.refresh();
      }, 500);
      return () => clearTimeout(timer);
    }
    if (state?.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  const phoneRow = (
    <SettingsRow
      label="Phone Number"
      description="E.164 format (e.g., +1234567890)"
      className="bg-muted/10 border-l-2 border-l-primary/30 ml-4 pl-4"
    >
      <Input
        type="tel"
        value={phone}
        onChange={e => setPhone(e.target.value)}
        placeholder="+1234567890"
        className="max-w-[250px]"
      />
    </SettingsRow>
  );

  return (
    <form action={formAction} className="space-y-6">
      {/* Hidden inputs to submit values */}
      <input type="hidden" name="emailNotificationsEnabled" value={emailChecked ? 'on' : 'off'} />
      <input type="hidden" name="smsNotificationsEnabled" value={smsChecked ? 'on' : 'off'} />
      <input type="hidden" name="pushNotificationsEnabled" value={pushChecked ? 'on' : 'off'} />
      <input
        type="hidden"
        name="whatsappNotificationsEnabled"
        value={whatsappChecked ? 'on' : 'off'}
      />
      <input type="hidden" name="phoneNumber" value={phone} />
      <input type="hidden" name="phoneNumberWhatsApp" value={phone} />

      <SettingsSection
        title="Notification Channels"
        description="Configure how you receive incident alerts and team updates"
        footer={
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Changes require explicit save</p>
            <Button type="submit" disabled={isPending} size="sm">
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" /> Save Preferences
                </>
              )}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col">
          <SettingsRow label="Email Notifications" description="Receive alerts via email">
            <Switch checked={emailChecked} onCheckedChange={setEmailChecked} />
          </SettingsRow>

          <SettingsRow
            label="SMS Notifications"
            description="Receive text message alerts for incidents"
          >
            <Switch checked={smsChecked} onCheckedChange={setSmsChecked} />
          </SettingsRow>

          {smsChecked && phoneRow}

          <SettingsRow
            label="Push Notifications"
            description="Browser push notifications for real-time alerts"
          >
            <div className="flex items-center gap-3">
              <Switch
                checked={pushChecked}
                onCheckedChange={checked => {
                  setPushChecked(checked);
                  if (checked && pushPermissionStatus !== 'granted') {
                    requestPushPermission();
                  }
                }}
              />
              {pushPermissionStatus !== 'granted' && (
                <Button type="button" variant="outline" size="sm" onClick={requestPushPermission}>
                  Request Permission
                </Button>
              )}
              {pushPermissionStatus === 'granted' && (
                <Badge
                  variant="outline"
                  className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                >
                  Granted
                </Badge>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            label="WhatsApp Notifications"
            description="Receive alerts via WhatsApp messaging"
          >
            <Switch checked={whatsappChecked} onCheckedChange={setWhatsappChecked} />
          </SettingsRow>

          {whatsappChecked && !smsChecked && phoneRow}
        </div>
      </SettingsSection>
    </form>
  );
}

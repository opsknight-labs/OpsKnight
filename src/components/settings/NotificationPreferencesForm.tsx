'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { updateNotificationPreferences } from '@/app/(app)/settings/actions';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { notify as toast } from '@/lib/toast';

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

  // Autosave notification channels
  const handleAutoSave = useCallback(
    async (data: {
      email: boolean;
      sms: boolean;
      push: boolean;
      whatsapp: boolean;
      phoneNumber: string;
    }) => {
      const formData = new FormData();
      formData.append('emailNotificationsEnabled', data.email ? 'on' : 'off');
      formData.append('smsNotificationsEnabled', data.sms ? 'on' : 'off');
      formData.append('pushNotificationsEnabled', data.push ? 'on' : 'off');
      formData.append('whatsappNotificationsEnabled', data.whatsapp ? 'on' : 'off');
      formData.append('phoneNumber', data.phoneNumber.trim());
      formData.append('phoneNumberWhatsApp', data.phoneNumber.trim());

      const result = await updateNotificationPreferences({ error: null, success: false }, formData);

      if (result.success) {
        router.refresh();
        return { success: true };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to save notification preferences',
        };
      }
    },
    [router]
  );

  const currentSettings = {
    email: emailChecked,
    sms: smsChecked,
    push: pushChecked,
    whatsapp: whatsappChecked,
    phoneNumber: phone,
  };

  const { status: saveStatus, error: saveError } = useAutosave({
    data: currentSettings,
    onSave: handleAutoSave,
    delay: 500,
    enabled: true,
  });

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
    <SettingsSection
      title="Notification Channels"
      description="Configure how you receive incident alerts and team updates"
      action={<SaveIndicator status={saveStatus} error={saveError} />}
      footer={
        <p className="text-xs text-muted-foreground">
          Auto-saved · Critical alerts route according to your active channels
        </p>
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
                if (checked && pushPermissionStatus !== 'granted') {
                  requestPushPermission();
                } else {
                  setPushChecked(checked);
                }
              }}
            />
            {pushPermissionStatus === 'granted' ? (
              <Badge
                variant="outline"
                size="xs"
                className="text-emerald-600 dark:text-emerald-400 border-emerald-400/30 text-[10px]"
              >
                Granted
              </Badge>
            ) : pushPermissionStatus === 'denied' ? (
              <Badge
                variant="outline"
                size="xs"
                className="text-destructive border-destructive/30 text-[10px]"
              >
                Blocked
              </Badge>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={requestPushPermission}
                className="text-xs h-7"
              >
                Enable in Browser
              </Button>
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
  );
}

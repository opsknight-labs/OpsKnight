'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { updateNotificationPreferences, sendTestNotification } from '@/app/(app)/settings/actions';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { notify as toast } from '@/lib/toast';
import { Send, Loader2 } from 'lucide-react';

type Props = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
  phoneNumber: string | null;
};

export default function NotificationPreferencesForm({
  emailEnabled,
  smsEnabled,
  voiceEnabled,
  pushEnabled,
  whatsappEnabled,
  phoneNumber: initialPhoneNumber,
}: Props) {
  const router = useRouter();

  const [emailChecked, setEmailChecked] = useState(emailEnabled);
  const [smsChecked, setSmsChecked] = useState(smsEnabled);
  const [voiceChecked, setVoiceChecked] = useState(voiceEnabled);
  const [pushChecked, setPushChecked] = useState(pushEnabled);
  const [whatsappChecked, setWhatsappChecked] = useState(whatsappEnabled);
  const [phone, setPhone] = useState(initialPhoneNumber || '');
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  const handleAutoSave = useCallback(
    async (data: {
      email: boolean;
      sms: boolean;
      voice: boolean;
      push: boolean;
      whatsapp: boolean;
      phoneNumber: string;
    }) => {
      const formData = new FormData();
      formData.append('emailNotificationsEnabled', data.email ? 'on' : 'off');
      formData.append('smsNotificationsEnabled', data.sms ? 'on' : 'off');
      formData.append('voiceNotificationsEnabled', data.voice ? 'on' : 'off');
      formData.append('pushNotificationsEnabled', data.push ? 'on' : 'off');
      formData.append('whatsappNotificationsEnabled', data.whatsapp ? 'on' : 'off');
      formData.append('phoneNumber', data.phoneNumber.trim());
      formData.append('phoneNumberWhatsApp', data.phoneNumber.trim());

      const result = await updateNotificationPreferences({ error: null, success: false }, formData);

      if (result.success) {
        router.refresh();
        return { success: true };
      }

      return {
        success: false,
        error: result.error || 'Failed to save notification preferences',
      };
    },
    [router]
  );

  const currentSettings = {
    email: emailChecked,
    sms: smsChecked,
    voice: voiceChecked,
    push: pushChecked,
    whatsapp: whatsappChecked,
    phoneNumber: phone,
  };

  const {
    status: saveStatus,
    error: saveError,
    retry,
    hasPendingChanges,
    isSaving,
  } = useAutosave({
    data: currentSettings,
    onSave: handleAutoSave,
    delay: 500,
    enabled: true,
  });

  const testBlocked = hasPendingChanges || isSaving || saveStatus === 'error';

  const handleSendTest = async (channel: 'EMAIL' | 'SMS' | 'VOICE' | 'WHATSAPP' | 'PUSH') => {
    if (testBlocked) {
      toast.error('Finish saving these notification changes before sending a test.');
      return;
    }

    setTestingChannel(channel);
    try {
      const res = await sendTestNotification(channel);
      if (res.success) {
        toast.success(`Test ${channel.toLowerCase()} notification dispatched!`);
      } else {
        toast.error(res.error || `Failed to send test ${channel.toLowerCase()}`);
      }
    } catch (_e) {
      toast.error(`Error sending test ${channel.toLowerCase()} notification`);
    } finally {
      setTestingChannel(null);
    }
  };

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

  const testButtonDisabled = (channel: string) => testBlocked || testingChannel === channel;

  return (
    <SettingsSection
      title="Notification Channels"
      description="Configure how you receive incident alerts and team updates across your devices"
      action={<SaveIndicator status={saveStatus} error={saveError} onRetry={retry} />}
      footer={
        <p className="text-xs text-muted-foreground">
          Auto-saved · Tests are enabled only after the visible configuration has been persisted
        </p>
      }
    >
      <div className="flex flex-col">
        <SettingsRow label="Email Notifications" description="Receive alerts via email">
          <div className="flex items-center gap-3">
            {emailChecked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSendTest('EMAIL')}
                disabled={testButtonDisabled('EMAIL')}
                className="h-7 text-xs gap-1.5 px-2.5 font-medium"
              >
                {testingChannel === 'EMAIL' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send Test
              </Button>
            )}
            <Switch checked={emailChecked} onCheckedChange={setEmailChecked} />
          </div>
        </SettingsRow>

        <SettingsRow
          label="SMS Notifications"
          description="Receive text message alerts for incidents"
        >
          <div className="flex items-center gap-3">
            {smsChecked && !!phone && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSendTest('SMS')}
                disabled={testButtonDisabled('SMS')}
                className="h-7 text-xs gap-1.5 px-2.5 font-medium"
              >
                {testingChannel === 'SMS' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send Test
              </Button>
            )}
            <Switch checked={smsChecked} onCheckedChange={setSmsChecked} />
          </div>
        </SettingsRow>

        {smsChecked && phoneRow}

        <SettingsRow
          label="Voice Calls"
          description="Receive phone calls for incidents when voice paging is selected by your escalation policy"
        >
          <div className="flex items-center gap-3">
            {voiceChecked && !!phone && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSendTest('VOICE')}
                disabled={testButtonDisabled('VOICE')}
                className="h-7 text-xs gap-1.5 px-2.5 font-medium"
              >
                {testingChannel === 'VOICE' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send Test
              </Button>
            )}
            <Switch checked={voiceChecked} onCheckedChange={setVoiceChecked} />
          </div>
        </SettingsRow>

        {voiceChecked && !smsChecked && phoneRow}

        <SettingsRow
          label="Push Notifications"
          description="Receive real-time incident alerts and paging on your registered devices"
        >
          <div className="flex items-center gap-3">
            {pushChecked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSendTest('PUSH')}
                disabled={testButtonDisabled('PUSH')}
                className="h-7 text-xs gap-1.5 px-2.5 font-medium"
              >
                {testingChannel === 'PUSH' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send Test
              </Button>
            )}
            <Switch checked={pushChecked} onCheckedChange={setPushChecked} />
          </div>
        </SettingsRow>

        <SettingsRow
          label="WhatsApp Notifications"
          description="Receive alerts via WhatsApp messaging"
        >
          <div className="flex items-center gap-3">
            {whatsappChecked && !!phone && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSendTest('WHATSAPP')}
                disabled={testButtonDisabled('WHATSAPP')}
                className="h-7 text-xs gap-1.5 px-2.5 font-medium"
              >
                {testingChannel === 'WHATSAPP' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send Test
              </Button>
            )}
            <Switch checked={whatsappChecked} onCheckedChange={setWhatsappChecked} />
          </div>
        </SettingsRow>

        {whatsappChecked && !smsChecked && !voiceChecked && phoneRow}
      </div>
    </SettingsSection>
  );
}

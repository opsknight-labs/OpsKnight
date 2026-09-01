'use client';

import { useActionState, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { updateNotificationPreferences } from '@/app/(app)/settings/actions';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Switch } from '@/components/ui/shadcn/switch';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Mail,
  MessageSquare,
  Phone,
  Bell,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Send,
} from 'lucide-react';
import { notify as toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

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
  >('default');

  const router = useRouter();

  // Check browser push permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushPermissionStatus(Notification.permission);
    } else {
      setPushPermissionStatus('unsupported');
    }
  }, []);

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
      } catch (err) {
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

  const activeCount = [
    emailChecked,
    smsChecked && !!phone.trim(),
    whatsappChecked && !!phone.trim(),
    pushChecked,
  ].filter(Boolean).length;

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
        title="Delivery Channels"
        description="Choose how and where OpsKnight dispatches incident pages, acknowledgments, and updates"
        action={
          <Badge variant="outline" className="text-xs font-semibold px-2.5 py-0.5">
            {activeCount} of 4 Channels Active
          </Badge>
        }
        footer={
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Critical HIGH-urgency pages will prioritize all active channels configured above.
            </p>

            <Button type="submit" disabled={isPending} className="gap-2 w-full sm:w-auto">
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving Preferences...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Notification Preferences
                </>
              )}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-4">
          {/* Channel 1: Email */}
          <div
            className={cn(
              'rounded-xl border p-4 transition-all duration-200 bg-card hover:border-primary/40',
              emailChecked && 'border-primary/50 shadow-sm bg-primary/[0.02]'
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={cn(
                    'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    emailChecked
                      ? 'bg-primary/10 border-primary/20 text-primary'
                      : 'bg-muted border-border text-muted-foreground'
                  )}
                >
                  <Mail className="h-4 w-4" />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Email Alerts</span>
                    {emailChecked ? (
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]"
                      >
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-[10px]">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Receive rich incident summary emails with status badges, runbooks, and one-click
                    acknowledgment links.
                  </p>
                </div>
              </div>

              <Switch
                id="email-switch"
                checked={emailChecked}
                onCheckedChange={setEmailChecked}
                className="mt-1"
              />
            </div>
          </div>

          {/* Unified Phone Number Configuration Card (Applies to SMS & WhatsApp) */}
          {(smsChecked || whatsappChecked) && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-primary" />
                  <label
                    htmlFor="user-phone-input"
                    className="text-xs font-semibold text-foreground"
                  >
                    Mobile Phone Number (E.164 International Format)
                  </label>
                </div>
                <span className="text-[11px] text-muted-foreground">Shared for SMS & WhatsApp</span>
              </div>

              <Input
                id="user-phone-input"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                className="max-w-md bg-background font-mono text-sm"
                required={smsChecked || whatsappChecked}
              />

              <p className="text-[11px] text-muted-foreground">
                Always include the country code prefix (e.g.{' '}
                <code className="text-primary">+1</code> for USA/Canada,{' '}
                <code className="text-primary">+91</code> for India,{' '}
                <code className="text-primary">+44</code> for UK).
              </p>
            </div>
          )}

          {/* Channel 2: SMS */}
          <div
            className={cn(
              'rounded-xl border p-4 transition-all duration-200 bg-card hover:border-primary/40',
              smsChecked && 'border-primary/50 shadow-sm bg-primary/[0.02]'
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={cn(
                    'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    smsChecked
                      ? 'bg-primary/10 border-primary/20 text-primary'
                      : 'bg-muted border-border text-muted-foreground'
                  )}
                >
                  <Smartphone className="h-4 w-4" />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">SMS Text Alerts</span>
                    {smsChecked ? (
                      phone.trim() ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]"
                        >
                          Ready
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px]"
                        >
                          Phone Number Required
                        </Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-[10px]">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Direct SMS dispatch with fast acknowledgment replies for critical on-call duty.
                  </p>
                </div>
              </div>

              <Switch
                id="sms-switch"
                checked={smsChecked}
                onCheckedChange={setSmsChecked}
                className="mt-1"
              />
            </div>
          </div>

          {/* Channel 3: WhatsApp */}
          <div
            className={cn(
              'rounded-xl border p-4 transition-all duration-200 bg-card hover:border-primary/40',
              whatsappChecked && 'border-primary/50 shadow-sm bg-primary/[0.02]'
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={cn(
                    'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    whatsappChecked
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted border-border text-muted-foreground'
                  )}
                >
                  <MessageSquare className="h-4 w-4" />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">WhatsApp Messages</span>
                    {whatsappChecked ? (
                      phone.trim() ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]"
                        >
                          Ready
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px]"
                        >
                          Phone Number Required
                        </Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-[10px]">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Interactive WhatsApp alerts with incident war-room links and quick actions.
                  </p>
                </div>
              </div>

              <Switch
                id="whatsapp-switch"
                checked={whatsappChecked}
                onCheckedChange={setWhatsappChecked}
                className="mt-1"
              />
            </div>
          </div>

          {/* Channel 4: Web Browser Push */}
          <div
            className={cn(
              'rounded-xl border p-4 transition-all duration-200 bg-card hover:border-primary/40',
              pushChecked && 'border-primary/50 shadow-sm bg-primary/[0.02]'
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={cn(
                    'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    pushChecked
                      ? 'bg-primary/10 border-primary/20 text-primary'
                      : 'bg-muted border-border text-muted-foreground'
                  )}
                >
                  <Bell className="h-4 w-4" />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Web Browser Push</span>
                    {pushChecked ? (
                      pushPermissionStatus === 'granted' ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]"
                        >
                          Browser Active
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px]"
                        >
                          Permission Needed
                        </Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-[10px]">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Real-time desktop audio notifications even when OpsKnight is minimized in the
                    background.
                  </p>

                  {pushChecked && pushPermissionStatus !== 'granted' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={requestPushPermission}
                      className="h-7 text-xs gap-1.5 mt-1"
                    >
                      <Send className="h-3 w-3" />
                      Grant Browser Notification Permission
                    </Button>
                  )}
                </div>
              </div>

              <Switch
                id="push-switch"
                checked={pushChecked}
                onCheckedChange={checked => {
                  setPushChecked(checked);
                  if (checked && pushPermissionStatus !== 'granted') {
                    requestPushPermission();
                  }
                }}
                className="mt-1"
              />
            </div>
          </div>
        </div>
      </SettingsSection>
    </form>
  );
}

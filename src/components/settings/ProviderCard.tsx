'use client';

import { useState } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Switch } from '@/components/ui/shadcn/switch';
import { Badge } from '@/components/ui/shadcn/badge';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Key,
  ShieldCheck,
  Mail,
  MessageSquare,
  Phone,
  Bell,
  Sparkles,
  Save,
} from 'lucide-react';
import type { ProviderRecord, ProviderConfigSchema, SaveStatus } from '@/types/notification-types';
import { notify as toast } from '@/lib/toast';

interface ProviderCardProps {
  providerConfig: ProviderConfigSchema;
  existing?: ProviderRecord;
  isExpanded: boolean;
  onToggle: () => void;
  twilioProvider?: ProviderRecord;
}

function getProviderIcon(key: string) {
  switch (key) {
    case 'twilio':
      return <Phone className="h-4 w-4 text-blue-500" />;
    case 'whatsapp':
      return <MessageSquare className="h-4 w-4 text-emerald-500" />;
    case 'web-push':
      return <Bell className="h-4 w-4 text-indigo-500" />;
    case 'resend':
    case 'sendgrid':
    case 'ses':
    case 'smtp':
    default:
      return <Mail className="h-4 w-4 text-amber-500" />;
  }
}

export default function ProviderCard({
  providerConfig,
  existing,
  isExpanded,
  onToggle,
  twilioProvider,
}: ProviderCardProps) {
  const { userTimeZone } = useTimezone();

  // For WhatsApp, enabled state is stored in the whatsappEnabled field of Twilio config
  const initialEnabled =
    providerConfig.key === 'whatsapp'
      ? !!(
          (existing?.config as Record<string, unknown>)?.whatsappEnabled &&
          (existing?.config as Record<string, unknown>)?.whatsappNumber
        )
      : existing?.enabled || false;

  const [enabled, setEnabled] = useState(initialEnabled);
  const [config, setConfig] = useState<Record<string, unknown>>(
    (existing?.config as Record<string, unknown>) || {}
  );
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const hasRequiredConfig =
    Object.keys(config).length > 0 &&
    providerConfig.fields
      .filter(f => f.required)
      .every(f => {
        const value = config[f.name];
        return value && String(value).trim() !== '';
      });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveStatus('idle');
    setError(null);

    try {
      // Validate required fields if enabled
      if (enabled) {
        const requiredFields = providerConfig.fields.filter(f => f.required);
        for (const field of requiredFields) {
          const value = config[field.name];
          if (!value || String(value).trim() === '') {
            throw new Error(`${field.label} is required`);
          }
        }
      }

      // Special handling for WhatsApp - it's stored in Twilio provider config
      if (providerConfig.key === 'whatsapp') {
        if (!twilioProvider) {
          const { updateNotificationProvider } =
            await import('@/app/(app)/settings/system/actions');
          await updateNotificationProvider(null, 'twilio', false, {
            whatsappNumber: (config.whatsappNumber as string) || '',
            whatsappEnabled: enabled,
            whatsappContentSid: (config.whatsappContentSid as string) || '',
            whatsappAccountSid: (config.whatsappAccountSid as string) || '',
            whatsappAuthToken: (config.whatsappAuthToken as string) || '',
          });
        } else {
          const twilioConfig = twilioProvider.config as Record<string, unknown>;
          const updatedTwilioConfig = {
            ...twilioConfig,
            whatsappNumber:
              (config.whatsappNumber as string) || (twilioConfig.whatsappNumber as string) || '',
            whatsappEnabled: enabled,
            whatsappContentSid:
              (config.whatsappContentSid as string) ||
              (twilioConfig.whatsappContentSid as string) ||
              '',
            whatsappAccountSid:
              (config.whatsappAccountSid as string) ||
              (twilioConfig.whatsappAccountSid as string) ||
              '',
            whatsappAuthToken:
              (config.whatsappAuthToken as string) ||
              (twilioConfig.whatsappAuthToken as string) ||
              '',
          };

          const { updateNotificationProvider } =
            await import('@/app/(app)/settings/system/actions');
          await updateNotificationProvider(
            twilioProvider.id,
            'twilio',
            twilioProvider.enabled,
            updatedTwilioConfig
          );
        }
      } else {
        const { updateNotificationProvider } = await import('@/app/(app)/settings/system/actions');
        await updateNotificationProvider(existing?.id || null, providerConfig.key, enabled, config);
      }

      setSaveStatus('success');
      setTimeout(() => {
        setSaveStatus('idle');
        window.location.reload();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = async (checked: boolean) => {
    const newEnabled = checked;

    // Check if provider is configured before enabling
    if (newEnabled && !hasRequiredConfig) {
      toast.error(
        'Please configure this provider first before enabling it. Click "Configure" to add required settings.'
      );
      return;
    }

    setEnabled(newEnabled);

    try {
      if (providerConfig.key === 'whatsapp') {
        if (!twilioProvider) {
          const { updateNotificationProvider } =
            await import('@/app/(app)/settings/system/actions');
          await updateNotificationProvider(null, 'twilio', false, {
            whatsappNumber: (config.whatsappNumber as string) || '',
            whatsappEnabled: newEnabled,
          });
        } else {
          const twilioConfig = twilioProvider.config as Record<string, unknown>;
          const updatedTwilioConfig = {
            ...twilioConfig,
            whatsappNumber:
              (config.whatsappNumber as string) || (twilioConfig.whatsappNumber as string) || '',
            whatsappEnabled: newEnabled,
          };

          const { updateNotificationProvider } =
            await import('@/app/(app)/settings/system/actions');
          await updateNotificationProvider(
            twilioProvider.id,
            'twilio',
            twilioProvider.enabled,
            updatedTwilioConfig
          );
        }
      } else {
        const { updateNotificationProvider } = await import('@/app/(app)/settings/system/actions');
        await updateNotificationProvider(
          existing?.id || null,
          providerConfig.key,
          newEnabled,
          config
        );
      }

      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      setEnabled(!newEnabled);
      toast.error(
        `Failed to ${newEnabled ? 'enable' : 'disable'} provider: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  };

  const isWebPush = providerConfig.key === 'web-push';
  const hasVapidKeys =
    typeof config.vapidPublicKey === 'string' &&
    config.vapidPublicKey.trim() !== '' &&
    typeof config.vapidPrivateKey === 'string' &&
    config.vapidPrivateKey.trim() !== '';
  const legacyKeyCount = Array.isArray(config.vapidKeyHistory) ? config.vapidKeyHistory.length : 0;

  const handleGenerateVapid = async () => {
    setIsGenerating(true);
    setGenerateNotice(null);
    setGenerateError(null);
    setError(null);

    try {
      const { generateVapidKeys } = await import('@/app/(app)/settings/system/actions');
      const subjectValue = typeof config.vapidSubject === 'string' ? config.vapidSubject : '';
      const result = await generateVapidKeys({
        subject: subjectValue,
        rotate: hasVapidKeys,
        keepPrevious: true,
      });

      setConfig(prev => ({
        ...prev,
        vapidPublicKey: result.publicKey,
        vapidPrivateKey: result.privateKey,
        vapidSubject: result.subject,
      }));

      setGenerateNotice(
        hasVapidKeys
          ? 'Keys rotated. Existing devices continue to work; new devices use the latest key.'
          : 'VAPID keys generated and saved.'
      );
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : 'Failed to generate VAPID keys. Please try again.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const isConfigured = hasRequiredConfig;

  return (
    <Card className="border-border/80 shadow-xs bg-card overflow-hidden">
      <CardHeader className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0 mt-0.5">
              {getProviderIcon(providerConfig.key)}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base font-bold text-foreground">
                  {providerConfig.name}
                </CardTitle>
                {enabled ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 inline-flex items-center gap-1.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Active & Routing
                  </Badge>
                ) : isConfigured ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border-border/80"
                  >
                    Configured (Standby)
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                  >
                    Setup Required
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">{providerConfig.description}</CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <div className="flex items-center gap-2 bg-muted/30 px-2.5 py-1 rounded-lg border border-border/50">
              <span className="text-xs font-medium text-muted-foreground">
                {enabled ? 'Active' : 'Disabled'}
              </span>
              <Switch
                checked={enabled}
                onCheckedChange={handleToggleEnabled}
                disabled={isSaving || (!enabled && !hasRequiredConfig)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggle}
              className="text-xs font-semibold h-8 gap-1.5 border-border/80 hover:bg-accent"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Configure
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-4 sm:p-5 pt-0 sm:pt-0 border-t border-border/60 mt-2">
          <form onSubmit={handleSave} className="space-y-5 pt-4">
            <div className="flex items-center space-x-2 bg-muted/20 p-3 rounded-xl border border-border/50">
              <Checkbox
                checked={enabled}
                onCheckedChange={checked => setEnabled(!!checked)}
                id={`enable-${providerConfig.key}`}
              />
              <Label
                htmlFor={`enable-${providerConfig.key}`}
                className="text-xs font-semibold cursor-pointer text-foreground"
              >
                Enable {providerConfig.name} for outbound alert dispatch
              </Label>
            </div>

            {isWebPush && (
              <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-primary" />
                      <p className="text-xs font-bold text-foreground">VAPID Cryptographic Keys</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Generate or rotate the Web Push application server keys. Existing registered
                      devices continue to receive alerts after rotation.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateVapid}
                    disabled={isGenerating}
                    className="gap-2 text-xs font-semibold shrink-0"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                    )}
                    {hasVapidKeys ? 'Rotate Keys' : 'Generate Keys'}
                  </Button>
                </div>
                {hasVapidKeys && (
                  <div className="text-[11px] text-muted-foreground font-mono">
                    Legacy active key versions retained: {legacyKeyCount}
                  </div>
                )}
                {generateNotice && (
                  <Alert className="bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 py-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <AlertDescription className="text-xs">{generateNotice}</AlertDescription>
                  </Alert>
                )}
                {generateError && (
                  <Alert variant="destructive" className="py-2">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">{generateError}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <div className="space-y-4">
              {providerConfig.fields.map(field => {
                const isPasswordField = field.type === 'password';
                const isVisible = showSecrets[field.name];

                return (
                  <div key={field.name} className="space-y-1.5">
                    <Label htmlFor={field.name} className="text-xs font-semibold text-foreground">
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        id={field.name}
                        value={(config[field.name] as string) || ''}
                        onChange={e => setConfig({ ...config, [field.name]: e.target.value })}
                        placeholder={field.placeholder}
                        required={field.required && enabled}
                        rows={3}
                        className="font-mono text-xs"
                      />
                    ) : field.type === 'checkbox' ? (
                      <div className="flex items-center space-x-2 pt-1">
                        <Checkbox
                          id={field.name}
                          checked={(config[field.name] as boolean) || false}
                          onCheckedChange={checked =>
                            setConfig({ ...config, [field.name]: !!checked })
                          }
                        />
                        <Label
                          htmlFor={field.name}
                          className="text-xs font-normal cursor-pointer text-muted-foreground"
                        >
                          {field.label}
                        </Label>
                      </div>
                    ) : (
                      <div className="relative">
                        <Input
                          id={field.name}
                          type={isPasswordField && isVisible ? 'text' : field.type}
                          value={(config[field.name] as string) || ''}
                          onChange={e => setConfig({ ...config, [field.name]: e.target.value })}
                          placeholder={field.placeholder}
                          required={field.required && enabled}
                          className={`text-xs ${isPasswordField ? 'font-mono pr-9' : ''}`}
                        />
                        {isPasswordField && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowSecrets(prev => ({ ...prev, [field.name]: !prev[field.name] }))
                            }
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            {isVisible ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/60 pt-4">
              <div className="flex-1 w-full">
                {saveStatus === 'success' && (
                  <Alert className="bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 py-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <AlertDescription className="text-xs font-medium">
                      Configuration updated successfully
                    </AlertDescription>
                  </Alert>
                )}
                {saveStatus === 'error' && error && (
                  <Alert variant="destructive" className="py-2">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">{error}</AlertDescription>
                  </Alert>
                )}
              </div>
              <Button
                type="submit"
                disabled={isSaving}
                size="sm"
                className="w-full sm:w-auto text-xs font-semibold gap-1.5"
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {isSaving ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
          </form>
        </CardContent>
      )}

      {existing && !isExpanded && (
        <CardContent className="px-4 sm:px-5 pb-4 pt-0">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-2.5">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-emerald-500" />
              Encrypted credentials stored securely
            </span>
            <span>
              Last modified:{' '}
              {formatDateTime(existing.updatedAt, userTimeZone, { format: 'datetime' })}
            </span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

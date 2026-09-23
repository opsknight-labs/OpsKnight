'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
  Copy,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  Key,
  ShieldCheck,
  Sparkles,
  Save,
  FlaskConical,
  AlertOctagon,
  RotateCcw,
} from 'lucide-react';
import type { ProviderRecord, ProviderConfigSchema, SaveStatus } from '@/types/notification-types';
import { notify as toast } from '@/lib/toast';
import { getProviderBrandLogo } from '@/components/settings/ProviderBrandLogos';
import ProviderCapacitySettings from '@/components/settings/ProviderCapacitySettings';

export type ProviderStatusRole =
  | 'primary'
  | 'fallback_1'
  | 'fallback_2'
  | 'fallback_3'
  | 'active'
  | 'standby'
  | 'configuration_error'
  | 'not_configured';

interface ProviderCardProps {
  providerConfig: ProviderConfigSchema;
  existing?: ProviderRecord;
  isExpanded: boolean;
  onToggle: () => void;
  twilioProvider?: ProviderRecord;
  statusRole?: ProviderStatusRole;
}

export default function ProviderCard({
  providerConfig,
  existing,
  isExpanded,
  onToggle,
  twilioProvider,
  statusRole,
}: ProviderCardProps) {
  const router = useRouter();
  const { userTimeZone } = useTimezone();

  const initialEnabled =
    providerConfig.key === 'whatsapp'
      ? !!(
          (existing?.config as Record<string, unknown>)?.whatsappEnabled &&
          (existing?.config as Record<string, unknown>)?.whatsappNumber
        )
      : existing?.enabled || false;
  const initialConfig = (existing?.config as Record<string, unknown>) || {};
  const initialRevision =
    providerConfig.key === 'whatsapp'
      ? twilioProvider?.updatedAt || null
      : existing?.updatedAt || null;

  const [enabled, setEnabled] = useState(initialEnabled);
  const [config, setConfig] = useState<Record<string, unknown>>(initialConfig);
  const [savedEnabled, setSavedEnabled] = useState(initialEnabled);
  const [savedConfig, setSavedConfig] = useState<Record<string, unknown>>(initialConfig);
  const [savedRevision, setSavedRevision] = useState<string | null>(initialRevision);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState<{
    status:
      | 'ACCEPTED'
      | 'DELIVERED'
      | 'QUEUED'
      | 'DEFERRED'
      | 'CONFIGURED_NO_DEVICE'
      | 'FAILED'
      | 'UNKNOWN';
    message?: string;
    provider?: string;
    providerMessageId?: string;
    notificationId?: string;
    testedAt: Date;
    errorCode?: string;
  } | null>(null);

  const hasRequiredConfig = (() => {
    if (providerConfig.key === 'whatsapp') {
      const accountSid =
        (config.whatsappAccountSid as string) ||
        ((twilioProvider?.config as Record<string, unknown>)?.accountSid as string);
      const authToken =
        (config.whatsappAuthToken as string) ||
        ((twilioProvider?.config as Record<string, unknown>)?.authToken as string);
      return Boolean(
        config.whatsappNumber &&
        String(config.whatsappNumber).trim() !== '' &&
        accountSid &&
        String(accountSid).trim() !== '' &&
        authToken &&
        String(authToken).trim() !== ''
      );
    }
    return (
      Object.keys(config).length > 0 &&
      providerConfig.fields
        .filter(f => f.required)
        .every(f => {
          const value = config[f.name];
          return value && String(value).trim() !== '';
        })
    );
  })();
  const isDirty =
    enabled !== savedEnabled || JSON.stringify(config) !== JSON.stringify(savedConfig);
  const updateConfig = (field: string, value: unknown) => {
    setConfig(previous => ({ ...previous, [field]: value }));
    setTestResult(null);
    setTestStatus('idle');
  };

  const resetLocalChanges = () => {
    setEnabled(savedEnabled);
    setConfig(savedConfig);
    setError(null);
    setSaveStatus('idle');
    setTestStatus('idle');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty) return;

    setIsSaving(true);
    setSaveStatus('idle');
    setError(null);

    try {
      if (enabled) {
        const requiredFields = providerConfig.fields.filter(f => f.required);
        for (const field of requiredFields) {
          const value = config[field.name];
          if (!value || String(value).trim() === '') {
            throw new Error(`${field.label} is required`);
          }
        }
      }

      const { updateNotificationProvider } =
        await import('@/app/(app)/settings/system/provider-actions');
      let result: { success: true; updatedAt: string };

      if (providerConfig.key === 'whatsapp') {
        if (!twilioProvider) {
          result = await updateNotificationProvider(
            null,
            'twilio',
            false,
            {
              whatsappNumber: (config.whatsappNumber as string) || '',
              whatsappEnabled: enabled,
              whatsappContentSid: (config.whatsappContentSid as string) || '',
              whatsappAccountSid: (config.whatsappAccountSid as string) || '',
              whatsappAuthToken: (config.whatsappAuthToken as string) || '',
            },
            savedRevision
          );
        } else {
          const twilioConfig = twilioProvider.config as Record<string, unknown>;
          const updatedTwilioConfig = {
            ...twilioConfig,
            whatsappNumber:
              (config.whatsappNumber as string) || (twilioConfig.whatsappNumber as string) || '',
            whatsappEnabled: enabled,
            whatsappContentSid:
              ((config.whatsappContentSid as string | undefined) ??
                (twilioConfig.whatsappContentSid as string)) ||
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

          result = await updateNotificationProvider(
            twilioProvider.id,
            'twilio',
            twilioProvider.enabled,
            updatedTwilioConfig,
            savedRevision
          );
        }
      } else {
        result = await updateNotificationProvider(
          existing?.id || null,
          providerConfig.key,
          enabled,
          config,
          savedRevision
        );
      }

      setSavedEnabled(enabled);
      setSavedConfig(config);
      setSavedRevision(result.updatedAt);
      toast.success(`${providerConfig.name} configuration saved`, {
        id: `settings:provider:${providerConfig.key}:save`,
      });
      setSaveStatus('idle');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = (checked: boolean) => {
    if (checked && !hasRequiredConfig) {
      toast.error(
        'Please configure this provider first before enabling it. Click "Configure" to add required settings.'
      );
      if (!isExpanded) onToggle();
      return;
    }

    setEnabled(checked);
    setSaveStatus('idle');
    setError(null);
    if (!isExpanded) onToggle();
  };

  const isWebPush = providerConfig.key === 'web-push';
  const hasVapidKeys =
    typeof config.vapidPublicKey === 'string' &&
    config.vapidPublicKey.trim() !== '' &&
    typeof config.vapidPrivateKey === 'string' &&
    config.vapidPrivateKey.trim() !== '';
  const legacyKeyCount = Array.isArray(config.vapidKeyHistory) ? config.vapidKeyHistory.length : 0;

  const handleGenerateVapid = async () => {
    if (isDirty) {
      toast.error('Save changes before generating or rotating VAPID keys.');
      return;
    }

    setIsGenerating(true);
    setGenerateNotice(null);
    setGenerateError(null);
    setError(null);

    try {
      const { generateVapidKeys } = await import('@/app/(app)/settings/system/provider-actions');
      const subjectValue = typeof config.vapidSubject === 'string' ? config.vapidSubject : '';
      const result = await generateVapidKeys({
        subject: subjectValue,
        rotate: hasVapidKeys,
        keepPrevious: true,
        expectedUpdatedAt: savedRevision,
      });

      const nextConfig = {
        ...config,
        vapidPublicKey: result.publicKey,
        // Preserve the masked value already loaded by the form. The newly
        // generated private key remains encrypted on the server.
        vapidPrivateKey: '********',
        vapidSubject: result.subject,
      };
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      setSavedRevision(result.updatedAt);
      setGenerateNotice(
        hasVapidKeys
          ? 'Keys rotated. Existing devices continue to work; new devices use the latest key.'
          : 'VAPID keys generated and saved.'
      );
      router.refresh();
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : 'Failed to generate VAPID keys. Please try again.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const isConfigured = hasRequiredConfig;

  const handleTest = async () => {
    if (isDirty) {
      toast.error('Save changes before testing this provider.');
      return;
    }

    setIsTesting(true);
    setTestStatus('idle');
    try {
      const { testNotificationProvider } = await import('@/app/(app)/settings/system/actions');
      const result = await testNotificationProvider(providerConfig.key);
      setTestResult({
        status: result.status,
        message: result.message,
        provider: result.provider || providerConfig.name,
        providerMessageId: result.providerMessageId,
        notificationId: result.notificationId,
        testedAt: new Date(),
        errorCode: (result as { errorCode?: string }).errorCode,
      });

      if (
        result.status === 'DELIVERED' ||
        result.status === 'ACCEPTED' ||
        result.status === 'CONFIGURED_NO_DEVICE'
      ) {
        setTestStatus('success');
        toast.success(result.message || `Test message accepted by ${providerConfig.name}`);
      } else if (result.status === 'QUEUED') {
        setTestStatus('idle');
        toast.info(result.message || `Test message queued via ${providerConfig.name}`);
      } else if (result.status === 'DEFERRED') {
        setTestStatus('idle');
        toast.warning(result.message || `Test delivery deferred by provider`);
      } else if (result.status === 'UNKNOWN') {
        setTestStatus('error');
        toast.warning(result.message || `Test delivery status unconfirmed`);
      } else {
        setTestStatus('error');
        toast.error(result.message || `Test delivery failed for ${providerConfig.name}`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestResult({
        status: 'FAILED',
        message: err instanceof Error ? err.message : 'Test delivery failed',
        provider: providerConfig.name,
        testedAt: new Date(),
      });
      toast.error(err instanceof Error ? err.message : 'Test delivery failed');
    } finally {
      setIsTesting(false);
      setTimeout(() => setTestStatus('idle'), 6000);
    }
  };

  const copyVapid = async () => {
    const key = typeof config.vapidPublicKey === 'string' ? config.vapidPublicKey : '';
    if (!key) return;
    await navigator.clipboard.writeText(key);
    toast.success('VAPID public key copied to clipboard');
  };

  const renderStatusBadge = () => {
    if (isDirty) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
        >
          {enabled ? 'Will be Enabled' : 'Will be Disabled'}
        </Badge>
      );
    }

    const effectiveRole =
      statusRole || (enabled ? 'active' : isConfigured ? 'standby' : 'not_configured');

    switch (effectiveRole) {
      case 'primary':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 inline-flex items-center gap-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Primary (Active)
          </Badge>
        );
      case 'fallback_1':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 inline-flex items-center gap-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Fallback #1
          </Badge>
        );
      case 'fallback_2':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 inline-flex items-center gap-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Fallback #2
          </Badge>
        );
      case 'fallback_3':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 inline-flex items-center gap-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Fallback #3
          </Badge>
        );
      case 'active':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 inline-flex items-center gap-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active &amp; Routing
          </Badge>
        );
      case 'configuration_error':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 inline-flex items-center gap-1"
          >
            <AlertOctagon className="h-3 w-3" />
            Configuration Error
          </Badge>
        );
      case 'standby':
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border-border/80"
          >
            Configured (Standby)
          </Badge>
        );
      case 'not_configured':
      default:
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
          >
            Setup Required
          </Badge>
        );
    }
  };

  return (
    <Card className="border-border/80 shadow-xs bg-card overflow-hidden">
      <CardHeader className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-background border border-border/80 shadow-xs shrink-0 mt-0.5 flex items-center justify-center">
              {getProviderBrandLogo(providerConfig.key, 24)}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base font-bold text-foreground">
                  {providerConfig.name}
                </CardTitle>
                {renderStatusBadge()}
              </div>
              <CardDescription className="text-xs">{providerConfig.description}</CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end sm:justify-start self-end sm:self-auto">
            <div className="flex items-center gap-2 bg-muted/30 px-2.5 py-1 rounded-lg border border-border/50">
              <span className="text-xs font-medium text-muted-foreground">
                {enabled ? 'Active' : 'Disabled'}
              </span>
              <Switch
                checked={enabled}
                onCheckedChange={handleToggleEnabled}
                disabled={isSaving || (!enabled && !hasRequiredConfig)}
                aria-label={`Toggle ${providerConfig.name} provider`}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggle}
              className="text-xs font-semibold h-8 gap-1.5 border-border/80 hover:bg-accent"
              aria-label={
                isExpanded
                  ? `Collapse ${providerConfig.name} configuration`
                  : `Configure ${providerConfig.name}`
              }
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
            {enabled && isConfigured && (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => void handleTest()}
                disabled={isTesting || isDirty}
                title={isDirty ? 'Save changes before testing' : undefined}
                aria-label={`Send test notification via ${providerConfig.name}`}
                className={`text-xs font-semibold h-8 gap-1.5 ${
                  testStatus === 'success'
                    ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                    : testStatus === 'error'
                      ? 'border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
                      : 'border-border/80 hover:bg-accent'
                }`}
              >
                {isTesting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : testStatus === 'success' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : testStatus === 'error' ? (
                  <AlertOctagon className="h-3.5 w-3.5" />
                ) : (
                  <FlaskConical className="h-3.5 w-3.5" />
                )}
                {isDirty
                  ? 'Save first'
                  : isTesting
                    ? 'Testing...'
                    : testStatus === 'success'
                      ? testResult?.status === 'DELIVERED'
                        ? 'Delivered'
                        : 'Accepted'
                      : testStatus === 'error'
                        ? 'Failed'
                        : 'Send Test'}
              </Button>
            )}
          </div>
        </div>

        {testResult && (
          <div
            role="status"
            className={`mt-3 p-3 rounded-xl border text-xs space-y-1.5 transition-all ${
              testResult.status === 'DELIVERED' || testResult.status === 'ACCEPTED'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100'
                : testResult.status === 'DEFERRED' || testResult.status === 'UNKNOWN'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100'
                  : testResult.status === 'QUEUED'
                    ? 'bg-zinc-500/10 border-zinc-500/30 text-zinc-950 dark:text-zinc-100'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-950 dark:text-rose-100'
            }`}
          >
            <div className="flex items-center justify-between font-semibold">
              <span className="flex items-center gap-1.5">
                {testResult.status === 'DELIVERED' || testResult.status === 'ACCEPTED' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : testResult.status === 'DEFERRED' || testResult.status === 'UNKNOWN' ? (
                  <AlertOctagon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                ) : testResult.status === 'QUEUED' ? (
                  <FlaskConical className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                )}
                {testResult.status === 'ACCEPTED' && 'Provider Accepted Test'}
                {testResult.status === 'DELIVERED' && 'Delivered to Recipient'}
                {testResult.status === 'DEFERRED' && 'Delivery Deferred (Rate Limited)'}
                {testResult.status === 'QUEUED' && 'Test Notification Queued'}
                {testResult.status === 'CONFIGURED_NO_DEVICE' && 'Configured · No Recipient Device'}
                {testResult.status === 'UNKNOWN' && 'Delivery Status Unconfirmed'}
                {testResult.status === 'FAILED' && 'Test Delivery Failed'}
              </span>
              <span className="text-[11px] opacity-75">
                {formatDateTime(testResult.testedAt.toISOString(), userTimeZone, {
                  format: 'time',
                })}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] opacity-90 pt-1">
              <div>
                Provider: <span className="font-mono font-medium">{testResult.provider}</span>
              </div>
              {testResult.providerMessageId && (
                <div className="truncate">
                  Message ID: <span className="font-mono">{testResult.providerMessageId}</span>
                </div>
              )}
              {testResult.notificationId && (
                <div className="truncate">
                  Notification: <span className="font-mono">{testResult.notificationId}</span>
                </div>
              )}
              {testResult.errorCode && (
                <div>
                  Error code: <span className="font-mono">{testResult.errorCode}</span>
                </div>
              )}
            </div>
            {testResult.message && (
              <p className="text-[11px] pt-1 border-t border-current/10 opacity-90">
                {testResult.message}
              </p>
            )}
          </div>
        )}
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-4 sm:p-5 pt-0 sm:pt-0 border-t border-border/60 mt-2">
          <form onSubmit={handleSave} className="space-y-5 pt-4">
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
                    disabled={isGenerating || isDirty}
                    title={isDirty ? 'Save changes before rotating keys' : undefined}
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
                const fieldId = `${providerConfig.key}-${field.name}`;

                return (
                  <div key={field.name} className="space-y-1.5">
                    <Label htmlFor={fieldId} className="text-xs font-semibold text-foreground">
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        id={fieldId}
                        value={(config[field.name] as string) || ''}
                        onChange={e => updateConfig(field.name, e.target.value)}
                        placeholder={field.placeholder}
                        required={field.required && enabled}
                        rows={3}
                        className="font-mono text-xs"
                      />
                    ) : field.type === 'checkbox' ? (
                      <div className="flex items-center space-x-2 pt-1">
                        <Checkbox
                          id={fieldId}
                          checked={(config[field.name] as boolean) || false}
                          onCheckedChange={checked => updateConfig(field.name, !!checked)}
                        />
                        <Label
                          htmlFor={fieldId}
                          className="text-xs font-normal cursor-pointer text-muted-foreground"
                        >
                          {field.label}
                        </Label>
                      </div>
                    ) : (
                      <div className="relative">
                        <Input
                          id={fieldId}
                          type={isPasswordField && isVisible ? 'text' : field.type}
                          value={(config[field.name] as string) || ''}
                          onChange={e => updateConfig(field.name, e.target.value)}
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
                            aria-label={isVisible ? `Hide ${field.label}` : `Show ${field.label}`}
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

            <div className="border-t border-border/60 pt-4">
              <ProviderCapacitySettings providerKey={providerConfig.key} compact />
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/60 pt-4">
              <div className="flex-1 w-full">
                {saveStatus === 'error' && error && (
                  <Alert
                    role="alert"
                    variant="destructive"
                    className="flex items-center gap-2 py-2 [&>svg]:static [&>svg]:shrink-0 [&>svg+div]:translate-y-0 [&>svg~*]:pl-0"
                  >
                    <XCircle className="h-4 w-4 shrink-0" />
                    <AlertDescription className="text-xs leading-4">{error}</AlertDescription>
                  </Alert>
                )}
                {isDirty && saveStatus !== 'error' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Unsaved changes — save before sending a provider test.
                  </p>
                )}
              </div>
              <div className="flex w-full sm:w-auto gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving || !isDirty}
                  size="sm"
                  onClick={resetLocalChanges}
                  className="flex-1 sm:flex-none text-xs font-semibold gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Discard
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving || !isDirty}
                  size="sm"
                  className="flex-1 sm:flex-none text-xs font-semibold gap-1.5"
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {isSaving ? 'Saving...' : 'Save Configuration'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      )}

      {existing && !isExpanded && (
        <CardContent className="px-4 sm:px-5 pb-4 pt-0">
          <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-500" />
                Sensitive credentials are masked
              </span>
              <span>
                Last modified:{' '}
                {formatDateTime(savedRevision || existing.updatedAt, userTimeZone, {
                  format: 'datetime',
                })}
              </span>
            </div>
            {isWebPush && typeof config.vapidPublicKey === 'string' && config.vapidPublicKey && (
              <button
                type="button"
                onClick={() => void copyVapid()}
                aria-label="Copy VAPID public key"
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-0.5 w-fit"
              >
                <Copy className="h-3 w-3" />
                Copy VAPID public key
              </button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { notify as toast } from '@/lib/toast';
import {
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  Download,
  Bot,
  ShieldCheck,
  Send,
  FileCode2,
  Sparkles,
  ArrowRight,
  Shield,
  HelpCircle,
} from 'lucide-react';

type ConfigData = {
  id?: string;
  clientId: string;
  tenantId?: string | null;
  tenantMode: string;
  enabled: boolean;
  interactiveEnabled: boolean;
  warRoomsEnabled: boolean;
  defaultMeetingOrganizerUpn?: string | null;
} | null;

type InstallationPermissionState = {
  teamId: string;
  teamName: string | null;
  missing: string[];
  unknown: boolean;
  error?: string;
};

type DestinationRow = {
  id: string;
  serviceId: string;
  teamId: string;
  channelId: string;
  channelName?: string | null;
  teamName?: string | null;
  enabled: boolean;
  service?: { name: string } | null;
};

type Props = {
  config: ConfigData;
  isAdmin: boolean;
  appManifestJson: string;
  installationCount: number;
  installationPermissions: InstallationPermissionState[];
  destinations: DestinationRow[];
};

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function MicrosoftTeamsSetupWizard({
  config,
  isAdmin,
  appManifestJson,
  installationCount,
  installationPermissions,
  destinations,
}: Props) {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState<number>(() => {
    if (!config?.clientId || !config?.enabled) return 1;
    if (installationCount === 0) return 3;
    if (destinations.length === 0) return 4;
    return 4;
  });

  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showManifest, setShowManifest] = useState(false);
  const [testingDestinationId, setTestingDestinationId] = useState<string | null>(null);

  // Form validation helpers
  const [clientIdInput, setClientIdInput] = useState(config?.clientId ?? '');
  const [tenantIdInput, setTenantIdInput] = useState(config?.tenantId ?? '');

  const isStep1Done = Boolean(config?.clientId && config?.enabled);
  const isStep2Done = Boolean(config?.clientId);
  const isStep3Done = installationCount > 0;
  const isStep4Done = isStep3Done && destinations.length > 0;

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(null), 1500);
  };

  const onSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAdmin) return;
    const form = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const { saveMicrosoftTeamsConfig } =
        await import('@/app/(app)/settings/integrations/microsoft-teams/actions');
      const result = await saveMicrosoftTeamsConfig(form);
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success('Microsoft Teams configuration saved successfully.');
        router.refresh();
        setActiveStep(2);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (destinationId: string) => {
    setTestingDestinationId(destinationId);
    try {
      const res = await fetch('/api/microsoft-teams/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) toast.success('Test Adaptive Card sent to Teams channel.');
      else toast.error(data?.error || 'Teams test failed');
    } catch {
      toast.error('Teams test failed');
    } finally {
      setTestingDestinationId(null);
    }
  };

  const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const botEndpoint = `${originUrl}/api/microsoft-teams/messages`;
  const callbackUrl = `${originUrl}/api/microsoft-teams/auth/callback`;

  const steps = [
    {
      num: 1,
      title: 'Azure App Registration',
      desc: 'Create Entra ID identity',
      done: isStep1Done,
    },
    {
      num: 2,
      title: 'Bot Messaging Endpoint',
      desc: 'Connect Bot Framework',
      done: isStep2Done,
    },
    {
      num: 3,
      title: 'Install Teams App Package',
      desc: 'Deploy to Teams organization',
      done: isStep3Done,
    },
    {
      num: 4,
      title: 'Consent & Verification',
      desc: 'Verify RSC & live test',
      done: isStep4Done,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Wizard Progress Stepper Header */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Guided Setup: Zero-Doc Integration Wizard
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Follow these 4 simple steps to connect Microsoft Teams without digging through
              external documentation.
            </p>
          </div>
          <Badge variant="outline" className="text-xs self-start sm:self-auto font-medium">
            {steps.filter(s => s.done).length} of {steps.length} completed
          </Badge>
        </div>

        {/* Step Progress Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          {steps.map(step => {
            const isActive = activeStep === step.num;
            return (
              <button
                key={step.num}
                type="button"
                onClick={() => setActiveStep(step.num)}
                className={`flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                  isActive
                    ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20'
                    : step.done
                      ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-muted/30'
                      : 'border-border bg-card/60 hover:bg-muted/30'
                }`}
              >
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold ${
                    step.done
                      ? 'bg-emerald-500 text-white'
                      : isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {step.done ? <Check className="h-3.5 w-3.5" /> : step.num}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate flex items-center gap-1">
                    {step.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{step.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 1: Azure App Registration */}
      {activeStep === 1 && (
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-bold">
                  STEP 1
                </Badge>
                <h3 className="text-base font-semibold">Register App in Microsoft Entra ID</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Register an application in your Azure Portal to obtain credentials for Graph and Bot
                Connector APIs.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1.5 shrink-0">
              <a
                href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Azure Portal <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>

          {/* Step Guide Micro-Card */}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-2 text-xs">
            <h4 className="font-semibold text-foreground flex items-center gap-1.5">
              <HelpCircle className="h-3.5 w-3.5 text-primary" /> Quick Registration Instructions
            </h4>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground leading-relaxed">
              <li>
                In Azure Portal, click{' '}
                <span className="font-medium text-foreground">&ldquo;New registration&rdquo;</span>.
              </li>
              <li>
                Name:{' '}
                <code className="bg-background px-1 py-0.5 rounded border text-foreground">
                  OpsKnight Teams Bot
                </code>
              </li>
              <li>
                Supported account types: Select{' '}
                <span className="font-medium text-foreground">
                  &ldquo;Accounts in this organizational directory only (Single tenant)&rdquo;
                </span>
                .
              </li>
              <li>
                Web Redirect URI (optional):
                <div className="mt-1 flex items-center gap-2">
                  <code className="bg-background px-2 py-1 rounded border text-[11px] font-mono text-foreground truncate max-w-md">
                    {callbackUrl}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => copy(callbackUrl, 'callback')}
                  >
                    {copied === 'callback' ? (
                      <Check className="h-3 w-3 mr-1 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3 mr-1" />
                    )}
                    Copy
                  </Button>
                </div>
              </li>
              <li>
                Click <span className="font-medium text-foreground">&ldquo;Register&rdquo;</span>,
                then generate a Client Secret under{' '}
                <span className="font-medium text-foreground">
                  Certificates & secrets &gt; New client secret
                </span>
                .
              </li>
            </ol>
          </div>

          {/* Credentials Form */}
          <form onSubmit={onSave} className="space-y-4 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="mt-clientId" className="text-xs font-semibold">
                    Application (Client) ID <span className="text-destructive">*</span>
                  </Label>
                  {clientIdInput && !GUID_REGEX.test(clientIdInput.trim()) && (
                    <span className="text-[10px] text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-2.5 w-2.5" /> GUID format expected
                    </span>
                  )}
                </div>
                <Input
                  id="mt-clientId"
                  name="clientId"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={clientIdInput}
                  onChange={e => setClientIdInput(e.target.value)}
                  disabled={!isAdmin}
                  className="font-mono text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="mt-tenantId" className="text-xs font-semibold">
                    Directory (Tenant) ID <span className="text-destructive">*</span>
                  </Label>
                  {tenantIdInput && !GUID_REGEX.test(tenantIdInput.trim()) && (
                    <span className="text-[10px] text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-2.5 w-2.5" /> GUID format expected
                    </span>
                  )}
                </div>
                <Input
                  id="mt-tenantId"
                  name="tenantId"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={tenantIdInput}
                  onChange={e => setTenantIdInput(e.target.value)}
                  disabled={!isAdmin}
                  className="font-mono text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="mt-clientSecret" className="text-xs font-semibold">
                    Client Secret Value{' '}
                    {config?.clientId ? (
                      '(Optional update)'
                    ) : (
                      <span className="text-destructive">*</span>
                    )}
                  </Label>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Shield className="h-2.5 w-2.5" /> AES-256 encrypted
                  </span>
                </div>
                <Input
                  id="mt-clientSecret"
                  name="clientSecret"
                  type="password"
                  placeholder={
                    config?.clientId
                      ? '•••••••••••• (leave blank to keep existing secret)'
                      : 'Secret value from Certificates & secrets'
                  }
                  disabled={!isAdmin}
                  className="font-mono text-xs"
                  required={!config?.clientId}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mt-tenantMode" className="text-xs font-semibold">
                  Tenant Mode
                </Label>
                <select
                  id="mt-tenantMode"
                  name="tenantMode"
                  defaultValue="SINGLE"
                  disabled={!isAdmin}
                  className="h-9 w-full rounded-md border bg-background px-3 text-xs"
                >
                  <option value="SINGLE">SINGLE (Your Organization Only)</option>
                </select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="mt-defaultMeetingOrganizerUpn" className="text-xs font-medium">
                  Default Online Meeting Organizer UPN (Optional)
                </Label>
                <Input
                  id="mt-defaultMeetingOrganizerUpn"
                  name="defaultMeetingOrganizerUpn"
                  placeholder="incident-lead@yourorg.com"
                  defaultValue={config?.defaultMeetingOrganizerUpn ?? ''}
                  disabled={!isAdmin}
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Used as organizer for automated Teams Video Bridge meetings when an incident
                  assignee does not have a linked Microsoft identity.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t text-xs">
              <label className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/20 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  name="interactiveEnabled"
                  defaultChecked={config?.interactiveEnabled ?? true}
                  disabled={!isAdmin}
                  className="mt-0.5 rounded border-muted"
                />
                <div>
                  <span className="font-semibold text-foreground block">
                    Enable Interactive ChatOps (Acknowledge, Resolve, Add Notes)
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Allows responders to take action directly from Teams Adaptive Cards.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/20 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  name="warRoomsEnabled"
                  defaultChecked={config?.warRoomsEnabled ?? true}
                  disabled={!isAdmin}
                  className="mt-0.5 rounded border-muted"
                />
                <div>
                  <span className="font-semibold text-foreground block">
                    Enable Incident War Rooms & Video Bridges
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Enables provisioning dedicated collaboration channels and Teams meetings for
                    critical incidents.
                  </span>
                </div>
              </label>
            </div>

            {isAdmin && (
              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-muted-foreground">
                  Credentials are encrypted at rest and never exposed in the browser.
                </div>
                <Button
                  type="submit"
                  disabled={saving}
                  className="h-9 text-xs font-semibold px-6 gap-2"
                >
                  {saving ? 'Saving Credentials…' : 'Save & Continue to Step 2'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* STEP 2: Azure Bot Service & Messaging Endpoint */}
      {activeStep === 2 && (
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-bold">
                  STEP 2
                </Badge>
                <h3 className="text-base font-semibold">Configure Azure Bot Messaging Endpoint</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Link your Azure Bot resource to receive interactive actions and slash commands.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1.5 shrink-0">
              <a
                href="https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.BotService%2FbotServices"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Azure Bot Service <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>

          {/* Endpoint Box */}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <Bot className="h-4 w-4 text-primary" /> Bot Messaging Endpoint URL
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => copy(botEndpoint, 'endpoint')}
              >
                {copied === 'endpoint' ? (
                  <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 mr-1" />
                )}
                Copy Endpoint URL
              </Button>
            </div>
            <div className="font-mono text-xs p-2.5 rounded bg-background border truncate select-all">
              {botEndpoint}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Paste this URL into your Azure Bot under{' '}
              <span className="font-semibold text-foreground">
                Configuration &gt; Messaging endpoint
              </span>
              .
            </p>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4 space-y-2 text-xs">
            <h4 className="font-semibold text-foreground">Where to paste this in Azure:</h4>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground leading-relaxed">
              <li>Go to your Azure Bot resource in Azure Portal.</li>
              <li>
                Under the left sidebar, click{' '}
                <span className="font-medium text-foreground">Configuration</span>.
              </li>
              <li>
                Paste the URL above into the{' '}
                <span className="font-medium text-foreground">Messaging endpoint</span> field.
              </li>
              <li>
                Under <span className="font-medium text-foreground">Channels</span>, ensure{' '}
                <span className="font-medium text-foreground">Microsoft Teams</span> is enabled.
              </li>
              <li>
                Click <span className="font-medium text-foreground">Save</span>.
              </li>
            </ol>
          </div>

          <div className="flex justify-between items-center pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setActiveStep(1)}
            >
              Back to Step 1
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5"
              onClick={() => setActiveStep(3)}
            >
              Next: Step 3 (Install App Package) <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Teams App Package & Sideloading */}
      {activeStep === 3 && (
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-bold">
                  STEP 3
                </Badge>
                <h3 className="text-base font-semibold">
                  Download & Install the Teams App Package
                </h3>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Install OpsKnight into your Microsoft Teams organization or target workspace.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1.5 shrink-0">
              <a
                href="https://admin.teams.microsoft.com/policies/manage-apps"
                target="_blank"
                rel="noopener noreferrer"
              >
                Teams Admin Center <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>

          {/* Download and Manifest Actions */}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold">Pre-Configured Teams App Package</div>
                <div className="text-[11px] text-muted-foreground">
                  Includes your Client ID (
                  {config?.clientId ? `${config.clientId.slice(0, 8)}…` : 'not configured'}), app
                  icons, and Resource-Specific Consent permissions.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="default" size="sm" className="h-8 text-xs gap-1.5">
                  <a href="/api/microsoft-teams/package">
                    <Download className="h-3.5 w-3.5" /> Download App Package (.zip)
                  </a>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => copy(appManifestJson, 'manifest')}
              >
                {copied === 'manifest' ? (
                  <Check className="h-3 w-3 mr-1 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3 mr-1" />
                )}
                Copy manifest.json
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowManifest(!showManifest)}
              >
                <FileCode2 className="h-3 w-3 mr-1" />
                {showManifest ? 'Hide Manifest' : 'View Manifest JSON'}
              </Button>
            </div>

            {showManifest && (
              <pre className="max-h-60 overflow-auto rounded border bg-muted/40 p-3 text-[10px] font-mono leading-relaxed">
                {appManifestJson}
              </pre>
            )}
          </div>

          {/* Installation Method Options */}
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border p-3.5 space-y-1.5 bg-card">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Option A: Teams Admin
                Center (Recommended)
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                1. Open{' '}
                <a
                  href="https://admin.teams.microsoft.com/policies/manage-apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Teams Admin Center
                </a>{' '}
                &gt; <strong>Manage Apps</strong>.
                <br />
                2. Click <strong>Upload new app</strong> and upload the downloaded <code>.zip</code>{' '}
                file.
                <br />
                3. The app is now published org-wide for all channels and teams.
              </p>
            </div>

            <div className="rounded-lg border p-3.5 space-y-1.5 bg-card">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-blue-500" /> Option B: Direct Sideloading in Teams
                Client
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                1. Open Microsoft Teams desktop application.
                <br />
                2. Click <strong>Apps</strong> on the left bar &gt;{' '}
                <strong>Manage your apps</strong>.
                <br />
                3. Click <strong>Upload an app</strong> &gt; <strong>Upload a custom app</strong>.
                <br />
                4. Select the downloaded <code>.zip</code> and add it to your team.
              </p>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setActiveStep(2)}
            >
              Back to Step 2
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5"
              onClick={() => setActiveStep(4)}
            >
              Next: Step 4 (Verify & Test) <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: Consent, RSC Verification & Live Test */}
      {activeStep === 4 && (
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-bold">
                  STEP 4
                </Badge>
                <h3 className="text-base font-semibold">
                  Consent Verification & Live Channel Test
                </h3>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Verify that Resource-Specific Consent (RSC) is active and send a test incident card
                to your channel.
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                installationCount > 0
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs'
              }
            >
              {installationCount > 0
                ? `${installationCount} Team Installation(s) Verified`
                : 'Awaiting Installation in Teams'}
            </Badge>
          </div>

          {/* Installed Teams & RSC Checklist */}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <h4 className="text-xs font-semibold">Installed Teams & RSC Status</h4>
            {installationPermissions.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">
                No active team installations detected yet. Please complete Step 3 and install the
                app into at least one Team.
              </div>
            ) : (
              <div className="space-y-2">
                {installationPermissions.map(inst => {
                  const isHealthy = !inst.unknown && inst.missing.length === 0;
                  return (
                    <div
                      key={inst.teamId}
                      className="flex items-center justify-between p-3 rounded-lg border bg-background text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate">
                          {inst.teamName ?? 'Microsoft Teams Channel'}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate">
                          Team ID: {inst.teamId}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {inst.unknown
                            ? (inst.error ?? 'Permission probe pending')
                            : inst.missing.length === 0
                              ? 'All RSC permissions granted & verified'
                              : `Missing consent for: ${inst.missing.join(', ')}`}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${
                          isHealthy
                            ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                            : 'border-amber-300 text-amber-700 bg-amber-50'
                        }`}
                      >
                        {isHealthy
                          ? 'Healthy & Consented'
                          : inst.unknown
                            ? 'Unknown'
                            : 'Consent Required'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Test Card Trigger */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold flex items-center gap-1.5">
                  <Send className="h-3.5 w-3.5 text-primary" /> Live Test Card
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Send a sample interactive incident card to verify end-to-end delivery.
                </p>
              </div>
            </div>

            {destinations.length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">
                No channel destinations mapped yet. Switch to the{' '}
                <span className="font-semibold text-foreground">Channel Routing</span> tab to link a
                service to your Teams channel, then return here to send a test.
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {destinations.map(d => (
                  <Button
                    key={d.id}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => onTest(d.id)}
                    disabled={testingDestinationId === d.id}
                  >
                    <Send className="h-3 w-3" />
                    {testingDestinationId === d.id
                      ? 'Sending…'
                      : `Test ${d.service?.name ?? 'Service'} → ${d.channelName ?? d.channelId}`}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setActiveStep(3)}
            >
              Back to Step 3
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                toast.success('Microsoft Teams setup is complete and ready!');
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Setup Complete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import {
  generateScimTokenAction,
  revealScimTokenAction,
  revokeScimTokenAction,
} from '@/app/(app)/settings/security/actions';
import { notify as toast } from '@/lib/toast';
import {
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  ChevronDown,
  ChevronUp,
  BookOpen,
} from 'lucide-react';

export type ScimConfigProps = {
  enabled: boolean;
  hasSecretToken: boolean;
  tokenHint: string | null;
  source: 'DATABASE' | 'ENV' | 'NONE';
  createdAt: string | null;
  updatedAt: string | null;
};

export default function ScimSettingsSection({
  initialConfig,
  tenantUrl,
}: {
  initialConfig: ScimConfigProps;
  tenantUrl: string;
}) {
  const [config, setConfig] = useState<ScimConfigProps>(initialConfig);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [showEntraGuide, setShowEntraGuide] = useState(false);
  const [showOktaGuide, setShowOktaGuide] = useState(false);

  const copyToClipboard = async (text: string, type: 'url' | 'token') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'url') {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
        toast.success('Tenant URL copied to clipboard');
      } else {
        setCopiedToken(true);
        setTimeout(() => setCopiedToken(false), 2000);
        toast.success('SCIM Secret Token copied to clipboard');
      }
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleGenerateOrRotate = async () => {
    setIsGenerating(true);
    try {
      const res = await generateScimTokenAction();
      if (res.success && 'token' in res && res.token) {
        setConfig({
          enabled: true,
          hasSecretToken: true,
          tokenHint: 'tokenHint' in res ? res.tokenHint : null,
          source: 'DATABASE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        setRevealedToken(res.token);
        toast.success('SCIM Bearer Token generated successfully');
      } else {
        toast.error(('error' in res && res.error) || 'Failed to generate token');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error generating token');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReveal = async () => {
    if (revealedToken) {
      setRevealedToken(null);
      return;
    }
    setIsRevealing(true);
    try {
      const res = await revealScimTokenAction();
      if (res.success && 'token' in res && res.token) {
        setRevealedToken(res.token);
      } else {
        toast.error(('error' in res && res.error) || 'Failed to retrieve secret token');
      }
    } catch {
      toast.error('Could not retrieve token');
    } finally {
      setIsRevealing(false);
    }
  };

  const handleRevoke = async () => {
    setIsRevoking(true);
    try {
      const res = await revokeScimTokenAction();
      if (res.success) {
        setConfig({
          enabled: false,
          hasSecretToken: false,
          tokenHint: null,
          source: 'NONE',
          createdAt: null,
          updatedAt: null,
        });
        setRevealedToken(null);
        toast.success('SCIM token revoked successfully');
      } else {
        toast.error(res.error || 'Failed to revoke token');
      }
    } catch {
      toast.error('Error revoking token');
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border bg-card text-card-foreground">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-lg border ${
              config.enabled && config.hasSecretToken
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
            }`}
          >
            {config.enabled && config.hasSecretToken ? (
              <ShieldCheck className="h-5 w-5" />
            ) : (
              <ShieldAlert className="h-5 w-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">SCIM 2.0 User Lifecycle Engine</span>
              <Badge
                variant={config.enabled && config.hasSecretToken ? 'default' : 'secondary'}
                className={
                  config.enabled && config.hasSecretToken
                    ? 'bg-emerald-600 hover:bg-emerald-600 text-white text-[11px]'
                    : 'text-[11px]'
                }
              >
                {config.enabled && config.hasSecretToken ? 'Active & Ready' : 'Disabled / No Token'}
              </Badge>
              {config.source === 'DATABASE' && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  UI Managed
                </Badge>
              )}
              {config.source === 'ENV' && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  Environment Fallback
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automated user provisioning, updates, deactivation, and offboarding via RFC 7644 SCIM
              2.0 protocol.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!config.hasSecretToken ? (
            <Button
              size="sm"
              onClick={handleGenerateOrRotate}
              disabled={isGenerating}
              className="gap-1.5 text-xs"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {isGenerating ? 'Generating...' : 'Generate SCIM Token'}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isGenerating}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Rotate Token
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rotate SCIM Bearer Token?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Rotating the token will immediately invalidate the existing secret. You must
                    update the Secret Token in your Identity Provider (Microsoft Entra ID, Okta) to
                    maintain user provisioning.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleGenerateOrRotate}>
                    Rotate Token
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {config.hasSecretToken && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isRevoking}
                  className="text-destructive hover:text-destructive gap-1.5 text-xs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke SCIM Access?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will disable automated user provisioning from your identity provider until
                    a new token is generated. Existing provisioned users in OpsKnight will not be
                    deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRevoke}
                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  >
                    Revoke Token
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Credentials Panel */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Tenant URL Box */}
        <div className="space-y-2 p-4 rounded-xl border bg-muted/30">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tenant URL (Base URL)
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copyToClipboard(tenantUrl, 'url')}
              className="h-7 px-2 text-xs gap-1"
            >
              {copiedUrl ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-emerald-600">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy</span>
                </>
              )}
            </Button>
          </div>
          <div className="font-mono text-xs p-2.5 rounded-lg bg-background border select-all break-all">
            {tenantUrl}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Paste this into Entra ID &quot;Tenant URL&quot; or Okta &quot;Base URL&quot;.
          </p>
        </div>

        {/* Secret Token Box */}
        <div className="space-y-2 p-4 rounded-xl border bg-muted/30">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Secret Token (Bearer Secret)
            </label>
            {config.hasSecretToken && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleReveal}
                  disabled={isRevealing}
                  className="h-7 px-2 text-xs gap-1"
                >
                  {revealedToken ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      <span>Hide</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      <span>Reveal</span>
                    </>
                  )}
                </Button>
                {revealedToken && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyToClipboard(revealedToken, 'token')}
                    className="h-7 px-2 text-xs gap-1"
                  >
                    {copiedToken ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="font-mono text-xs p-2.5 rounded-lg bg-background border select-all break-all min-h-[38px] flex items-center">
            {revealedToken ? (
              revealedToken
            ) : config.hasSecretToken ? (
              <span className="text-muted-foreground">
                ••••••••••••••••••••••••••••••••••••••••••••••••••••
                {config.tokenHint ? ` (ends in ...${config.tokenHint})` : ''}
              </span>
            ) : (
              <span className="text-muted-foreground italic">No token generated yet</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {config.hasSecretToken
              ? 'Stored securely with authenticated AES-256-GCM encryption in your database.'
              : 'Click "Generate SCIM Token" above to generate a cryptographically secure token.'}
          </p>
        </div>
      </div>

      {/* Quick Setup Guides Accordion */}
      <div className="space-y-3 pt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" />
          Identity Provider Setup Guides
        </h4>

        {/* Microsoft Entra ID Guide */}
        <div className="border rounded-xl bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowEntraGuide(!showEntraGuide)}
            className="w-full flex items-center justify-between p-3.5 text-left text-xs font-medium hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Microsoft Entra ID (Azure AD)</span>
              <Badge variant="outline" className="text-[10px]">
                Recommended
              </Badge>
            </div>
            {showEntraGuide ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showEntraGuide && (
            <div className="p-4 pt-1 border-t text-xs text-muted-foreground space-y-2.5 bg-muted/10">
              <ol className="list-decimal list-inside space-y-1.5 pl-1">
                <li>
                  In <strong>Microsoft Entra ID</strong>, go to{' '}
                  <strong>Enterprise Applications</strong> $\to$ <strong>+ New Application</strong>{' '}
                  $\to$ <strong>Create your own application</strong>.
                </li>
                <li>
                  Name it <code>OpsKnight Provisioning</code> and select{' '}
                  <em>
                    &quot;Integrate any other application you don&apos;t find in the gallery
                    (Non-gallery)&quot;
                  </em>
                  .
                </li>
                <li>
                  Under <strong>Manage</strong> $\to$ <strong>Provisioning</strong>, change Mode to{' '}
                  <strong>Automatic</strong>.
                </li>
                <li>
                  Paste the <strong>Tenant URL</strong> and <strong>Secret Token</strong> from
                  above, then click <strong>Test Connection</strong>.
                </li>
                <li>
                  Under <strong>Mappings</strong>: Keep <em>Provision Microsoft Entra ID Users</em>{' '}
                  <strong>Enabled</strong>. You can also enable{' '}
                  <em>Provision Microsoft Entra ID Groups</em> to automatically synchronize security
                  groups directly into OpsKnight Teams and roster memberships!
                </li>
                <li>
                  Use <strong>Provision on demand</strong> to test an individual user or group
                  immediately!
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Okta Guide */}
        <div className="border rounded-xl bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowOktaGuide(!showOktaGuide)}
            className="w-full flex items-center justify-between p-3.5 text-left text-xs font-medium hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Okta SCIM Integration</span>
            </div>
            {showOktaGuide ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showOktaGuide && (
            <div className="p-4 pt-1 border-t text-xs text-muted-foreground space-y-2.5 bg-muted/10">
              <ol className="list-decimal list-inside space-y-1.5 pl-1">
                <li>
                  In your Okta application, go to the <strong>Provisioning</strong> tab and choose{' '}
                  <strong>Configure SCIM Integration</strong>.
                </li>
                <li>
                  Set <strong>SCIM connector base URL</strong> to the Tenant URL above.
                </li>
                <li>
                  Set <strong>Unique identifier field for users</strong> to <code>userName</code>.
                </li>
                <li>
                  Select <strong>HTTP Header</strong> authentication and paste the Secret Token into{' '}
                  <strong>Bearer Token</strong>.
                </li>
                <li>
                  Enable <strong>Create Users</strong>, <strong>Update User Attributes</strong>, and{' '}
                  <strong>Deactivate Users</strong>.
                </li>
                <li>
                  Under <strong>Push Groups</strong>, link any Okta groups to automatically create
                  and synchronize OpsKnight Teams and roster memberships in real time!
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  HelpCircle,
  ShieldCheck,
  TerminalSquare,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import {
  validateAgentEndpoint,
  type AgentDistribution,
} from '@/lib/runbooks/distribution-contract';
import { agentDeploymentIdentity, isAgentDeploymentName } from '@/lib/runbooks/agent-deployment';
import { agentSetupCommands } from '@/lib/runbooks/agent-setup-commands';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { cn } from '@/lib/utils';

function SetupBlock({ value, disabled = false }: { value: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError('Clipboard access failed. Select and copy the command text.');
    }
  }
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/90 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="mr-2 flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-zinc-300">
            <TerminalSquare className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
            Shell
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7.5 gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white"
          onClick={copy}
          disabled={disabled}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-zinc-200">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export default function AgentSetupInstructions({
  executionPublicKey,
  agentId,
  appUrl,
  distribution,
  expiresAt,
  initialOperation = 'install',
}: {
  token: string;
  agentId: string;
  executionPublicKey: string;
  appUrl?: string;
  distribution?: AgentDistribution | null;
  expiresAt?: string;
  initialOperation?: 'install' | 'upgrade';
}) {
  const deployment = agentDeploymentIdentity(agentId);
  const [operation, setOperation] = useState<'install' | 'upgrade'>(initialOperation);
  const [deploymentName, setDeploymentName] = useState(deployment.name);
  const validDeploymentName = isAgentDeploymentName(deploymentName);
  const [expired, setExpired] = useState(() =>
    expiresAt ? Date.parse(expiresAt) <= Date.now() : false
  );
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => setExpired(Date.parse(expiresAt) <= Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const [image, setImage] = useState(distribution?.manifest.image.reference ?? '');
  const [url, setUrl] = useState(appUrl && !validateAgentEndpoint(appUrl) ? appUrl : '');
  const [endpointConfirmed, setEndpointConfirmed] = useState(false);
  const endpointError = validateAgentEndpoint(url);
  const copyBlocked =
    (operation === 'install' && expired) ||
    (operation === 'upgrade' && !validDeploymentName) ||
    Boolean(endpointError) ||
    !endpointConfirmed ||
    !distribution ||
    image !== distribution.manifest.image.reference;

  const [policyPath, setPolicyPath] = useState('../../agent/policy.container.json');
  const snippets = useMemo(
    () =>
      agentSetupCommands({
        agentId,
        image,
        url,
        policyPath,
        executionPublicKey,
        distribution,
        operation,
        deploymentName: validDeploymentName ? deploymentName : deployment.name,
      }),
    [
      agentId,
      image,
      url,
      policyPath,
      executionPublicKey,
      distribution,
      operation,
      deploymentName,
      validDeploymentName,
      deployment.name,
    ]
  );

  return (
    <div className="space-y-6">
      {/* 1. Target Configuration & Deployment Settings Card */}
      <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs overflow-hidden">
        <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <Settings className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2">
                  <span className="text-muted-foreground font-mono text-xs">1.</span>
                  <span>
                    {operation === 'upgrade'
                      ? 'Upgrade & Deployment Configuration'
                      : 'Deploy this Agent'}
                  </span>
                  <Badge variant="outline" className="font-mono text-[11px] px-2 py-0.5">
                    {deployment.name}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {operation === 'upgrade'
                    ? 'Verify container image, Agent-reachable URL, and deployment name. Upgrades preserve existing enrolled identity volumes and local policy configuration.'
                    : 'Adjust the image and Agent-reachable URL, then copy one deployment method. The token is included only in this browser response and expires after 15 minutes.'}
                </CardDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {distribution && (
                <Badge variant="outline" className="text-[11px] font-semibold gap-1.5 py-1 px-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Release v{distribution.manifest.version}
                </Badge>
              )}
              {expiresAt && operation === 'install' && (
                <Badge
                  variant={expired ? 'destructive' : 'warning'}
                  className="text-[11px] font-semibold gap-1.5 py-1 px-2.5"
                >
                  <Clock className="h-3 w-3" />
                  {expired ? 'Token Expired' : '15m Window Active'}
                </Badge>
              )}
              {operation === 'upgrade' && (
                <Badge
                  variant="outline"
                  className="text-[11px] font-semibold gap-1.5 py-1 px-2.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Persistent Identity Kept
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 sm:p-6 space-y-5">
          <p className="text-xs text-muted-foreground">
            Enrollment deployment name:{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
              {deployment.name}
            </code>
            . Keep this name with the persisted Agent identity.
          </p>

          {/* Operation selector */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3 sm:px-4">
            <label
              htmlFor="agent-deployment-op"
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              Deployment operation
            </label>
            <select
              id="agent-deployment-op"
              aria-label="Deployment operation"
              value={operation}
              onChange={event => setOperation(event.target.value as 'install' | 'upgrade')}
              className="h-9 w-full sm:w-auto rounded-lg border border-input bg-background px-3 text-xs font-medium shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="install">Install new independent Agent</option>
              <option value="upgrade">Upgrade this installed Agent, preserving identity</option>
            </select>
          </div>

          {operation === 'upgrade' && (
            <div className="space-y-1.5 rounded-xl border border-border/60 bg-muted/20 p-3.5">
              <label htmlFor="agent-upgrade-name" className="text-xs font-bold text-foreground">
                Existing deployment name
              </label>
              <Input
                id="agent-upgrade-name"
                aria-label="Existing deployment name"
                value={deploymentName}
                maxLength={45}
                className="h-9 bg-background font-mono text-xs"
                onChange={event => setDeploymentName(event.target.value)}
              />
              <span className="block text-[11px] text-muted-foreground">
                Match the saved installation name. Older installations may use opsknight-agent.
                Changing the Compose project name creates a different volume.
              </span>
              {!validDeploymentName && (
                <p role="alert" className="text-xs font-semibold text-destructive">
                  Use a deployment name of at most 45 lowercase letters, numbers or hyphens.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3.5 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-setup-image" className="text-xs font-bold">
                Agent image
              </Label>
              <Input
                id="agent-setup-image"
                value={image}
                className="h-9 font-mono text-xs bg-background"
                onChange={event => setImage(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-setup-url" className="text-xs font-bold">
                OpsKnight URL from Agent
              </Label>
              <Input
                id="agent-setup-url"
                value={url}
                className="h-9 font-mono text-xs bg-background"
                onChange={event => {
                  setUrl(event.target.value);
                  setEndpointConfirmed(false);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-setup-policy" className="text-xs font-bold">
                Compose policy path
              </Label>
              <Input
                id="agent-setup-policy"
                value={policyPath}
                className="h-9 font-mono text-xs bg-background"
                onChange={event => setPolicyPath(event.target.value)}
              />
            </div>
          </div>

          {/* Reachability confirmation */}
          <label
            className={cn(
              'flex items-center gap-3 rounded-xl border p-3.5 text-xs font-medium transition-colors cursor-pointer',
              endpointConfirmed
                ? 'border-emerald-500/40 bg-emerald-500/[0.04] text-foreground'
                : 'border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted/50'
            )}
          >
            <input
              type="checkbox"
              checked={endpointConfirmed}
              className="h-4 w-4 rounded border-border text-primary accent-primary"
              onChange={event => setEndpointConfirmed(event.target.checked)}
            />
            <span>I confirmed this URL is reachable from the Agent host or cluster.</span>
          </label>

          {/* Status Alerts */}
          {expired && operation === 'install' && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
            >
              Enrollment token expired. Create a new enrollment before installing.
            </p>
          )}
          {!distribution && (
            <p
              role="alert"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-medium text-amber-800 dark:text-amber-200"
            >
              No verified Agent release is available for this server. Install commands cannot be
              copied until compatible published artifacts are available.
            </p>
          )}
          {distribution && (
            <p className="text-xs text-muted-foreground">
              Verified release {distribution.manifest.version} · protocol{' '}
              {distribution.manifest.protocolVersions.join(', ')} · installer checksum checked.
              Image digest is pinned.
            </p>
          )}
          {distribution && image !== distribution.manifest.image.reference && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
            >
              This image differs from the verified release digest. Restore the verified digest to
              enable copying.
            </p>
          )}
          {endpointError && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
            >
              {endpointError}
            </p>
          )}

          <p className="text-xs text-muted-foreground leading-relaxed">
            To replace a lost or compromised identity, revoke the old Agent and create a new
            enrollment. Use its new deployment name and a new volume; never reuse or copy the old
            identity.
          </p>
        </CardContent>
      </Card>

      {/* 2. Deployment Manifest & Commands Card */}
      <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs overflow-hidden">
        <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <TerminalSquare className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2">
                  <span className="text-muted-foreground font-mono text-xs">2.</span>
                  <span>Deployment Commands & Manifests</span>
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Execute these commands from your repository root or cluster management host.
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[11px] font-mono">
              HTTPS Requisite
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-5 sm:p-6 space-y-4">
          <Tabs defaultValue="compose" className="space-y-4">
            <TabsList className="h-auto flex-wrap gap-1 rounded-xl bg-muted/60 p-1 border border-border/60">
              <TabsTrigger value="compose">Compose</TabsTrigger>
              <TabsTrigger value="swarm">Swarm</TabsTrigger>
              <TabsTrigger value="helm">Helm</TabsTrigger>
              <TabsTrigger value="kustomize">Kustomize</TabsTrigger>
              <TabsTrigger value="linux">Linux</TabsTrigger>
            </TabsList>
            <TabsContent value="compose">
              <SetupBlock disabled={copyBlocked} value={snippets.compose} />
            </TabsContent>
            <TabsContent value="swarm">
              <SetupBlock disabled={copyBlocked} value={snippets.swarm} />
            </TabsContent>
            <TabsContent value="helm">
              <SetupBlock disabled={copyBlocked} value={snippets.helm} />
            </TabsContent>
            <TabsContent value="kustomize">
              <SetupBlock disabled={copyBlocked} value={snippets.kustomize} />
            </TabsContent>
            <TabsContent value="linux">
              {distribution ? (
                <SetupBlock disabled={copyBlocked} value={snippets.linux} />
              ) : (
                <p className="rounded-xl border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground">
                  Native installation is unavailable until official installer assets are published
                  and verified.
                </p>
              )}
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground leading-relaxed">
            These commands deploy only the Agent and require an existing OpsKnight installation. Run
            them from the repository root. Use an Agent-reachable HTTPS URL. Secret-backed steps
            require HTTPS, including container Agents. All generated setup commands require HTTPS.
            Keep the enrollment Secret while the deployment references it; the consumed token cannot
            enroll again. Persisted identity is used after enrollment.
          </p>
        </CardContent>
      </Card>

      {/* 3. Preflight Diagnostics & Verification Checklist Card */}
      <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs overflow-hidden">
        <details className="group" open>
          <summary className="cursor-pointer list-none select-none">
            <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                    <HelpCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2">
                      <span className="text-muted-foreground font-mono text-xs">3.</span>
                      <span>Installation Preflight & Diagnostics</span>
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Container diagnostics describe the container. Host Systemd, container sockets
                      and Kubernetes permissions require explicit provisioning.
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="text-[11px]">
                  6 Verification Gates
                </Badge>
              </div>
            </CardHeader>
          </summary>

          <CardContent className="p-5 sm:p-6">
            <ol className="grid gap-3 sm:grid-cols-2 text-xs leading-relaxed text-muted-foreground list-none p-0">
              <li className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <span className="font-bold text-foreground flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-[10px]">
                    1
                  </span>
                  Endpoint and certificate trust
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  The generated curl command must succeed from the Agent host. Install the private
                  CA in that host and container trust store if needed; do not disable TLS
                  verification.
                </p>
              </li>
              <li className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <span className="font-bold text-foreground flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-[10px]">
                    2
                  </span>
                  Image compatibility
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Copying is enabled only for the verified server-compatible image digest and
                  checked installer checksum.
                </p>
              </li>
              <li className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <span className="font-bold text-foreground flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-[10px]">
                    3
                  </span>
                  Enrollment
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  A new installation consumes one token once. An upgrade uses the existing identity
                  and requires no new token.
                </p>
              </li>
              <li className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <span className="font-bold text-foreground flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-[10px]">
                    4
                  </span>
                  Persistence
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Retain this deployment name, its identity volume or PVC and its node pin. Never
                  mount one identity into two running Agents.
                </p>
              </li>
              <li className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <span className="font-bold text-foreground flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-[10px]">
                    5
                  </span>
                  Policy
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Inspect runtime capabilities and local policy in the Agent drawer. An online
                  heartbeat alone does not grant execution authority.
                </p>
              </li>
              <li className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <span className="font-bold text-foreground flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-[10px]">
                    6
                  </span>
                  First heartbeat
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Return to the Agent fleet and confirm the selected Agent is Online with a recent
                  authenticated heartbeat. If degraded, inspect its error, spool and dead-letter
                  diagnostics.
                </p>
              </li>
            </ol>
          </CardContent>
        </details>
      </Card>
    </div>
  );
}

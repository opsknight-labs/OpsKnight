'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ShieldCheck, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  validateAgentEndpoint,
  type AgentDistribution,
} from '@/lib/runbooks/distribution-contract';
import { agentDeploymentIdentity, isAgentDeploymentName } from '@/lib/runbooks/agent-deployment';
import { agentSetupCommands } from '@/lib/runbooks/agent-setup-commands';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';

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
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <TerminalSquare className="h-3.5 w-3.5" aria-hidden="true" />
          Shell
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={copy}
          disabled={disabled}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="border-b px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5">
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
    <div className="space-y-5 rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Deploy this Agent</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Adjust the image and Agent-reachable URL, then copy one deployment method. The token is
            included only in this browser response and expires after 15 minutes.
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Enrollment deployment name:{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">{deployment.name}</code>. Keep this
        name with the persisted Agent identity.
      </p>
      <label className="flex flex-col gap-1.5 text-xs font-medium sm:flex-row sm:items-center sm:gap-3">
        Deployment operation
        <select
          aria-label="Deployment operation"
          value={operation}
          onChange={event => setOperation(event.target.value as 'install' | 'upgrade')}
          className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm font-normal shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <option value="install">Install new independent Agent</option>
          <option value="upgrade">Upgrade this installed Agent, preserving identity</option>
        </select>
      </label>
      {operation === 'upgrade' && (
        <label className="block space-y-1.5 text-xs font-medium">
          Existing deployment name
          <Input
            aria-label="Existing deployment name"
            value={deploymentName}
            maxLength={45}
            onChange={event => setDeploymentName(event.target.value)}
          />
          <span className="block text-xs font-normal text-muted-foreground">
            Match the saved installation name. Older installations may use opsknight-agent. Changing
            the Compose project name creates a different volume.
          </span>
        </label>
      )}
      {!validDeploymentName && operation === 'upgrade' && (
        <p role="alert" className="text-sm text-destructive">
          Use a deployment name of at most 45 lowercase letters, numbers or hyphens.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        To replace a lost or compromised identity, revoke the old Agent and create a new enrollment.
        Use its new deployment name and a new volume; never reuse or copy the old identity.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="agent-setup-image" className="text-xs">
            Agent image
          </Label>
          <Input
            id="agent-setup-image"
            value={image}
            className="font-mono text-xs"
            onChange={event => setImage(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-setup-url" className="text-xs">
            OpsKnight URL from Agent
          </Label>
          <Input
            id="agent-setup-url"
            value={url}
            className="font-mono text-xs"
            onChange={event => {
              setUrl(event.target.value);
              setEndpointConfirmed(false);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-setup-policy" className="text-xs">
            Compose policy path
          </Label>
          <Input
            id="agent-setup-policy"
            value={policyPath}
            className="font-mono text-xs"
            onChange={event => setPolicyPath(event.target.value)}
          />
        </div>
      </div>
      {expired && operation === 'install' && (
        <p role="alert" className="text-sm text-destructive">
          Enrollment token expired. Create a new enrollment before installing.
        </p>
      )}
      {!distribution && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
          No verified Agent release is available for this server. Install commands cannot be copied
          until compatible published artifacts are available.
        </p>
      )}
      {distribution && (
        <p className="text-xs text-muted-foreground">
          Verified release {distribution.manifest.version} · protocol{' '}
          {distribution.manifest.protocolVersions.join(', ')} · installer checksum checked. Image
          digest is pinned.
        </p>
      )}
      {distribution && image !== distribution.manifest.image.reference && (
        <p role="alert" className="text-sm text-destructive">
          This image differs from the verified release digest. Restore the verified digest to enable
          copying.
        </p>
      )}
      {endpointError && (
        <p role="alert" className="text-sm text-destructive">
          {endpointError}
        </p>
      )}
      <label className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3 text-sm">
        <input
          type="checkbox"
          checked={endpointConfirmed}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          onChange={event => setEndpointConfirmed(event.target.checked)}
        />
        I confirmed this URL is reachable from the Agent host or cluster.
      </label>
      <p className="text-xs text-muted-foreground">
        Container diagnostics describe the container. Host Systemd, container sockets and Kubernetes
        permissions require explicit provisioning; binary availability does not prove target
        authorization.
      </p>
      <details className="group rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Installation preflight and diagnostics
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">
          <li>
            Endpoint and certificate trust: the generated curl command must succeed from the Agent
            host. Install the private CA in that host and container trust store if needed; do not
            disable TLS verification.
          </li>
          <li>
            Image compatibility: copying is enabled only for the verified server-compatible image
            digest and checked installer checksum.
          </li>
          <li>
            Enrollment: a new installation consumes one token once. An upgrade uses the existing
            identity and requires no new token.
          </li>
          <li>
            Persistence: retain this deployment name, its identity volume or PVC and its node pin.
            Never mount one identity into two running Agents.
          </li>
          <li>
            Policy: inspect runtime capabilities and local policy in the Agent drawer. An online
            heartbeat alone does not grant execution authority.
          </li>
          <li>
            First heartbeat: return to the Agent fleet and confirm the selected Agent is Online with
            a recent authenticated heartbeat. If degraded, inspect its error, spool and dead-letter
            diagnostics.
          </li>
        </ol>
      </details>
      <Tabs defaultValue="compose" className="space-y-3">
        <TabsList className="h-auto flex-wrap justify-start">
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
            <p className="text-sm text-muted-foreground">
              Native installation is unavailable until official installer assets are published and
              verified.
            </p>
          )}
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        These commands deploy only the Agent and require an existing OpsKnight installation. Run
        them from the repository root. Use an Agent-reachable HTTPS URL. Secret-backed steps require
        HTTPS, including container Agents. All generated setup commands require HTTPS. Keep the
        enrollment Secret while the deployment references it; the consumed token cannot enroll
        again. Persisted identity is used after enrollment.
      </p>
    </div>
  );
}

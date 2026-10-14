'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  validateAgentEndpoint,
  type AgentDistribution,
} from '@/lib/runbooks/distribution-contract';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function imageParts(image: string) {
  const digestSeparator = image.indexOf('@');
  if (digestSeparator > 0)
    return {
      repository: image.slice(0, digestSeparator),
      digest: image.slice(digestSeparator + 1),
    };
  const tagSeparator = image.lastIndexOf(':');
  const hasTag = tagSeparator > image.lastIndexOf('/');
  return {
    repository: hasTag ? image.slice(0, tagSeparator) : image,
    tag: hasTag ? image.slice(tagSeparator + 1) : 'REQUIRES_VERIFIED_RELEASE',
  };
}

function helmImageArguments(image: string): string {
  const digestSeparator = image.indexOf('@');
  if (digestSeparator > 0) {
    return `--set-string agent.image.repository=${shellQuote(image.slice(0, digestSeparator))} \\
  --set-string agent.image.digest=${shellQuote(image.slice(digestSeparator + 1))}`;
  }
  const lastSlash = image.lastIndexOf('/');
  const tagSeparator = image.lastIndexOf(':');
  const hasTag = tagSeparator > lastSlash;
  return `--set-string agent.image.repository=${shellQuote(hasTag ? image.slice(0, tagSeparator) : image)} \\
  --set-string agent.image.tag=${shellQuote(hasTag ? image.slice(tagSeparator + 1) : 'REQUIRES_VERIFIED_RELEASE')}`;
}

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
    <div className="relative">
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-4 pr-24 text-xs leading-5">
        <code>{value}</code>
      </pre>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="absolute right-2 top-2"
        onClick={copy}
        disabled={disabled}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export default function AgentSetupInstructions({
  executionPublicKey,
  appUrl,
  distribution,
  expiresAt,
}: {
  token: string;
  executionPublicKey: string;
  appUrl?: string;
  distribution?: AgentDistribution | null;
  expiresAt?: string;
}) {
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
    expired ||
    Boolean(endpointError) ||
    !endpointConfirmed ||
    !distribution ||
    image !== distribution.manifest.image.reference;

  const [policyPath, setPolicyPath] = useState('../../agent/policy.container.json');
  const snippets = useMemo(() => {
    const helmImage = helmImageArguments(image);
    const parsedImage = imageParts(image);
    const namespace =
      'kubectl create namespace opsknight --dry-run=client -o yaml | kubectl apply -f -';
    const kustomization = JSON.stringify({
      apiVersion: 'kustomize.config.k8s.io/v1beta1',
      kind: 'Kustomization',
      namespace: 'opsknight',
      resources: ['deployment.yaml', 'policy.yaml', 'service-account.yaml', 'pvc.yaml'],
      images: [
        {
          name: 'ghcr.io/opsknight-labs/opsknight-agent',
          newName: parsedImage.repository,
          ...(parsedImage.digest ? { digest: parsedImage.digest } : { newTag: parsedImage.tag }),
        },
      ],
      patches: [
        {
          target: { kind: 'Deployment', name: 'opsknight-agent' },
          patch: JSON.stringify([
            { op: 'replace', path: '/spec/template/spec/containers/0/env/0/value', value: url },
          ]),
        },
      ],
    });
    const captureToken = `# Run in Bash. Paste the one-time token at the hidden prompt.
set +x
set -euo pipefail
umask 077
agent_credential_dir=$(mktemp -d)
IFS= read -r -s -p 'Enrollment token: ' agent_enrollment_token
printf '\\n'
printf '%s' "$agent_enrollment_token" > "$agent_credential_dir/enrollment-token"
unset agent_enrollment_token
# The directory stays private; the container can read the mounted token file.
chmod 0644 "$agent_credential_dir/enrollment-token"
# Check connectivity and certificate trust from the Agent host before enrollment.
curl --fail --silent --show-error --max-time 10 ${shellQuote(`${url.replace(/\/+$/, '')}/api/runbook-agent/v1/time`)}`;
    const compose = `${captureToken}
export OPSKNIGHT_AGENT_IMAGE=${shellQuote(image)}
export OPSKNIGHT_AGENT_URL=${shellQuote(url)}
export OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_PATH="$agent_credential_dir/enrollment-token"
export OPSKNIGHT_EXECUTION_PUBLIC_KEY=${shellQuote(executionPublicKey)}
export OPSKNIGHT_AGENT_POLICY_PATH=${shellQuote(policyPath)}

docker compose -p opsknight-agent -f deploy/compose/docker-compose.agent.yml -f deploy/compose/docker-compose.agent.enrollment-file.yml up -d opsknight-agent`;
    const swarm = `${captureToken}
docker secret create opsknight_agent_enrollment_token < "$agent_credential_dir/enrollment-token"
export OPSKNIGHT_AGENT_IMAGE=${shellQuote(image)}
export OPSKNIGHT_AGENT_URL=${shellQuote(url)}
export OPSKNIGHT_EXECUTION_PUBLIC_KEY=${shellQuote(executionPublicKey)}

# Use an existing overlay network reachable from this Agent.
export SWARM_NETWORK_NAME=opsknight
IFS= read -r -p 'Swarm node ID for this Agent identity: ' OPSKNIGHT_AGENT_NODE_ID
export OPSKNIGHT_AGENT_NODE_ID
docker stack deploy --with-registry-auth \\
  -c deploy/swarm/docker-stack.agent.yml opsknight-agent`;
    const helm = `${captureToken}
${namespace}
kubectl -n opsknight create secret generic opsknight-agent-enrollment \\
  --from-file=OPSKNIGHT_AGENT_ENROLLMENT_TOKEN="$agent_credential_dir/enrollment-token" \\
  --from-literal=OPSKNIGHT_EXECUTION_PUBLIC_KEY=${shellQuote(executionPublicKey)}

helm upgrade --install opsknight-agent deploy/kubernetes/helm/opsknight-agent \\
  --namespace opsknight --create-namespace \\
  --set agent.enabled=true \\
  --set-string agent.url=${shellQuote(url)} \\
  ${helmImage} \\
  --set agent.enrollmentToken.existingSecret=opsknight-agent-enrollment`;
    const kustomize = `${captureToken}
${namespace}
kubectl -n opsknight create secret generic opsknight-agent-enrollment \\
  --from-file=enrollment-token="$agent_credential_dir/enrollment-token" \\
  --from-literal=OPSKNIGHT_EXECUTION_PUBLIC_KEY=${shellQuote(executionPublicKey)}

# Build an Agent-only overlay with the selected URL and image.
agent_setup_dir=$(mktemp -d)
cp deploy/kubernetes/kustomize/components/agent/deployment.yaml deploy/kubernetes/kustomize/components/agent/policy.yaml deploy/kubernetes/kustomize/components/agent/service-account.yaml deploy/kubernetes/kustomize/components/agent/pvc.yaml "$agent_setup_dir/"
printf '%s' ${shellQuote(kustomization)} > "$agent_setup_dir/kustomization.yaml"
kubectl apply -k "$agent_setup_dir"
rm -rf "$agent_setup_dir"`;
    const linux = distribution
      ? `${captureToken}
curl --fail --silent --show-error ${shellQuote(distribution.installerUrl)} -o "$agent_credential_dir/install.sh"
printf '%s  %s\\n' ${shellQuote(distribution.manifest.installer.sha256)} "$agent_credential_dir/install.sh" | sha256sum --check -
sudo bash "$agent_credential_dir/install.sh" \\
  --url ${shellQuote(url)} \\
  --key ${shellQuote(executionPublicKey)} \\
  --token-file "$agent_credential_dir/enrollment-token"
sudo /opt/opsknight-agent/preflight.sh`
      : '';

    return { compose, swarm, helm, kustomize, linux };
  }, [image, policyPath, url, distribution, executionPublicKey]);

  return (
    <div className="space-y-4 rounded-lg border bg-background p-4">
      <div className="flex gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div>
          <p className="font-semibold">Deploy this Agent</p>
          <p className="text-xs text-muted-foreground">
            Adjust the image and Agent-reachable URL, then copy one deployment method. The token is
            included only in this browser response and expires after 15 minutes.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="agent-setup-image">Agent image</Label>
          <Input
            id="agent-setup-image"
            value={image}
            onChange={event => setImage(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="agent-setup-url">OpsKnight URL from Agent</Label>
          <Input
            id="agent-setup-url"
            value={url}
            onChange={event => {
              setUrl(event.target.value);
              setEndpointConfirmed(false);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="agent-setup-policy">Compose policy path</Label>
          <Input
            id="agent-setup-policy"
            value={policyPath}
            onChange={event => setPolicyPath(event.target.value)}
          />
        </div>
      </div>
      {expired && (
        <p role="alert" className="text-sm text-destructive">
          Enrollment token expired. Create a new enrollment before installing.
        </p>
      )}
      {!distribution && (
        <p role="alert" className="text-sm text-amber-700">
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
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={endpointConfirmed}
          onChange={event => setEndpointConfirmed(event.target.checked)}
        />
        I confirmed this URL is reachable from the Agent host or cluster.
      </label>
      <p className="text-xs text-muted-foreground">
        Container diagnostics describe the container. Host Systemd, container sockets and Kubernetes
        permissions require explicit provisioning; binary availability does not prove target
        authorization.
      </p>
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
        HTTPS, including container Agents; internal HTTP URLs only support steps without secrets.
        Keep the enrollment Secret while the deployment references it; the consumed token cannot
        enroll again. Persisted identity is used after enrollment.
      </p>
    </div>
  );
}

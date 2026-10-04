'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
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
  --set-string agent.image.tag=${shellQuote(hasTag ? image.slice(tagSeparator + 1) : '2.0.0')}`;
}

function SetupBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-4 pr-24 text-xs leading-5">
        <code>{value}</code>
      </pre>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="absolute right-2 top-2"
        onClick={copy}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export default function AgentSetupInstructions({ token }: { token: string }) {
  const [image, setImage] = useState('ghcr.io/opsknight-labs/opsknight-agent:2.0.0');
  const [url, setUrl] = useState('http://opsknight-app:3000');
  const [policyPath, setPolicyPath] = useState('../../agent/policy.container.json');
  const snippets = useMemo(() => {
    const helmImage = helmImageArguments(image);
    const compose = `export OPSKNIGHT_AGENT_IMAGE=${shellQuote(image)}
export OPSKNIGHT_AGENT_URL=${shellQuote(url)}
export OPSKNIGHT_AGENT_ENROLLMENT_TOKEN=${shellQuote(token)}
export OPSKNIGHT_AGENT_POLICY_PATH=${shellQuote(policyPath)}

docker compose -f deploy/compose/docker-compose.yml \\
  -f deploy/compose/docker-compose.agent.yml up -d opsknight-agent`;
    const swarm = `printf '%s' ${shellQuote(token)} | docker secret create opsknight_agent_enrollment_token -
export OPSKNIGHT_AGENT_IMAGE=${shellQuote(image)}
export OPSKNIGHT_AGENT_URL=${shellQuote(url)}

docker stack deploy --with-registry-auth \\
  -c deploy/swarm/docker-stack.integrated.yml \\
  -c deploy/swarm/docker-stack.agent.yml opsknight`;
    const helm = `kubectl -n opsknight create secret generic opsknight-agent-enrollment \\
  --from-literal=OPSKNIGHT_AGENT_ENROLLMENT_TOKEN=${shellQuote(token)}

helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \\
  --namespace opsknight --create-namespace \\
  --set agent.enabled=true \\
  ${helmImage} \\
  --set agent.enrollmentToken.existingSecret=opsknight-agent-enrollment`;
    const kustomize = `kubectl -n opsknight create secret generic opsknight-agent-enrollment \\
  --from-literal=enrollment-token=${shellQuote(token)}

# Choose integrated-agent or split-agent for your runtime.
kubectl apply -k deploy/kubernetes/kustomize/profiles/integrated-agent`;
    const linux = `# /etc/opsknight-agent/agent.env (mode 0600)
OPSKNIGHT_URL=${url}
OPSKNIGHT_AGENT_ENROLLMENT_TOKEN=${token}
OPSKNIGHT_AGENT_POLICY_FILE=/etc/opsknight-agent/policy.json
OPSKNIGHT_AGENT_DATA_DIR=/var/lib/opsknight-agent

sudo systemctl enable --now opsknight-agent`;
    return { compose, swarm, helm, kustomize, linux };
  }, [image, policyPath, token, url]);

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
          <Input id="agent-setup-url" value={url} onChange={event => setUrl(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="agent-setup-policy">Local policy path</Label>
          <Input
            id="agent-setup-policy"
            value={policyPath}
            onChange={event => setPolicyPath(event.target.value)}
          />
        </div>
      </div>
      <Tabs defaultValue="compose" className="space-y-3">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="swarm">Swarm</TabsTrigger>
          <TabsTrigger value="helm">Helm</TabsTrigger>
          <TabsTrigger value="kustomize">Kustomize</TabsTrigger>
          <TabsTrigger value="linux">Linux</TabsTrigger>
        </TabsList>
        <TabsContent value="compose">
          <SetupBlock value={snippets.compose} />
        </TabsContent>
        <TabsContent value="swarm">
          <SetupBlock value={snippets.swarm} />
        </TabsContent>
        <TabsContent value="helm">
          <SetupBlock value={snippets.helm} />
        </TabsContent>
        <TabsContent value="kustomize">
          <SetupBlock value={snippets.kustomize} />
        </TabsContent>
        <TabsContent value="linux">
          <SetupBlock value={snippets.linux} />
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        Split runtimes use <code>http://opsknight-web:3000</code>. Native and remote Agents should
        use the externally reachable HTTPS URL. Remove the enrollment token after the first
        successful heartbeat; the persisted identity is used afterward.
      </p>
    </div>
  );
}

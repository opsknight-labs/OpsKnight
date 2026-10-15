import type { AgentDistribution } from './distribution-contract';
import {
  agentDeploymentIdentity,
  agentKustomization,
  isAgentDeploymentName,
} from './agent-deployment';
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
  --set-string agent.image.tag=${shellQuote(hasTag ? image.slice(tagSeparator + 1) : 'REQUIRES_VERIFIED_RELEASE')}`;
}

export function agentSetupCommands({
  agentId,
  image,
  url,
  policyPath,
  executionPublicKey,
  distribution,
  operation = 'install',
  deploymentName,
}: {
  agentId: string;
  image: string;
  url: string;
  policyPath: string;
  executionPublicKey: string;
  distribution?: AgentDistribution | null;
  operation?: 'install' | 'upgrade';
  deploymentName?: string;
}) {
  const deployment = agentDeploymentIdentity(agentId);
  if (operation === 'upgrade' && deploymentName) {
    if (!isAgentDeploymentName(deploymentName))
      throw new Error(
        'Deployment name must use lowercase letters, numbers and hyphens (maximum 45 characters).'
      );
    deployment.name = deploymentName;
  }

  const helmImage = helmImageArguments(image);
  const namespace =
    'kubectl create namespace opsknight --dry-run=client -o yaml | kubectl apply -f -';
  const kustomization = JSON.stringify(agentKustomization(agentId, url, image));
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

docker compose -p ${deployment.name} -f deploy/compose/docker-compose.agent.yml -f deploy/compose/docker-compose.agent.enrollment-file.yml up -d opsknight-agent`;
  const swarm = `${captureToken}
docker secret create ${deployment.enrollmentSecret} - < "$agent_credential_dir/enrollment-token"
export OPSKNIGHT_AGENT_IMAGE=${shellQuote(image)}
export OPSKNIGHT_AGENT_ENROLLMENT_SECRET=${shellQuote(deployment.enrollmentSecret)}
export OPSKNIGHT_AGENT_URL=${shellQuote(url)}
export OPSKNIGHT_EXECUTION_PUBLIC_KEY=${shellQuote(executionPublicKey)}

# Use an existing overlay network reachable from this Agent.
export SWARM_NETWORK_NAME="\${SWARM_NETWORK_NAME:-opsknight}"
IFS= read -r -p 'Swarm node ID for this Agent identity: ' OPSKNIGHT_AGENT_NODE_ID
export OPSKNIGHT_AGENT_NODE_ID
docker stack deploy --with-registry-auth \\
  -c deploy/swarm/docker-stack.agent.yml ${deployment.name}`;
  const helm = `${captureToken}
${namespace}
kubectl -n opsknight create secret generic ${deployment.enrollmentSecret} \\
  --from-file=OPSKNIGHT_AGENT_ENROLLMENT_TOKEN="$agent_credential_dir/enrollment-token" \\
  --from-literal=OPSKNIGHT_EXECUTION_PUBLIC_KEY=${shellQuote(executionPublicKey)}

helm upgrade --install ${deployment.name} deploy/kubernetes/helm/opsknight-agent \\
  --namespace opsknight --create-namespace \\
  --set agent.enabled=true \\
  --set-string agent.url=${shellQuote(url)} \\
  ${helmImage} \\
  --set-string agent.enrollmentToken.existingSecret=${shellQuote(deployment.enrollmentSecret)}`;
  const kustomize = `${captureToken}
${namespace}
# Keep this overlay for upgrades and removal; it contains a one-time credential.
agent_setup_dir=${shellQuote(`./${deployment.name}`)}
mkdir -m 0700 "$agent_setup_dir"
kubectl -n opsknight create secret generic opsknight-agent-enrollment \\
  --from-file=enrollment-token="$agent_credential_dir/enrollment-token" \\
  --from-literal=OPSKNIGHT_EXECUTION_PUBLIC_KEY=${shellQuote(executionPublicKey)} \\
  --dry-run=client -o yaml > "$agent_setup_dir/enrollment.yaml"
cp deploy/kubernetes/kustomize/components/agent/deployment.yaml deploy/kubernetes/kustomize/components/agent/policy.yaml deploy/kubernetes/kustomize/components/agent/service-account.yaml deploy/kubernetes/kustomize/components/agent/pvc.yaml "$agent_setup_dir/"
printf '%s' ${shellQuote(kustomization)} > "$agent_setup_dir/kustomization.yaml"
kubectl apply -k "$agent_setup_dir"`;
  const linux = distribution
    ? `${captureToken}
curl --fail --silent --show-error ${shellQuote(distribution.installerUrl)} -o "$agent_credential_dir/install.sh"
printf '%s  %s\\n' ${shellQuote(distribution.manifest.installer.sha256)} "$agent_credential_dir/install.sh" | sha256sum --check -
sudo bash "$agent_credential_dir/install.sh" \\
  --version ${shellQuote(distribution.manifest.version)} \\
  --url ${shellQuote(url)} \\
  --key ${shellQuote(executionPublicKey)} \\
  --token-file "$agent_credential_dir/enrollment-token"
sudo /opt/opsknight-agent/preflight.sh`
    : '';

  if (operation === 'upgrade')
    return {
      compose: `# Preserve the existing project and identity volume. Do not use down -v.
set -euo pipefail
export OPSKNIGHT_AGENT_IMAGE=${shellQuote(image)}
export OPSKNIGHT_AGENT_URL=${shellQuote(url)}
export OPSKNIGHT_EXECUTION_PUBLIC_KEY=${shellQuote(executionPublicKey)}
export OPSKNIGHT_AGENT_POLICY_PATH=${shellQuote(policyPath)}
docker compose -p ${deployment.name} -f deploy/compose/docker-compose.agent.yml up -d opsknight-agent`,
      swarm: `# Update only this service; retain its pinned node, secrets and identity volume.
docker service update --image ${shellQuote(image)} ${deployment.name}_opsknight-agent`,
      helm: `# Require an existing release. Reuse its URL, policy, Secret and PVC.
helm upgrade ${deployment.name} deploy/kubernetes/helm/opsknight-agent \\
  --namespace opsknight --reuse-values \\
  ${helmImage}`,
      kustomize: `# Update this Agent only; retain its Secret, selector and PVC.
kubectl -n opsknight set image deployment/${deployment.name} agent=${shellQuote(image)}
# Update the saved overlay image too before applying it again.`,
      linux: distribution
        ? `# Upgrade the existing native service; preserve /var/lib/opsknight-agent.
set +x
set -euo pipefail
umask 077
agent_credential_dir=$(mktemp -d)
curl --fail --silent --show-error ${shellQuote(distribution.installerUrl)} -o "$agent_credential_dir/install.sh"
printf '%s  %s\\n' ${shellQuote(distribution.manifest.installer.sha256)} "$agent_credential_dir/install.sh" | sha256sum --check -
sudo bash "$agent_credential_dir/install.sh" --version ${shellQuote(distribution.manifest.version)} --url ${shellQuote(url)} --key ${shellQuote(executionPublicKey)}
sudo /opt/opsknight-agent/preflight.sh`
        : '',
    };
  return { compose, swarm, helm, kustomize, linux };
}

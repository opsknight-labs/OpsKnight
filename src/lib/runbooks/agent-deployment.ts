/** Stable enrollment-scoped names shared by the UI and deployment certification. */
export function agentDeploymentIdentity(agentId: string) {
  if (!/^[a-z0-9]{20,32}$/.test(agentId)) throw new Error('Invalid Agent enrollment identity.');
  const name = `opsknight-agent-${agentId}`;
  return { name, enrollmentSecret: `opsknight-agent-enrollment-${agentId}`, suffix: `-${agentId}` };
}

export function agentKustomization(agentId: string, url: string, image: string) {
  const identity = agentDeploymentIdentity(agentId);
  const digestAt = image.indexOf('@');
  const tagAt = image.lastIndexOf(':');
  const tagged = tagAt > image.lastIndexOf('/');
  return {
    apiVersion: 'kustomize.config.k8s.io/v1beta1',
    kind: 'Kustomization',
    namespace: 'opsknight',
    nameSuffix: identity.suffix,
    labels: [{ pairs: { 'app.kubernetes.io/instance': identity.name }, includeSelectors: true }],
    resources: ['deployment.yaml', 'policy.yaml', 'service-account.yaml', 'pvc.yaml'],
    images: [
      {
        name: 'ghcr.io/opsknight-labs/opsknight-agent',
        newName: digestAt > 0 ? image.slice(0, digestAt) : tagged ? image.slice(0, tagAt) : image,
        ...(digestAt > 0
          ? { digest: image.slice(digestAt + 1) }
          : { newTag: tagged ? image.slice(tagAt + 1) : 'REQUIRES_VERIFIED_RELEASE' }),
      },
    ],
    patches: [
      {
        target: { kind: 'Deployment', name: 'opsknight-agent' },
        patch: JSON.stringify([
          { op: 'replace', path: '/spec/template/spec/containers/0/env/0/value', value: url },
          {
            op: 'replace',
            path: '/spec/template/spec/volumes/2/secret/secretName',
            value: identity.enrollmentSecret,
          },
        ]),
      },
    ],
  };
}

/** Bounded durable per-Agent policy requests; every selected Agent must certify. */
export const MAX_AUTOMATIC_POLICY_TARGETS = 100;
export const POLICY_CERTIFICATION_BATCH_SIZE = 25;

export function isAgentDeploymentName(value: string) {
  return (
    value.length > 0 &&
    value.length <= 45 &&
    /^[a-z0-9-]+$/.test(value) &&
    !value.startsWith('-') &&
    !value.endsWith('-')
  );
}

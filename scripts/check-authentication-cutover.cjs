/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS entry point packaged in the production image. */
'use strict';
const https = require('node:https');
const fs = require('node:fs');

/** Read-only release gate. Migration must never run alongside older runtime pods. */
async function checkCutover({ deployments, listPods, getDeployment, listDeployments }) {
  const inventory = new Map();
  for (const name of deployments) {
    const deployment = await getDeployment(name);
    if (deployment) inventory.set(name, deployment);
  }
  if (listDeployments) {
    for (const deployment of await listDeployments()) {
      const component = deployment.metadata?.labels?.['app.kubernetes.io/component'];
      if (['agent', 'pgbouncer'].includes(component)) continue;
      if (!deployment.metadata?.name) throw new Error('Invalid release deployment inventory.');
      inventory.set(deployment.metadata.name, deployment);
    }
  }
  const selectors = [];
  for (const [name, deployment] of inventory) {
    if (deployment.spec?.replicas !== 0)
      throw new Error(
        `Stop application Deployment ${name} before upgrading (replicas must be zero).`
      );
    const labels = deployment.spec?.selector?.matchLabels;
    if (!labels || Object.keys(labels).length === 0)
      throw new Error(`Cannot verify the pod selector for ${name}.`);
    selectors.push(labels);
  }
  const pods = await listPods();
  for (const pod of pods) {
    const labels = pod.metadata?.labels ?? {};
    if (
      selectors.some(selector =>
        Object.entries(selector).every(
          ([key, value]) => new Map(Object.entries(labels)).get(key) === value
        )
      ) &&
      !['Succeeded', 'Failed'].includes(pod.status?.phase)
    )
      throw new Error(
        'Application pods are still present, including pending/terminating pods. Wait for complete shutdown before migration.'
      );
  }
}

async function main() {
  const namespace = fs
    .readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8')
    .trim();
  const token = fs
    .readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8')
    .trim();
  const ca = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  const deployments = JSON.parse(process.env.CUTOVER_DEPLOYMENTS_JSON);
  if (
    !Array.isArray(deployments) ||
    !deployments.length ||
    deployments.some(name => typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name))
  )
    throw new Error('Invalid deployment inventory.');
  const request = path =>
    new Promise((resolve, reject) => {
      const req = https.get(
        {
          hostname: process.env.KUBERNETES_SERVICE_HOST,
          port: process.env.KUBERNETES_SERVICE_PORT_HTTPS || '443',
          path,
          ca,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          timeout: 10000,
        },
        response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => {
            body += chunk;
            if (body.length > 4 * 1024 * 1024) req.destroy(new Error('API response too large.'));
          });
          response.on('end', () => {
            if (response.statusCode === 404) return resolve(null);
            if (response.statusCode !== 200)
              return reject(
                new Error(`Kubernetes read denied or unavailable (${response.statusCode}).`)
              );
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error('Invalid Kubernetes API response.'));
            }
          });
          response.on('error', reject);
        }
      );
      req.on('timeout', () => req.destroy(new Error('Kubernetes API timed out.')));
      req.on('error', reject);
    });
  await checkCutover({
    deployments,
    getDeployment: name =>
      request(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${name}`),
    listDeployments: async () => {
      const result = await request(
        `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments?labelSelector=${encodeURIComponent(process.env.CUTOVER_POD_SELECTOR)}`
      );
      if (!Array.isArray(result?.items))
        throw new Error('Cannot verify release deployment inventory.');
      return result.items;
    },
    listPods: async () => {
      const result = await request(
        `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${encodeURIComponent(process.env.CUTOVER_POD_SELECTOR)}`
      );
      if (!Array.isArray(result?.items)) throw new Error('Cannot verify application pods.');
      return result.items;
    },
  });
  console.log('Authentication cutover verified: runtime stopped; migration may proceed.');
}
module.exports = { checkCutover };
if (require.main === module)
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });

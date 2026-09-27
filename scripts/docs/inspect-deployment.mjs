import { filesUnder, readRepositoryFile } from './discovery-lib.mjs';

const topologyRoots = {
  compose: 'deploy/compose',
  helm: 'deploy/kubernetes/helm',
  kustomize: 'deploy/kubernetes/kustomize',
  swarm: 'deploy/swarm',
};
const runtimeNames = ['web', 'scheduler', 'general-worker', 'critical-worker', 'bulk-worker', 'status-projector', 'postgres', 'pgbouncer'];

export function inspectDeployment() {
  const topologies = Object.entries(topologyRoots).map(([name, root]) => ({
    name,
    root,
    files: filesUnder(root),
  }));
  const sources = topologies.flatMap(topology => topology.files);
  const runtimeRoles = runtimeNames.map(name => ({
    name,
    sources: sources.filter(file => readRepositoryFile(file).toLowerCase().includes(name)),
  })).filter(role => role.sources.length > 0);
  return { topologies, runtimeRoles };
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectDeployment(), null, 2));


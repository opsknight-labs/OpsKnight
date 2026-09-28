import { filesUnder } from './discovery-lib.mjs';

export function inspectIntegrations() {
  const adapters = new Map(filesUnder('src/lib/integrations', file => /\.ts$/.test(file))
    .map(file => [file.match(/\/([^/]+)\.ts$/)?.[1], file]));
  return filesUnder('src/app/api/integrations', file => /\/route\.ts$/.test(file))
    .map(file => ({ provider: file.match(/integrations\/([^/]+)\/route\.ts$/)?.[1], route: file }))
    .filter(entry => entry.provider && adapters.has(entry.provider))
    .map(entry => ({ ...entry, adapter: adapters.get(entry.provider), sources: [adapters.get(entry.provider), entry.route] }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectIntegrations(), null, 2));

import { filesUnder } from './discovery-lib.mjs';

export function inspectIntegrations() {
  const sources = [
    ...filesUnder('src/lib/integrations', file => /\.(?:ts|json)$/.test(file)),
    ...filesUnder('src/app/api/integrations', file => /\/route\.ts$/.test(file)),
    ...filesUnder('src/app/(app)/settings/integrations', file => /\/page\.tsx$/.test(file)),
  ];
  const providers = new Map();
  for (const file of sources) {
    const parts = file.split('/');
    const marker = Math.max(parts.indexOf('integrations'), parts.indexOf('providers'));
    const candidate = parts[marker + 1];
    if (!candidate || /^(route|page)\./.test(candidate)) continue;
    const provider = candidate.replace(/\.(?:ts|tsx|json)$/, '');
    const entry = providers.get(provider) ?? { provider, sources: [] };
    entry.sources.push(file);
    providers.set(provider, entry);
  }
  return [...providers.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectIntegrations(), null, 2));


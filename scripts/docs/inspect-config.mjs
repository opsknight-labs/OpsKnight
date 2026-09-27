import { filesUnder, readRepositoryFile } from './discovery-lib.mjs';

export function inspectConfig() {
  const files = [
    ...filesUnder('src', file => /\.(?:ts|tsx)$/.test(file)),
    ...filesUnder('deploy', file => /\.(?:ya?ml|env|tpl)$/.test(file)),
  ];
  const variables = new Map();
  for (const file of files) {
    const source = readRepositoryFile(file);
    for (const match of source.matchAll(/(?:process\.env\.|\$\{|env:\s*|name:\s*)([A-Z][A-Z0-9_]{2,})/g)) {
      const name = match[1];
      const entry = variables.get(name) ?? { name, sources: [] };
      if (!entry.sources.includes(file)) entry.sources.push(file);
      variables.set(name, entry);
    }
  }
  return [...variables.values()].sort((a, b) => a.name.localeCompare(b.name));
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectConfig(), null, 2));


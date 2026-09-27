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
      const secret = /(?:SECRET|PASSWORD|TOKEN|PRIVATE|CREDENTIAL|ENCRYPTION_KEY|DATABASE_URL)/.test(name);
      const entry = variables.get(name) ?? {
        name,
        sources: [],
        required: false,
        secret,
        scopes: [],
        defaults: [],
      };
      if (!entry.sources.includes(file)) entry.sources.push(file);
      const scope = file.startsWith('deploy/') ? 'deployment' : 'runtime';
      if (!entry.scopes.includes(scope)) entry.scopes.push(scope);
      const requiredPattern = new RegExp(`process\\.env\\.${name}(?:!|\\s*\\?\\?\\s*throw)|\\$\\{${name}:\\?`);
      if (requiredPattern.test(source)) entry.required = true;
      if (!secret) {
        const composeDefault = source.match(new RegExp(`\\$\\{${name}:-([^}]+)\\}`))?.[1];
        const sourceDefault = source.match(new RegExp(`process\\.env\\.${name}\\s*(?:\\|\\||\\?\\?)\\s*['"]([^'"]+)['"]`))?.[1];
        for (const value of [composeDefault, sourceDefault]) {
          if (value && !entry.defaults.includes(value)) entry.defaults.push(value);
        }
      }
      variables.set(name, entry);
    }
  }
  return [...variables.values()]
    .map(entry => ({ ...entry, sources: entry.sources.sort(), scopes: entry.scopes.sort(), defaults: entry.defaults.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectConfig(), null, 2));

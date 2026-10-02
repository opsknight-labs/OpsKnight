import { readRepositoryFile } from './discovery-lib.mjs';

function valuesFromObject(source, name) {
  const body = source.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`))?.[1] ?? '';
  return [...body.matchAll(/:\s*['"]([^'"]+)['"]/g)].map(match => match[1]).sort();
}

export function inspectPermissions() {
  const source = readRepositoryFile('src/lib/authorization.ts');
  const policySource = readRepositoryFile('src/lib/authorization-policy.ts');
  return {
    roles: [...source.matchAll(/export const APP_ROLES = \[([^\]]+)\]/g)]
      .flatMap(match => [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(value => value[1])),
    capabilities: valuesFromObject(source, 'CAPABILITIES'),
    apiScopes: valuesFromObject(source, 'API_SCOPES'),
    actions: valuesFromObject(policySource, 'AUTHORIZATION_ACTIONS'),
    source: 'src/lib/authorization.ts',
    policySource: 'src/lib/authorization-policy.ts',
  };
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectPermissions(), null, 2));

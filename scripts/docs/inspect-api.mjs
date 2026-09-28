import { filesUnder, readRepositoryFile, routeFromFile } from './discovery-lib.mjs';

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function exportedHttpMethods(source) {
  const found = new Set();
  for (const method of methods) {
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b`).test(source)) {
      found.add(method);
    }
  }
  for (const block of source.matchAll(/export\s*{([^}]+)}(?:\s*from\s*['"][^'"]+['"])?/g)) {
    for (const item of block[1].split(',')) {
      const match = item.trim().match(/^(?:[A-Za-z_$][\w$]*\s+as\s+)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/);
      if (match) found.add(match[1]);
    }
  }
  return methods.filter(method => found.has(method));
}

export function inspectApi() {
  return filesUnder('src/app/api', file => /\/route\.ts$/.test(file)).map(file => {
    const source = readRepositoryFile(file);
    const schemas = [...source.matchAll(/\b([A-Z][A-Za-z0-9]+Schema)\.(?:safeParse|parse)\b/g)].map(match => match[1]);
    const errors = [...source.matchAll(/code:\s*['"]([A-Z][A-Z0-9_]+)['"]/g)].map(match => match[1]);
    const entities = [...source.matchAll(/prisma\.([a-z][A-Za-z0-9]+)\./g)].map(match => match[1]);
    return {
      route: routeFromFile(file, 'src/app'),
      file,
      methods: exportedHttpMethods(source),
      authentication: source.includes('authenticateApiKey')
        ? ['api-key']
        : source.includes('getServerSession') || source.includes('requireAuth')
          ? ['session']
          : source.includes('Authorization')
            ? ['custom-header']
            : [],
      authorization: [...new Set([
        ...[...source.matchAll(/AUTHORIZATION_ACTIONS\.([A-Z0-9_]+)/g)].map(match => match[1]),
        ...(source.includes('getUserPermissions') ? ['capability-policy'] : []),
      ])].sort(),
      requestSchemas: [...new Set(schemas)].sort(),
      rateLimited: /checkRateLimit|rateLimit/.test(source),
      idempotent: /Idempotency-Key|idempotency-key|executeIdempotent/.test(source),
      errors: [...new Set(errors)].sort(),
      entities: [...new Set(entities)].sort(),
      runtimeDependencies: [
        ...(source.includes("@/lib/prisma") ? ['postgresql'] : []),
        ...(source.includes('job-queue') || source.includes('enqueue') ? ['worker'] : []),
      ],
    };
  });
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectApi(), null, 2));

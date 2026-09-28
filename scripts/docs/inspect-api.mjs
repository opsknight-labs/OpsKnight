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
    return {
      route: routeFromFile(file, 'src/app'),
      file,
      methods: exportedHttpMethods(source),
    };
  });
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectApi(), null, 2));

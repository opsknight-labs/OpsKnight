/* eslint-disable security/detect-non-literal-fs-filename -- reads repository files at constant paths */
/* eslint-disable security/detect-non-literal-regexp -- pattern is built from fixed internal strings, never user input */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(process.cwd(), 'src/app/api/v2');
const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;

export interface ImplementedOperation {
  method: (typeof METHODS)[number];
  path: string;
  /** Name of the first AUTHORIZATION_ACTIONS member the handler enforces. */
  action: string;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

/** Operations implemented by the REST v2 route handlers, read from their source. */
export function implementedOperations(): ImplementedOperation[] {
  const out: ImplementedOperation[] = [];
  for (const file of routeFiles(ROOT)) {
    const source = readFileSync(file, 'utf8');
    const path =
      '/' +
      relative(ROOT, join(file, '..'))
        .split(sep)
        .join('/')
        .replace(/\[(\w+)\]/g, '{$1}');
    if (path === '/openapi.json') continue;
    for (const method of METHODS) {
      const start = new RegExp(
        `export\\s+(?:async\\s+function|const)\\s+${method.toUpperCase()}\\b`
      ).exec(source);
      if (!start) continue;
      const rest = source.slice(start.index + start[0].length);
      const next = /export\s+(?:async\s+function|const)\s+(?:GET|POST|PATCH|PUT|DELETE)\b/.exec(
        rest
      );
      const body = next ? rest.slice(0, next.index) : rest;
      const action = /AUTHORIZATION_ACTIONS\.(\w+)/.exec(body)?.[1];
      if (!action)
        throw new Error(`${method.toUpperCase()} ${path} enforces no authorization action`);
      out.push({ method, path, action });
    }
  }
  return out;
}

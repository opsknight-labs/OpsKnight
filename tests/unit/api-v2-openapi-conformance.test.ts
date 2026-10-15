/* eslint-disable security/detect-non-literal-fs-filename -- reads repository files at constant paths */
/* eslint-disable security/detect-non-literal-regexp -- pattern is built from fixed internal strings, never user input */
/* eslint-disable security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { apiV2Error, apiV2Success } from '@/lib/api-v2/response';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';
import { AppError } from '@/lib/errors';
import { AUTHORIZATION_ACTIONS, apiScopeForAction } from '@/lib/authorization-policy';
import { API_SCOPES } from '@/lib/authorization';

const spec = getOpenApiV2Spec() as any;
const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;
const ROOT = join(process.cwd(), 'src/app/api/v2');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

/** Operations implemented by the route handlers, with the action each one enforces. */
function implemented(): Array<{ method: string; path: string; action: string }> {
  const out: Array<{ method: string; path: string; action: string }> = [];
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
      const upper = method.toUpperCase();
      const start = new RegExp(`export\\s+(?:async\\s+function|const)\\s+${upper}\\b`).exec(source);
      if (!start) continue;
      const rest = source.slice(start.index + start[0].length);
      const next = /export\s+(?:async\s+function|const)\s+(?:GET|POST|PATCH|PUT|DELETE)\b/.exec(
        rest
      );
      const body = next ? rest.slice(0, next.index) : rest;
      const action = /AUTHORIZATION_ACTIONS\.(\w+)/.exec(body)?.[1];
      expect(action, `${upper} ${path} must enforce an authorization action`).toBeDefined();
      out.push({ method, path, action: action! });
    }
  }
  return out;
}

function collectRefs(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) node.forEach(n => collectRefs(n, found));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.add(value);
      else collectRefs(value, found);
    }
  }
  return found;
}

function resolveRef(ref: string): unknown {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((node: any, part) => node?.[part], spec);
}

describe('OpenAPI document conformance', () => {
  it('is an OpenAPI 3.1 document with the required root fields', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(20);
  });

  it('uses no OpenAPI 3.0-only nullable keyword', () => {
    expect(JSON.stringify(spec)).not.toContain('"nullable"');
  });

  it('resolves every $ref', () => {
    for (const ref of collectRefs(spec)) {
      expect(resolveRef(ref), `unresolved ${ref}`).toBeDefined();
    }
  });

  it('compiles every component schema as JSON Schema 2020-12', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema({ $id: 'spec', components: spec.components });
    for (const name of Object.keys(spec.components.schemas)) {
      expect(() => ajv.getSchema(`spec#/components/schemas/${name}`), name).not.toThrow();
      expect(ajv.getSchema(`spec#/components/schemas/${name}`), name).toBeDefined();
    }
  });
});

describe('Operation registry matches the implementation', () => {
  const routes = implemented();

  it('documents exactly the operations the routes implement', () => {
    const fromRoutes = routes.map(r => `${r.method} ${r.path}`).sort();
    const fromRegistry = V2_OPERATIONS.map(o => `${o.method} ${o.path}`).sort();
    const fromSpec = Object.entries<any>(spec.paths)
      .flatMap(([path, item]) => METHODS.filter(m => item[m]).map(m => `${m} ${path}`))
      .sort();
    expect(fromRegistry).toEqual(fromRoutes);
    expect(fromSpec).toEqual(fromRoutes);
  });

  it('declares the scope the handler actually enforces', () => {
    for (const route of routes) {
      const actionValue = (AUTHORIZATION_ACTIONS as Record<string, string>)[route.action];
      const expected = apiScopeForAction(actionValue as never);
      const op = V2_OPERATIONS.find(o => o.method === route.method && o.path === route.path)!;
      expect(op.scope, `${route.method} ${route.path}`).toBe(expected);
      expect(Object.values(API_SCOPES)).toContain(op.scope);
    }
  });

  it('has unique, readable operationIds', () => {
    const ids = V2_OPERATIONS.map(o => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z0-9]+$/);
  });
});

describe('Every operation carries the uniform contract', () => {
  for (const definition of V2_OPERATIONS) {
    it(`${definition.method.toUpperCase()} ${definition.path}`, () => {
      const op = spec.paths[definition.path][definition.method];
      expect(op.operationId).toBe(definition.operationId);
      expect(op['x-required-scope']).toBe(definition.scope);
      expect(op.responses['429']).toBeDefined();
      expect(op.responses.default).toBeDefined();

      const templateVars = [...definition.path.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      for (const name of templateVars) {
        expect(
          (op.parameters ?? []).some((p: any) => p.name === name && p.in === 'path' && p.required),
          `path parameter ${name}`
        ).toBe(true);
      }

      const ok = Object.keys(op.responses).find(code => code.startsWith('2'))!;
      if (definition.kind !== 'none') {
        expect(
          op.responses[ok].content?.['application/json']?.schema,
          'typed success body'
        ).toBeDefined();
      }
      if (op['x-idempotency'] === 'required' || op['x-idempotency'] === 'supported') {
        expect(op.parameters.some((p: any) => p.name === 'Idempotency-Key')).toBe(true);
      }
      if (op['x-concurrency'] === 'etag') {
        expect(op.parameters.some((p: any) => p.name === 'If-Match')).toBe(true);
        expect(op.responses['412']).toBeDefined();
      }
    });
  }
});

describe('Documented schemas match runtime output', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'spec', components: spec.components });

  it('validates a real problem+json error response', async () => {
    const response = apiV2Error(
      new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'missing' }),
      new NextRequest('http://localhost/api/v2/teams/x')
    );
    const body = await response.json();
    const validate = ajv.getSchema('spec#/components/schemas/ProblemDetails')!;
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });

  it('validates a real success envelope against the documented operation response', async () => {
    const op = spec.paths['/service-accounts/{id}/tokens'].post;
    const schema = JSON.parse(
      JSON.stringify(op.responses['201'].content['application/json'].schema).replaceAll(
        '"#/components/',
        '"spec#/components/'
      )
    );
    const validate = ajv.compile(schema);
    const response = apiV2Success(
      {
        token: 'ok_sa_live_x',
        apiKey: {
          id: 'k',
          name: 'n',
          prefix: 'ok_sa_live_x',
          scopes: ['incidents:read'],
          createdAt: new Date(),
          expiresAt: null,
        },
      },
      { status: 201 }
    );
    const body = await response.json();
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { findBreakingChanges } from '@/lib/api-v2/openapi-compat';

const BASELINE = join(process.cwd(), 'tests/fixtures/api-v2-openapi.baseline.json');

describe('findBreakingChanges', () => {
  const base: any = {
    paths: {
      '/things': {
        post: {
          operationId: 'createThing',
          parameters: [{ name: 'kind', in: 'query', schema: { type: 'string', enum: ['a', 'b'] } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '201': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { id: { type: 'string' }, name: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const clone = () => JSON.parse(JSON.stringify(base));

  it('allows additive changes', () => {
    const next = clone();
    next.paths['/other'] = { get: { responses: { '200': {} } } };
    next.paths['/things'].post.requestBody.content['application/json'].schema.properties.note = {
      type: 'string',
    };
    next.paths['/things'].post.responses['201'].content[
      'application/json'
    ].schema.properties.extra = { type: 'string' };
    expect(findBreakingChanges(base, next)).toEqual([]);
  });

  it('flags removed operations, response fields and operationId changes', () => {
    const next = clone();
    delete next.paths['/things'].post.responses['201'].content['application/json'].schema.properties
      .name;
    next.paths['/things'].post.operationId = 'makeThing';
    expect(findBreakingChanges(base, next).join('\n')).toMatch(/response field removed/);
    expect(findBreakingChanges(base, next).join('\n')).toMatch(/operationId changed/);
    expect(findBreakingChanges(base, { paths: {} })).toContain('POST /things: operation removed');
  });

  it('flags new required inputs and narrowed request enums', () => {
    const next = clone();
    next.paths['/things'].post.requestBody.content['application/json'].schema.required.push(
      'extra'
    );
    next.paths['/things'].post.requestBody.content['application/json'].schema.properties.extra = {
      type: 'string',
    };
    next.paths['/things'].post.parameters[0].schema.enum = ['a'];
    next.paths['/things'].post.parameters.push({
      name: 'tenant',
      in: 'header',
      required: true,
      schema: { type: 'string' },
    });
    const found = findBreakingChanges(base, next).join('\n');
    expect(found).toMatch(/field became required/);
    expect(found).toMatch(/enum narrowed/);
    expect(found).toMatch(/parameter header:tenant became required/);
  });
});

describe('REST v2 contract compatibility', () => {
  it('has no breaking changes against the committed baseline', () => {
    const current = getOpenApiV2Spec();
    if (process.env.UPDATE_OPENAPI_BASELINE === '1' || !existsSync(BASELINE)) {
      mkdirSync(dirname(BASELINE), { recursive: true });
      writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
    }
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    // A breaking change needs a deliberate baseline update (UPDATE_OPENAPI_BASELINE=1) and review.
    expect(findBreakingChanges(baseline, current)).toEqual([]);
  });
});

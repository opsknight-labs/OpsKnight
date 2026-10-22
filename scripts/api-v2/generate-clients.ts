/* eslint-disable security/detect-non-literal-fs-filename -- output paths are fixed repository artifacts */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getOpenApiV2Spec } from '../../src/lib/api-v2/openapi';
import { V2_OPERATIONS } from '../../src/lib/api-v2/openapi-registry';
import { V2_MUTATION_CONTRACT } from '../../src/lib/api-v2/mutation-contract';

type Schema = {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
};
type Operation = {
  parameters?: { name: string; in: string; required?: boolean; schema: Schema }[];
  requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};
type Spec = {
  components: { schemas: Record<string, Schema> };
  paths: Record<string, Record<string, Operation>>;
};

const spec = getOpenApiV2Spec() as unknown as Spec;
const pythonDeclarations: string[] = [];
const identifier = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_');
const title = (name: string) => name[0].toUpperCase() + name.slice(1);
const lookup = <T>(record: Record<string, T>, name: string): T | undefined =>
  Object.entries(record).find(([key]) => key === name)?.[1];

function ts(schema: Schema): string {
  if (schema.$ref) return identifier(schema.$ref.split('/').at(-1)!);
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(' | ') || 'never';
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants) return variants.map(ts).join(' | ');
  if (Array.isArray(schema.type))
    return schema.type.map(type => ts({ ...schema, type })).join(' | ');
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `Array<${ts(schema.items ?? {})}>`;
    case 'object': {
      const fields = Object.entries(schema.properties ?? {}).map(
        ([name, value]) =>
          `${JSON.stringify(name)}${schema.required?.includes(name) ? '' : '?'}: ${ts(value)}`
      );
      const result = fields.length ? `{ ${fields.join('; ')} }` : 'Record<string, never>';
      if (schema.additionalProperties === false) return result;
      const value =
        typeof schema.additionalProperties === 'object'
          ? ts(schema.additionalProperties)
          : 'unknown';
      return fields.length ? `${result} & Record<string, ${value}>` : `Record<string, ${value}>`;
    }
    default:
      return 'unknown';
  }
}

function py(schema: Schema, name: string): string {
  if (schema.$ref) return JSON.stringify(identifier(schema.$ref.split('/').at(-1)!));
  if ('const' in schema) return `Literal[${pythonLiteral(schema.const)}]`;
  if (schema.enum) return `Literal[${schema.enum.map(pythonLiteral).join(', ')}]`;
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants)
    return `Union[${variants.map((variant, index) => py(variant, `${name}Variant${index}`)).join(', ')}]`;
  if (Array.isArray(schema.type))
    return `Union[${schema.type.map(type => py({ ...schema, type }, `${name}${title(type)}`)).join(', ')}]`;
  switch (schema.type) {
    case 'string':
      return 'str';
    case 'integer':
      return 'int';
    case 'number':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'null':
      return 'None';
    case 'array':
      return `list[${py(schema.items ?? {}, `${name}Item`)}]`;
    case 'object': {
      if (
        (!schema.properties || !Object.keys(schema.properties).length) &&
        schema.additionalProperties !== false
      )
        return 'dict[str, Any]';
      const fields = Object.entries(schema.properties ?? {}).map(([key, value]) => {
        const type = py(value, `${name}${title(identifier(key))}`);
        return `${JSON.stringify(key)}: ${schema.required?.includes(key) ? type : `NotRequired[${type}]`}`;
      });
      pythonDeclarations.push(
        `${name} = TypedDict(${JSON.stringify(name)}, {${fields.join(', ')}})`
      );
      return JSON.stringify(name);
    }
    default:
      return 'Any';
  }
}
function pythonLiteral(value: unknown) {
  return value === null
    ? 'None'
    : value === true
      ? 'True'
      : value === false
        ? 'False'
        : JSON.stringify(value);
}

const tsSchemas = Object.entries(spec.components.schemas).map(
  ([name, schema]) => `export type ${identifier(name)} = ${ts(schema)};`
);
for (const [name, schema] of Object.entries(spec.components.schemas)) {
  const expression = py(schema, identifier(name));
  if (expression !== JSON.stringify(identifier(name)))
    pythonDeclarations.push(`${identifier(name)} = ${expression}`);
}
const tsRequests: string[] = [];
const tsResponses: string[] = [];
const overloads: string[] = [];
const manifest: Record<string, unknown> = {};
for (const definition of V2_OPERATIONS) {
  const operation = lookup(lookup(spec.paths, definition.path)!, definition.method)!;
  const parameters = operation.parameters ?? [];
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const [location, field] of [
    ['path', 'params'],
    ['query', 'query'],
    ['header', 'headers'],
  ]) {
    const selected = parameters.filter(parameter => parameter.in === location);
    if (!selected.length) continue;
    // eslint-disable-next-line security/detect-object-injection -- field comes from the fixed path/query/header mapping
    properties[field] = {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(selected.map(parameter => [parameter.name, parameter.schema])),
      required: selected.filter(parameter => parameter.required).map(parameter => parameter.name),
    };
    if (selected.some(parameter => parameter.required)) required.push(field);
  }
  const body = operation.requestBody?.content['application/json'];
  if (body) {
    properties.body = body.schema;
    if (operation.requestBody?.required) required.push('body');
  }
  const request: Schema = { type: 'object', additionalProperties: false, properties, required };
  const response = definition.kind === 'binary'
    ? { type: 'string', format: 'binary' }
    : Object.entries(operation.responses).find(([status]) =>
        status.startsWith('2')
      )?.[1].content?.['application/json']?.schema ?? { type: 'null' };
  tsRequests.push(`  ${definition.operationId}: ${ts(request)};`);
  tsResponses.push(`  ${definition.operationId}: ${definition.kind === 'binary' ? 'Uint8Array' : ts(response)};`);
  const name = title(definition.operationId);
  const requestName = py(request, `${name}Request`);
  const responseName = definition.kind === 'binary' ? 'bytes' : py(response, `${name}Response`);
  overloads.push(
    `    @overload\n    def call(self, operation: Literal[${JSON.stringify(definition.operationId)}], request: ${requestName}) -> ${responseName}: ...`
  );
  const contractKey = `${definition.method.toUpperCase()} /api/v2${definition.path.replace(/\{(\w+)\}/g, '[$1]')}`;
  const contract = lookup(V2_MUTATION_CONTRACT, contractKey);
  manifest[definition.operationId] = {
    method: definition.method.toUpperCase(),
    path: definition.path,
    kind: definition.kind,
    idempotency: contract?.idempotency ?? null,
    requiredHeaders: parameters
      .filter(parameter => parameter.in === 'header' && parameter.required)
      .map(parameter => parameter.name),
    bodyRequired: operation.requestBody?.required ?? false,
  };
}

const artifacts: Record<string, string> = {
  'sdk/typescript/schema.ts': `// Generated by npm run api:clients. Do not edit.\n${tsSchemas.join('\n')}\nexport interface OperationRequests {\n${tsRequests.join('\n')}\n}\nexport interface OperationResponses {\n${tsResponses.join('\n')}\n}\nexport const OPERATIONS = ${JSON.stringify(manifest, null, 2)} as const;\n`,
  'sdk/python/opsknight_v2/models.py': `# Generated by npm run api:clients. Do not edit.\nfrom __future__ import annotations\nfrom typing import Any, Literal, TypedDict, Union\ntry:\n    from typing import NotRequired\nexcept ImportError:\n    try:\n        from typing_extensions import NotRequired\n    except ImportError:\n        class _NotRequiredMeta(type):\n            def __getitem__(self, item):\n                return item\n        class NotRequired(metaclass=_NotRequiredMeta):\n            pass\n\n${pythonDeclarations.join('\n')}\n`,
  'sdk/python/opsknight_v2/client.pyi': `# Generated by npm run api:clients. Do not edit.\nfrom typing import Any, Iterator, Literal, overload\nfrom .models import *\n\nclass ApiError(Exception):\n    status: int\n    code: str\n    request_id: str | None\n\nclass Client:\n    def __init__(self, base_url: str, token: str, *, max_retries: int = 2, timeout: float = 30, allow_insecure_http: bool = False) -> None: ...\n${overloads.join('\n')}\n    def paginate(self, operation: str, request: dict[str, Any], *, max_pages: int = 10000) -> Iterator[Any]: ...\n`,
  'sdk/python/opsknight_v2/operations.json': JSON.stringify(manifest, null, 2) + '\n',
  'sdk/openapi-v2.json': JSON.stringify(getOpenApiV2Spec(), null, 2) + '\n',
};
// Counts are generated; release/phase decisions remain evidence-reviewed rather than
// being inferred from route availability. Update every nested count in the live trackers.
function synchronizeOperationCounts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(synchronizeOperationCounts);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        key === 'registeredOperationCount'
          ? V2_OPERATIONS.length
          : synchronizeOperationCounts(nested),
      ])
    );
  return value;
}
for (const file of [
  'plans/rest-api-enterprise/implementation-status.json',
  'plans/rest-api-enterprise/combined-progress.json',
]) {
  const current: unknown = JSON.parse(readFileSync(join(process.cwd(), file), 'utf8'));
  // eslint-disable-next-line security/detect-object-injection -- paths are the fixed repository artifacts above
  artifacts[file] = JSON.stringify(synchronizeOperationCounts(current), null, 2) + '\n';
}
const check = process.argv.includes('--check');
let failed = false;
for (const [file, contents] of Object.entries(artifacts)) {
  const path = join(process.cwd(), file);
  if (check) {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      /* Missing generated output is stale. */
    }
    if (current !== contents) {
      process.stderr.write(`Stale generated artifact: ${file}\n`);
      failed = true;
    }
  } else {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  }
}
if (failed) process.exitCode = 1;

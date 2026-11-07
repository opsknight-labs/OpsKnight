/**
 * Parameter descriptions for the tool-facing schemas. Models pick argument values from these, so
 * each says what a valid value is and where to get it. Wire layer only: the canonical, hashed
 * catalog schema is never changed, and a description already present is kept.
 */

import { MCP_ME_BODY_FIELDS, MCP_ME_DESCRIPTION } from '@/lib/mcp/core/me-fields';

type Schema = Record<string, unknown>;
type Described = { kind?: string; operationId?: string };

const ID_DESCRIPTION = 'Id from a list or search result, not a title.';
const IDEMPOTENCY_DESCRIPTION = 'New random key; reuse only to retry the same call.';
const IF_MATCH_DESCRIPTION = 'evidence.etag from your last read, e.g. "3".';

/** Query fields whose meaning is the same wherever they appear. */
const QUERY_DESCRIPTIONS = new Map([
  ['search', 'Case-insensitive text in the name or title.'],
  ['teamId', 'Team id, e.g. from whoami teams.'],
]);

const isObject = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const describe = (schema: unknown, description: string) =>
  isObject(schema) && typeof schema.description !== 'string' ? { ...schema, description } : schema;

/** Copies a properties map, describing the members `describeOne` names. */
function describeMembers(
  properties: Schema,
  describeOne: (name: string) => string | undefined
): Schema {
  return Object.fromEntries(
    Object.entries(properties).map(([name, child]) => {
      const description = describeOne(name);
      return [name, description ? describe(child, description) : child];
    })
  );
}

function describeEnvelope(
  properties: Schema,
  envelope: 'path' | 'query' | 'body',
  describeOne: (name: string) => string | undefined
) {
  const child = new Map(Object.entries(properties)).get(envelope);
  if (!isObject(child) || !isObject(child.properties)) return child;
  return { ...child, properties: describeMembers(child.properties, describeOne) };
}

export function describeWireFields(operation: Described, schema: Schema): Schema {
  if (!isObject(schema.properties)) return schema;
  const properties = new Map(Object.entries(schema.properties));
  const listRead = operation.kind === 'list';
  const pathId = (name: string) => (name === 'id' || /Id$/.test(name) ? ID_DESCRIPTION : undefined);
  const query = (name: string) =>
    name === 'assigneeId' && listRead ? "User id, or 'me'." : QUERY_DESCRIPTIONS.get(name);
  if (properties.has('path'))
    properties.set('path', describeEnvelope(schema.properties, 'path', pathId));
  if (properties.has('query'))
    properties.set('query', describeEnvelope(schema.properties, 'query', query));
  const meFields = operation.operationId
    ? MCP_ME_BODY_FIELDS.get(operation.operationId)
    : undefined;
  if (meFields && properties.has('body'))
    properties.set(
      'body',
      describeEnvelope(schema.properties, 'body', name =>
        meFields.includes(name) ? MCP_ME_DESCRIPTION : undefined
      )
    );
  if (properties.has('idempotencyKey'))
    properties.set(
      'idempotencyKey',
      describe(properties.get('idempotencyKey'), IDEMPOTENCY_DESCRIPTION)
    );
  if (properties.has('ifMatch'))
    properties.set('ifMatch', describe(properties.get('ifMatch'), IF_MATCH_DESCRIPTION));
  return { ...schema, properties: Object.fromEntries(properties) };
}

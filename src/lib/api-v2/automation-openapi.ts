type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const text = (maxLength: number, minLength = 0): Schema => ({
  type: 'string',
  minLength,
  maxLength,
});
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const array = (items: Schema, maxItems: number): Schema => ({ type: 'array', items, maxItems });
const identifier = text(100, 1);
const scalar: Schema = {
  oneOf: [
    { ...text(2048), description: 'Maximum 2048 UTF-8 bytes.' },
    { type: 'number' },
    { type: 'boolean' },
  ],
};
const action = (type: string, properties: Record<string, Schema> = {}): Schema =>
  object({ type: { const: type }, ...properties }, ['type', ...Object.keys(properties)]);
const snapshot = object(
  {
    schemaVersion: { const: 1 },
    fields: array(
      object(
        {
          fieldId: identifier,
          key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
          label: text(100, 1),
          type: enumeration('STRING', 'ENUM', 'NUMBER', 'BOOLEAN'),
          caseSensitive: { type: 'boolean', default: false },
          allowedValues: array({ ...text(256, 1), description: 'Maximum 256 UTF-8 bytes.' }, 200),
          aliases: {
            type: 'object',
            propertyNames: { ...text(256), description: 'Maximum 256 UTF-8 bytes.' },
            additionalProperties: { ...text(256), description: 'Maximum 256 UTF-8 bytes.' },
            default: {},
          },
          mappings: {
            ...array(
              object(
                {
                  source: enumeration('PROVIDER', 'EVENT'),
                  integrationType: text(64),
                  path: text(512, 1),
                },
                ['source', 'path']
              ),
              32
            ),
            default: [],
          },
        },
        ['fieldId', 'key', 'label', 'type']
      ),
      64
    ),
    rules: array(
      object(
        {
          id: identifier,
          name: text(100, 1),
          phase: enumeration('ENRICH', 'ROUTE'),
          enabled: { type: 'boolean', default: true },
          conditions: array(
            object(
              {
                fieldKey: text(64, 1),
                operator: enumeration(
                  'EQ',
                  'NE',
                  'IN',
                  'NOT_IN',
                  'LT',
                  'LTE',
                  'GT',
                  'GTE',
                  'IS_SET',
                  'IS_MISSING',
                  'IS_UNMAPPED'
                ),
                value: { oneOf: [scalar, array(scalar, 200)] },
              },
              ['fieldKey', 'operator']
            ),
            20
          ),
          actions: {
            ...array(
              {
                oneOf: [
                  action('SET_PRIORITY', { value: enumeration('P1', 'P2', 'P3', 'P4', 'P5') }),
                  action('SET_CONTEXT', { fieldKey: text(64, 1), value: scalar }),
                  action('ADD_TAG', { value: text(64, 1) }),
                  action('USE_SERVICE_DEFAULT'),
                  action('USE_ESCALATION_POLICY', { policyId: identifier }),
                  action('NO_ESCALATION'),
                  action('NOTIFY_CHANNEL', {
                    provider: enumeration('SLACK', 'TEAMS'),
                    destinationId: identifier,
                  }),
                ],
              },
              8
            ),
            minItems: 1,
          },
        },
        ['id', 'name', 'phase', 'conditions', 'actions']
      ),
      100
    ),
  },
  ['schemaVersion', 'fields', 'rules']
);

export const AUTOMATION_SCHEMAS = {
  AutomationSnapshot: snapshot,
  AutomationDraft: object(
    {
      serviceId: identifier,
      revision: { type: 'integer', minimum: 0 },
      restoredFromVersionId: { type: ['string', 'null'] },
      snapshot: { $ref: '#/components/schemas/AutomationSnapshot' },
    },
    ['serviceId', 'revision', 'snapshot']
  ),
};
export const automationDraftBody = object(
  { snapshot: { $ref: '#/components/schemas/AutomationSnapshot' } },
  ['snapshot']
);

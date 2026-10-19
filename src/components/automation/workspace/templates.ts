import type { Condition, Field, Snapshot } from '@/lib/automation/contract';
import { newRule } from './constants';

const ruleNames = new Map([
  ['priority', 'High priority'],
  ['vip', 'Enterprise customer'],
  ['account', 'AWS account'],
]);

/** Builds the draft produced by a starter template, or explains why it cannot be applied. */
export function applyAutomationTemplate(
  draft: Snapshot,
  kind: string
): { snapshot: Snapshot } | { error: string } {
  const env: Field = {
    fieldId: crypto.randomUUID(),
    key: 'environment',
    label: 'Environment',
    type: 'ENUM',
    caseSensitive: false,
    allowedValues: ['production', 'staging', 'development'],
    aliases: { prod: 'production', prd: 'production', stg: 'staging' },
    mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
  };
  const enterprise: Field = {
    fieldId: crypto.randomUUID(),
    key: kind === 'account' ? 'aws_account' : 'customer_tier',
    label: kind === 'account' ? 'AWS Account ID' : 'Customer tier',
    type: 'STRING',
    caseSensitive: false,
    aliases: {},
    mappings: [{ source: 'PROVIDER', path: kind === 'account' ? 'AWSAccountId' : 'customer_tier' }],
  };
  const field = kind === 'account' || kind === 'vip' ? enterprise : env;
  const usesField = kind !== 'priority' && kind !== 'scratch';
  const existingField = draft.fields.find(candidate => candidate.key === field.key);
  const condition: Condition =
    kind === 'priority'
      ? { fieldKey: 'priority', operator: 'IN', value: ['P1', 'P2'] }
      : {
          fieldKey: field.key,
          operator: 'EQ',
          value: kind === 'account' ? '123456789012' : kind === 'vip' ? 'enterprise' : 'production',
        };
  if (usesField && existingField && existingField.type !== field.type)
    return {
      error:
        'This template conflicts with an existing context field type. Start from scratch or edit the field first.',
    };
  let templateFields = draft.fields;
  if (usesField && existingField?.type === 'ENUM') {
    const canonical = existingField.allowedValues?.find(value =>
      existingField.caseSensitive
        ? value === 'production'
        : value.trim().toLowerCase() === 'production'
    );
    condition.value = canonical ?? 'production';
    if (!canonical && (existingField.allowedValues?.length ?? 0) >= 200)
      return {
        error:
          'The environment field has reached its canonical choice limit. Add a compatible production choice before using this template.',
      };
    if (!canonical)
      templateFields = draft.fields.map(candidate =>
        candidate.fieldId === existingField.fieldId
          ? { ...candidate, allowedValues: [...(candidate.allowedValues ?? []), 'production'] }
          : candidate
      );
  }
  return {
    snapshot: {
      schemaVersion: 1,
      fields: !usesField || existingField ? templateFields : [...templateFields, field],
      rules:
        kind === 'scratch'
          ? []
          : [
              {
                ...newRule('ROUTE'),
                name: ruleNames.get(kind) ?? 'Production alerts',
                conditions: [condition],
              },
            ],
    },
  };
}

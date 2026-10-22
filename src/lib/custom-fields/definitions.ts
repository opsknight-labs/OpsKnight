import { z } from 'zod';
import type { CustomFieldType } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { validateCustomFieldValue } from '@/lib/custom-fields';

const optionsSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(50).refine(
  value => new Set(value).size === value.length, 'Options must be unique.'
);
const fields = {
  name: z.string().trim().min(1).max(200),
  required: z.boolean(),
  defaultValue: z.string().trim().max(2000).nullable(),
  options: optionsSchema.nullable(),
  showInList: z.boolean(),
  order: z.number().int().min(0).max(10_000),
};
export const createDefinitionSchema = z.object({
  name: fields.name,
  key: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_]+$/),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN', 'URL', 'EMAIL']),
  required: fields.required.default(false),
  defaultValue: fields.defaultValue.default(null),
  options: fields.options.default(null),
  showInList: fields.showInList.default(false),
}).strict();
export const updateDefinitionSchema = z.object(fields).partial().strict().refine(
  value => Object.keys(value).length > 0, 'At least one field must be changed.'
);

export function validateDefinition(value: {
  name: string; type: CustomFieldType; required: boolean;
  defaultValue: string | null; options: string[] | null;
}) {
  if (value.type === 'SELECT' && !value.options?.length) {
    throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'SELECT fields require at least one option.' });
  }
  if (value.type !== 'SELECT' && value.options !== null) {
    throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Only SELECT fields can define options.' });
  }
  if (value.defaultValue !== null) {
    const result = validateCustomFieldValue({ ...value, required: false }, value.defaultValue);
    if (!result.valid) throw new AppError({ code: 'VALIDATION_FAILED', userMessage: result.error });
  }
}

import { z } from 'zod';
import { RunbookDefinitionError } from './errors';
import {
  runbookDefinitionSchema,
  runbookDescriptionSchema,
  runbookInputsSchema,
  runbookNameSchema,
  runbookSlugSchema,
  runbookTagsSchema,
  type RunbookInputInput,
} from './schemas';

export const PORTABLE_RUNBOOK_FORMAT = 'opsknight.runbook';
export const PORTABLE_RUNBOOK_FORMAT_VERSION = 1;
export const MAX_PORTABLE_RUNBOOK_BYTES = 512 * 1024;

export const portableRunbookSchema = z.object({
  format: z.literal(PORTABLE_RUNBOOK_FORMAT),
  formatVersion: z.literal(PORTABLE_RUNBOOK_FORMAT_VERSION),
  name: runbookNameSchema,
  slug: runbookSlugSchema,
  description: runbookDescriptionSchema,
  tags: runbookTagsSchema.default([]),
  definition: runbookDefinitionSchema,
  inputs: runbookInputsSchema.default([]),
});

export type PortableRunbook = z.infer<typeof portableRunbookSchema>;

type PortableSourceRunbook = {
  name: string;
  slug: string;
  description: string;
  tags?: string[] | null;
};

type PortableSourceInput = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  description: string | null;
  sequence: number;
  options?: string[] | null;
};

type PortableSourceVersion = {
  definition: unknown;
  inputs: PortableSourceInput[];
};

export function toPortableRunbook(runbook: PortableSourceRunbook, version: PortableSourceVersion) {
  return {
    format: PORTABLE_RUNBOOK_FORMAT,
    formatVersion: PORTABLE_RUNBOOK_FORMAT_VERSION,
    name: runbook.name,
    slug: runbook.slug,
    description: runbook.description ?? '',
    tags: [...(runbook.tags ?? [])],
    definition: version.definition,
    inputs: [...version.inputs]
      .sort((a, b) => a.sequence - b.sequence)
      .map(input => ({
        key: input.key,
        label: input.label,
        type: input.type as RunbookInputInput['type'],
        required: input.required,
        ...(input.defaultValue === null ? {} : { defaultValue: input.defaultValue }),
        description: input.description ?? '',
        sequence: input.sequence,
        ...(input.type === 'SELECT' && input.options?.length ? { options: input.options } : {}),
      })),
  };
}

function describeIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 5)
    .map(issue => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

/** Accepts raw JSON text or an already-parsed value and returns a validated portable runbook. */
export function parsePortableRunbook(json: unknown): PortableRunbook {
  let raw = json;
  if (typeof json === 'string') {
    if (new TextEncoder().encode(json).byteLength > MAX_PORTABLE_RUNBOOK_BYTES) {
      throw new RunbookDefinitionError('Runbook files must be 512 KiB or smaller.');
    }
    try {
      raw = JSON.parse(json);
    } catch {
      throw new RunbookDefinitionError('The runbook file is not valid JSON.');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RunbookDefinitionError('The runbook file must contain a JSON object.');
  }
  const header = raw as { format?: unknown; formatVersion?: unknown };
  if (header.format !== PORTABLE_RUNBOOK_FORMAT) {
    throw new RunbookDefinitionError(
      `Unsupported file: expected format "${PORTABLE_RUNBOOK_FORMAT}".`
    );
  }
  if (header.formatVersion !== PORTABLE_RUNBOOK_FORMAT_VERSION) {
    throw new RunbookDefinitionError(
      `Unsupported runbook format version. This server imports version ${PORTABLE_RUNBOOK_FORMAT_VERSION}.`
    );
  }
  const parsed = portableRunbookSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RunbookDefinitionError(
      `The runbook file is invalid: ${describeIssues(parsed.error)}`,
      {
        issues: parsed.error.issues,
      }
    );
  }
  return parsed.data;
}

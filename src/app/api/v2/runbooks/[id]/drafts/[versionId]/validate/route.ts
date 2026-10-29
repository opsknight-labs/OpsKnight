import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { DraftParams } from '@/lib/api-v2/runbook-authoring';
import { assertAuthoringDefinition } from '@/lib/runbooks/authoring-validation';
import { runbookInputsSchema } from '@/lib/runbooks/schemas';
import { AppError } from '@/lib/errors';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: DraftParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const draft = await prisma.runbookVersion.findFirst({
      where: { id: params.versionId, runbookId: params.id, state: 'DRAFT' },
      include: { inputs: true },
    });
    if (!draft) throw new AppError({ code: 'RUNBOOK_VERSION_NOT_FOUND' });
    const inputs = runbookInputsSchema.parse(
      draft.inputs.map(input => ({
        key: input.key,
        label: input.label,
        type: input.type,
        required: input.required,
        defaultValue: input.defaultValue ?? undefined,
        description: input.description ?? '',
        sequence: input.sequence,
        options: input.options,
      }))
    );
    assertAuthoringDefinition(draft.definition, inputs);
    return {
      data: {
        valid: true,
        versionId: draft.id,
        draftRevision: draft.draftRevision,
        checksum: draft.checksum,
      },
    };
  },
});

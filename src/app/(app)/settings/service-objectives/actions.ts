'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';
import { assertAdmin } from '@/lib/rbac';
import { AppError } from '@/lib/errors';
import { runSerializableTransaction } from '@/lib/db-utils';
import {
  createServiceObjective,
  updateServiceObjective,
  archiveServiceObjective,
} from '@/lib/slo/commands';

const identity = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,64}$/i),
    version: z.coerce.number().int().positive().safe(),
  })
  .strict();
export async function saveObjective(_state: { message: string; ok: boolean }, form: FormData) {
  try {
    const actor = await assertAdmin();
    const operation = z.enum(['create', 'update', 'archive']).parse(form.get('operation'));
    const context = { id: actor.id, source: 'UI' as const };
    const patch =
      operation === 'archive'
        ? undefined
        : {
            name: form.get('name'),
            description: form.get('description') || null,
            target: Number(z.string().trim().min(1).parse(form.get('target'))),
            comparator: form.get('comparator'),
            windowType: form.get('windowType'),
            windowValue:
              form.get('windowType') === 'ROLLING_DAYS' ? Number(form.get('windowValue')) : null,
          };
    await runSerializableTransaction(async tx => {
      if (operation === 'create') {
        await createServiceObjective(
          tx,
          {
            ...patch,
            serviceId: form.get('serviceId') || null,
            metricType: form.get('metricType'),
          },
          context,
          null
        );
      } else {
        const current = identity.parse({ id: form.get('id'), version: form.get('version') });
        if (operation === 'archive')
          await archiveServiceObjective(tx, current.id, context, current.version);
        else await updateServiceObjective(tx, current.id, patch, context, current.version);
      }
    });
    revalidatePath('/settings/service-objectives');
    return {
      message:
        operation === 'archive' ? 'Objective archived. History is retained.' : 'Objective saved.',
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof AppError
          ? error.userMessage
          : error instanceof z.ZodError
            ? 'Check the objective fields and measurement limits.'
            : 'Unable to save the objective. Refresh and try again.',
      ok: false,
    };
  }
}

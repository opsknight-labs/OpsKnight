'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { setChangeServiceMapping } from '@/lib/intelligence/changes/service-mapping';

const mappingForm = z.object({
  integrationId: z.string().trim().min(1).max(64),
  value: z.string().trim().min(1).max(128),
  // Empty removes the value from the mapping.
  serviceId: z
    .string()
    .trim()
    .max(64)
    .transform(value => value || null),
});

/** Maps an app/component label value of a change integration to a service. Intelligence managers only. */
export async function mapChangeValueAction(form: FormData): Promise<void> {
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
  const input = mappingForm.parse({
    integrationId: form.get('integrationId') ?? '',
    value: form.get('value') ?? '',
    serviceId: form.get('serviceId') ?? '',
  });
  await setChangeServiceMapping({ ...input, actorId: user.id });
  revalidatePath('/changes');
}

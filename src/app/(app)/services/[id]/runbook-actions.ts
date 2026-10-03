'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanModifyService, assertCapability } from '@/lib/rbac';
import {
  createServiceBinding,
  detachServiceBinding,
  updateServiceBinding,
  replaceBindingTrigger,
} from '@/lib/runbooks/bindings';
import {
  createServiceRunbookBindingSchema,
  updateServiceRunbookBindingSchema,
} from '@/lib/runbooks/schemas';

const idSchema = z.string().cuid();

function jsonObject(value: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Input values must be a valid JSON object.');
  }
}

async function bindingActor(serviceId: string) {
  const [actor] = await Promise.all([
    assertCanModifyService(serviceId),
    assertCapability(CAPABILITIES.RUNBOOK_READ_ALL),
  ]);
  return actor;
}

export async function attachRunbookAction(serviceId: string, formData: FormData) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const strategy = String(formData.get('versionStrategy') ?? 'LATEST_PUBLISHED');
  const [runbookId, publishedVersionId] = String(formData.get('runbookSelection') ?? '').split(':');
  const parsed = createServiceRunbookBindingSchema.parse({
    runbookId,
    runbookVersionId: strategy === 'PINNED' ? publishedVersionId || undefined : undefined,
    enabled: true,
    mode: formData.get('mode') ?? 'MANUAL',
    versionStrategy: strategy,
    inputValues: jsonObject(formData.get('inputValues')),
  });
  await createServiceBinding(serviceId, parsed, actor.id);
  revalidatePath(`/services/${serviceId}`);
}

export async function updateRunbookBindingAction(
  serviceId: string,
  bindingId: string,
  formData: FormData
) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  const parsed = updateServiceRunbookBindingSchema.parse({
    enabled: formData.get('enabled') === 'true',
    mode: formData.get('mode'),
    versionStrategy: formData.get('versionStrategy'),
    runbookVersionId:
      formData.get('versionStrategy') === 'PINNED'
        ? formData.get('runbookVersionId') || null
        : null,
    inputValues: jsonObject(formData.get('inputValues')),
  });
  await updateServiceBinding(idSchema.parse(bindingId), parsed, actor.id);
  revalidatePath(`/services/${serviceId}`);
}

export async function detachRunbookAction(serviceId: string, bindingId: string) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  await detachServiceBinding(idSchema.parse(bindingId), actor.id);
  revalidatePath(`/services/${serviceId}`);
}

export async function configureRunbookTriggerAction(
  serviceId: string,
  bindingId: string,
  formData: FormData
) {
  const actor = await bindingActor(idSchema.parse(serviceId));
  let conditions: unknown = [];
  try {
    conditions = JSON.parse(String(formData.get('conditions') || '[]'));
  } catch {
    throw new Error('Trigger conditions must be valid JSON.');
  }
  await replaceBindingTrigger(
    idSchema.parse(bindingId),
    {
      event: String(formData.get('event') ?? 'INCIDENT_CREATED') as 'INCIDENT_CREATED',
      conditionLogic: String(formData.get('conditionLogic') ?? 'AND') as 'AND',
      enabled: true,
      conditions: conditions as never,
    },
    actor.id
  );
  revalidatePath(`/services/${serviceId}`);
}

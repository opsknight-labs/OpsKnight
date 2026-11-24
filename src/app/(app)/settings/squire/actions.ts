'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/rbac';
import {
  addSquireMemory,
  deleteSquireMemory,
  setSquireMemoryEnabled,
  SQUIRE_MEMORY_SETTINGS_HREF,
  updateSquireMemory,
  type SquireMemoryResult,
} from '@/lib/intelligence/squire/memory';

// Every action acts only on the signed-in person's own memory: the store is keyed by their id.

const idSchema = z.string().min(1).max(64);
const textSchema = z.string().max(2_000);

export async function addMyMemory(text: string): Promise<SquireMemoryResult> {
  const user = await getCurrentUser();
  const result = await addSquireMemory(user.id, textSchema.parse(text));
  revalidatePath(SQUIRE_MEMORY_SETTINGS_HREF);
  return result;
}

export async function updateMyMemory(id: string, text: string): Promise<SquireMemoryResult> {
  const user = await getCurrentUser();
  const result = await updateSquireMemory(user.id, idSchema.parse(id), textSchema.parse(text));
  revalidatePath(SQUIRE_MEMORY_SETTINGS_HREF);
  return result;
}

export async function deleteMyMemory(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  const ok = await deleteSquireMemory(user.id, idSchema.parse(id));
  revalidatePath(SQUIRE_MEMORY_SETTINGS_HREF);
  return { ok };
}

export async function setMyMemoryEnabled(enabled: boolean): Promise<{ ok: true }> {
  const user = await getCurrentUser();
  await setSquireMemoryEnabled(user.id, z.boolean().parse(enabled));
  revalidatePath(SQUIRE_MEMORY_SETTINGS_HREF);
  return { ok: true };
}

import { expect, type APIResponse } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod/v3';

/** Wait for the real ingestion worker; HTTP 202 only acknowledges the durable receipt. */
export async function completedIngestion(db: PrismaClient, response: APIResponse) {
  expect(response.status()).toBe(202);
  const accepted = z
    .object({
      data: z.object({
        result: z.object({
          action: z.literal('accepted'),
          receiptId: z.string().min(1),
        }),
      }),
    })
    .parse(await response.json());
  const id = accepted.data.result.receiptId;
  await expect
    .poll(async () => (await db.ingestionReceipt.findUniqueOrThrow({ where: { id } })).status, {
      message: `Ingestion receipt ${id} must complete through the worker`,
      timeout: 30000,
    })
    .toBe('COMPLETED');
  const receipt = await db.ingestionReceipt.findUniqueOrThrow({ where: { id } });
  const result = z
    .object({ action: z.string(), incidentId: z.string().min(1) })
    .parse(receipt.result);
  return { data: { result: { action: result.action, incident: { id: result.incidentId } } } };
}

'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove } from '@/lib/rbac';
import { ActionItemStatus, Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

export type UpdateActionItemStatusResult = {
  success: boolean;
  error?: string;
  item?: {
    id: string;
    status: ActionItemStatus;
    completedAt: Date | null;
  };
};

/**
 * Updates the status of an ActionItem, updating both the relational record
 * and the legacy JSON representation on the parent postmortem.
 */
export async function updateActionItemStatus(
  itemId: string,
  newStatus: ActionItemStatus
): Promise<UpdateActionItemStatusResult> {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unauthorized',
    };
  }

  if (!itemId || !newStatus) {
    return { success: false, error: 'Invalid parameters' };
  }

  try {
    const existing = await prisma.actionItem.findUnique({
      where: { id: itemId },
      include: { postmortem: true },
    });

    const isCompleted = newStatus === ActionItemStatus.COMPLETED;
    const completedAt = isCompleted ? new Date() : null;

    if (existing) {
      const updated = await prisma.$transaction(async tx => {
        const item = await tx.actionItem.update({
          where: { id: itemId },
          data: {
            status: newStatus,
            completedAt,
            updatedAt: new Date(),
          },
        });

        // Synchronize legacy JSON on parent postmortem if present
        if (existing.postmortem?.actionItems && Array.isArray(existing.postmortem.actionItems)) {
          const legacyItems = existing.postmortem.actionItems as Array<{
            id?: string;
            status?: string;
            completedAt?: string | null;
            [key: string]: unknown;
          }>;

          const updatedLegacy = legacyItems.map(legacy => {
            if (legacy.id === itemId || legacy.id === existing.id) {
              return {
                ...legacy,
                status: newStatus,
                completedAt: completedAt ? completedAt.toISOString() : null,
              };
            }
            return legacy;
          });

          await tx.postmortem.update({
            where: { id: existing.postmortemId },
            data: {
              actionItems: updatedLegacy as Prisma.InputJsonValue,
              updatedAt: new Date(),
            },
          });
        }

        return item;
      });

      revalidatePath('/action-items');
      revalidatePath('/postmortems');
      if (existing.incidentId) {
        revalidatePath(`/postmortems/${existing.incidentId}`);
      }

      return {
        success: true,
        item: {
          id: updated.id,
          status: updated.status,
          completedAt: updated.completedAt,
        },
      };
    }

    // Handle legacy-only action item that might not yet have an ActionItem row
    const postmortemWithLegacy = await prisma.postmortem.findFirst({
      where: {
        actionItems: {
          not: Prisma.JsonNull,
        },
      },
    });

    if (!postmortemWithLegacy) {
      return { success: false, error: 'Action item not found' };
    }

    revalidatePath('/action-items');
    return { success: true };
  } catch (error) {
    logger.error('[ActionItems] Failed to update action item status', { error, itemId, newStatus });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Internal error updating status',
    };
  }
}

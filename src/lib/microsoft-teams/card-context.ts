import prisma from '@/lib/prisma';

/** Read-only presentation context. The delivery state machine remains the sole ledger writer. */
export async function getMicrosoftTeamsInteractiveCardContext(destinationId: string, incidentId: string, replacesCanonicalActivity = false) {
  const [config, destination, message] = await Promise.all([
    prisma.microsoftTeamsConfig.findFirst({ where: { enabled: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.microsoftTeamsDestination.findUnique({ where: { id: destinationId }, include: { installation: true } }),
    prisma.microsoftTeamsIncidentMessage.findUnique({ where: { incidentId_destinationId: { incidentId, destinationId } } }),
  ]);
  if (!config?.interactiveEnabled || !destination?.enabled || !destination.interactiveEnabled || !destination.installation?.enabled) return undefined;
  return { destinationId, messageGeneration: (message?.messageGeneration ?? 1) + (replacesCanonicalActivity ? 1 : 0) };
}

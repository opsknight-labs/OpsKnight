import 'server-only';
import prisma from '@/lib/prisma';
import { getIntelligenceSettings } from '../settings/service';

/** The "Suggest people" switch behind the master switch: cover candidates, experts, load and noise cards. */
export async function peopleSuggestionsEnabled(client: typeof prisma = prisma): Promise<boolean> {
  const settings = await getIntelligenceSettings(client);
  return settings.enabled && settings.peopleInsightsEnabled;
}

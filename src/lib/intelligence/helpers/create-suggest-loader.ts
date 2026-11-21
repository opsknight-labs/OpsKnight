import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { withDbBudget } from '../jobs/db-budget';
import { buildIncidentFingerprint } from '../normalization';
import { getIntelligenceSettings } from '../settings/service';
import { detectCapabilities } from '../similarity/capabilities';
import {
  tolerant,
  toFingerprint,
  TRIGRAM_THRESHOLD,
  type StoredFingerprint,
} from '../similarity/retrieval';
import { combinedContent, scoreSimilarity } from '../similarity/scoring';
import {
  fullTextQueryText,
  inverseDocumentFrequency,
  planFullTextQuery,
  termFrequencies,
} from '../similarity/term-stats';
import {
  suggestForDraft,
  SUGGEST_MIN_SIMILARITY,
  type DraftCandidate,
  type DraftSuggestions,
} from './create-suggest';

/** Fingerprints fetched per source (full text, trigram); at most twice this many are scored. */
const CANDIDATES_PER_SOURCE = 25;
/** Look-alikes resolved to incidents the reader may see. */
const MAX_LOOKALIKES = 20;
/** The form is interactive: a slow index gives up rather than hold a connection. */
const MAX_DB_MS = 400;
const MIN_TITLE_CHARS = 8;

const NOTHING: DraftSuggestions = { service: null, urgency: null, duplicate: null };

/**
 * Suggestions for an incident that does not exist yet: the same index-backed sources as incident similarity
 * (full text over the two rarest words, trigram over the title template), re-scored in memory, then narrowed
 * to incidents `actor` may read. Three bounded queries; no model call.
 */
export async function suggestForIncidentDraft(
  actor: AuthorizationActor,
  draft: {
    title: string;
    description?: string | null;
    serviceId?: string | null;
    urgency?: string | null;
  },
  now: Date = new Date()
): Promise<DraftSuggestions> {
  if (actor.status !== 'ACTIVE' || draft.title.trim().length < MIN_TITLE_CHARS) return NOTHING;
  const settings = await getIntelligenceSettings();
  if (!settings.enabled || !settings.opsHelpersEnabled) return NOTHING;

  const fingerprint = buildIncidentFingerprint({
    title: draft.title.slice(0, 255),
    description: draft.description?.slice(0, 2000),
  });
  if (fingerprint.tokens.length === 0) return NOTHING;
  const [capabilities, frequencies] = await Promise.all([detectCapabilities(), termFrequencies()]);
  const lowerBound = new Date(now.getTime() - settings.lookbackDays * 86_400_000);
  const columns = Prisma.sql`"incidentId", "serviceId", "template", "tokens", "labels", "incidentCreatedAt", "resolvedAt"`;

  const stored = await withDbBudget({ maxDbMs: MAX_DB_MS }, async tx => {
    const rows = new Map<string, StoredFingerprint>();
    const collect = (found: StoredFingerprint[]) => {
      for (const row of found) rows.set(row.incidentId, row);
    };
    const plan = planFullTextQuery(fingerprint.tokens, frequencies);
    if (plan.terms.length > 0 && (plan.distinctive || !capabilities.trigramAvailable)) {
      const tsQuery = fullTextQueryText(plan);
      collect(
        await tolerant(tx, 'draft_fulltext', () =>
          tx.$queryRaw<StoredFingerprint[]>(Prisma.sql`
            SELECT ${columns} FROM "IncidentFingerprint"
            WHERE "searchVector" @@ websearch_to_tsquery('simple', ${tsQuery})
              AND "incidentCreatedAt" > ${lowerBound}
            ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${tsQuery})) DESC, "incidentCreatedAt" DESC
            LIMIT ${CANDIDATES_PER_SOURCE}`)
        )
      );
    }
    if (capabilities.trigramAvailable && fingerprint.template.length > 0) {
      collect(
        await tolerant(tx, 'draft_trigram', async () => {
          await tx.$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', ${TRIGRAM_THRESHOLD}, true)`;
          return tx.$queryRaw<StoredFingerprint[]>(Prisma.sql`
            SELECT ${columns} FROM "IncidentFingerprint"
            WHERE "template" % ${fingerprint.template} AND "incidentCreatedAt" > ${lowerBound}
            ORDER BY "template" <-> ${fingerprint.template}
            LIMIT ${CANDIDATES_PER_SOURCE}`);
        })
      );
    }
    return [...rows.values()];
  });

  const query = { ...fingerprint, serviceId: '', incidentCreatedAt: now, resolvedAt: null };
  const idf = (token: string) => inverseDocumentFrequency(token, frequencies);
  const similarity = new Map(
    stored
      .map(row => {
        const { components } = scoreSimilarity(query, toFingerprint(row), now, undefined, idf);
        return [row.incidentId, combinedContent(components)] as const;
      })
      .filter(([, value]) => value >= SUGGEST_MIN_SIMILARITY)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_LOOKALIKES)
  );
  if (similarity.size === 0) return NOTHING;

  const incidents = await prisma.incident.findMany({
    where: { AND: [{ id: { in: [...similarity.keys()] } }, incidentReadWhere(actor)] },
    select: {
      id: true,
      title: true,
      status: true,
      urgency: true,
      serviceId: true,
      createdAt: true,
      service: { select: { name: true } },
    },
  });
  const candidates: DraftCandidate[] = incidents.map(incident => ({
    incidentId: incident.id,
    title: incident.title,
    status: incident.status,
    urgency: incident.urgency,
    serviceId: incident.serviceId,
    serviceName: incident.service.name,
    similarity: similarity.get(incident.id) ?? 0,
    createdAt: incident.createdAt,
  }));
  return suggestForDraft(candidates, { serviceId: draft.serviceId, urgency: draft.urgency });
}

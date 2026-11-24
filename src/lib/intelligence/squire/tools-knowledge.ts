import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { AiDataClass, AiToolDefinition } from '../ai/port';
import {
  KNOWLEDGE_LIMITS,
  KNOWLEDGE_SOURCE_KINDS,
  validateServiceFact,
  type KnowledgeSourceKindValue,
} from '../memory/contract';
import { canCurateServiceKnowledge } from '../memory/facts';
import { searchKnowledgeForActor } from '../memory/search';
import { searchDocumentsForActor } from '../knowledge/doc-sources/service';
import { getSquireMemorySettings } from '../memory/settings';

/**
 * Squire's knowledge tools (Workstream F4). Kept apart from tools.ts so the knowledge memory can evolve on its
 * own; tools.ts registers them. Reading only: the one way knowledge grows from a conversation is a
 * `learn_service_fact` proposal, which a person must confirm (see actions/execute.ts).
 */

/** Postmortems and notes are text people wrote (Personal); runbook steps and facts alone are Internal. */
export const KNOWLEDGE_TOOL_DATA_CLASS: Readonly<Record<string, AiDataClass>> = {
  search_knowledge: 'PERSONAL',
};

/** The organisation's own documentation (KnowledgeDocSource) is searched beside the knowledge memory. */
const SEARCH_KINDS = [...KNOWLEDGE_SOURCE_KINDS, 'DOCUMENT'] as const;

const inputSchema = z
  .object({
    query: z.string().trim().min(2).max(300),
    kinds: z.array(z.enum(SEARCH_KINDS)).max(6).optional(),
    serviceId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export function buildKnowledgeTools(
  actor: AuthorizationActor,
  options: { personal: boolean; signal?: AbortSignal }
): AiToolDefinition[] {
  return [
    {
      name: 'search_knowledge',
      description:
        'Search what the organisation already learned: postmortems, resolution notes, incident notes, runbook steps, confirmed facts about services and its own documentation. Returns at most 8 short passages, each with the record it came from (for a document, its path and link), so you can cite it. Use it before guessing a fix.',
      kind: 'READ',
      dataClass: options.personal ? 'PERSONAL' : 'INTERNAL',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2, maxLength: 300 },
          kinds: {
            type: 'array',
            maxItems: 6,
            items: { type: 'string', enum: [...SEARCH_KINDS] },
          },
          serviceId: { type: 'string', minLength: 1, maxLength: 64 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async input => {
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const { kinds, query } = parsed.data;
        const memoryKinds = kinds?.filter(
          (kind): kind is KnowledgeSourceKindValue => kind !== 'DOCUMENT'
        );
        const [result, documents] = await Promise.all([
          memoryKinds?.length === 0
            ? { items: [], coverage: 'LEXICAL' as const }
            : searchKnowledgeForActor(actor, {
                query,
                kinds: memoryKinds,
                serviceId: parsed.data.serviceId,
                personal: options.personal,
                signal: options.signal,
              }),
          kinds && !kinds.includes('DOCUMENT') ? [] : searchDocumentsForActor(actor, query),
        ]);
        if (result.coverage === 'OFF')
          return { items: [], note: 'The knowledge index is turned off.' };
        // Interleaved rather than sorted: fused semantic scores and lexical document scores are not comparable.
        const items: Array<(typeof result.items)[number] | (typeof documents)[number]> = [];
        for (let index = 0; index < Math.max(result.items.length, documents.length); index += 1) {
          const memory = result.items.at(index);
          const document = documents.at(index);
          if (memory) items.push(memory);
          if (document) items.push(document);
        }
        return { ...result, items: items.slice(0, KNOWLEDGE_LIMITS.resultLimit) };
      },
    },
  ];
}

const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The card for a `learn_service_fact` proposal, or null when it could not be confirmed anyway: the index is off,
 * the fact is not a valid fact, or this person may not curate the service's knowledge.
 */
export async function describeServiceFact(
  actor: AuthorizationActor,
  incidentId: string,
  fact: string
): Promise<{ title: string; detail: string } | null> {
  if (!(await getSquireMemorySettings()).knowledgeEnabled) return null;
  const valid = validateServiceFact(fact);
  if (!valid.ok) return null;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { serviceId: true, service: { select: { name: true } } },
  });
  if (!incident || !(await canCurateServiceKnowledge(actor, incident.serviceId))) return null;
  return {
    title: 'Remember a fact about this service',
    detail: `Save to Squire’s knowledge for “${short(incident.service.name, 80)}”: ${short(valid.fact, 300)}`,
  };
}

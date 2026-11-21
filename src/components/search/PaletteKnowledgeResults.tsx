'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, FileText, Zap } from 'lucide-react';
import { searchPaletteKnowledgeAction } from '@/app/(app)/palette-actions';
import { CommandGroup, CommandItem } from '@/components/ui/shadcn/command';
import {
  paletteKnowledgeQuery,
  type PaletteKnowledgeHit,
} from '@/lib/intelligence/helpers/palette-search';

const DEBOUNCE_MS = 400;
const ICONS = { incident: Zap, postmortem: FileText, runbook: BookOpen } as const;
const LABELS = { incident: 'Incident', postmortem: 'Postmortem', runbook: 'Runbook' } as const;

/**
 * A palette group for questions ("why did checkout fail last week"): passages from past incidents,
 * postmortems and runbooks the person can open. Renders nothing for short name lookups, while the helpers
 * or the knowledge index are off, and when nothing matches.
 */
export default function PaletteKnowledgeResults({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (href: string) => void;
}) {
  const [found, setFound] = useState<{ query: string; hits: PaletteKnowledgeHit[] } | null>(null);
  const request = useRef(0);
  const question = paletteKnowledgeQuery(query);

  useEffect(() => {
    // Every keystroke supersedes the request in flight.
    const current = ++request.current;
    if (!question) return;
    const timer = setTimeout(() => {
      searchPaletteKnowledgeAction(question)
        .then(hits => {
          if (request.current === current) setFound({ query: question, hits });
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [question]);

  // Results for an earlier query are never shown under a newer one.
  if (!question || found?.query !== question || found.hits.length === 0) return null;
  return (
    <CommandGroup heading="From past incidents and runbooks" data-testid="palette-knowledge">
      {found.hits.map(hit => {
        const Icon = ICONS[hit.kind];
        return (
          <CommandItem
            key={hit.href}
            value={`knowledge-${hit.href}`}
            onSelect={() => onOpen(hit.href)}
            className="min-h-11 aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
          >
            <div className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-muted/50">
              <Icon className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </div>
            <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
              <span className="truncate text-sm font-medium">{hit.title}</span>
              <span className="truncate text-2xs text-muted-foreground">
                {LABELS[hit.kind]} · {hit.snippet}
              </span>
            </div>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

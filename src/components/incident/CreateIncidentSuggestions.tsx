'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { suggestForIncidentDraftAction } from '@/app/(app)/incidents/helper-actions';
import { Button } from '@/components/ui/shadcn/button';
import type { DraftSuggestions } from '@/lib/intelligence/helpers/create-suggest';

const DEBOUNCE_MS = 500;
const MIN_TITLE_CHARS = 8;
const URGENCY_LABEL: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const CHIP_CLASS = 'min-h-11 rounded-xl px-3 text-xs';

type Urgency = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Suggestions under the title while an incident is typed: a likely service and urgency from past
 * look-alikes, and an unresolved incident that may already cover it. Renders nothing until there is
 * something to say; picking a suggestion only fills the form field.
 */
export default function CreateIncidentSuggestions({
  title,
  serviceId,
  urgency,
  getDescription,
  selectableServiceIds,
  onPickService,
  onPickUrgency,
  incidentHrefBase = '/incidents',
}: {
  title: string;
  serviceId: string;
  urgency: Urgency;
  getDescription: () => string | undefined;
  /** Services this person can create incidents for; a suggestion outside the list is not offered. */
  selectableServiceIds: ReadonlySet<string>;
  onPickService: (serviceId: string) => void;
  onPickUrgency: (urgency: Urgency) => void;
  /** Where the possible duplicate links: `/m/incidents` on the mobile create page. */
  incidentHrefBase?: string;
}) {
  const [suggestions, setSuggestions] = useState<DraftSuggestions | null>(null);
  const request = useRef(0);
  const describe = useRef(getDescription);
  useEffect(() => {
    describe.current = getDescription;
  });
  const longEnough = title.trim().length >= MIN_TITLE_CHARS;

  useEffect(() => {
    // Every change supersedes the request in flight, including a title cut back below the minimum.
    const current = ++request.current;
    if (!longEnough) return;
    const timer = setTimeout(() => {
      suggestForIncidentDraftAction({
        title: title.slice(0, 255),
        description: describe.current()?.slice(0, 10_000) || undefined,
        serviceId: serviceId || undefined,
        urgency,
      })
        .then(result => {
          // Only the latest keystroke's answer is shown.
          if (request.current === current) setSuggestions(result);
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [title, serviceId, urgency, longEnough]);

  if (!longEnough || !suggestions) return null;
  const service =
    suggestions.service && !serviceId && selectableServiceIds.has(suggestions.service.id)
      ? suggestions.service
      : null;
  const suggestedUrgency =
    suggestions.urgency &&
    suggestions.urgency.value !== urgency &&
    suggestions.urgency.value in URGENCY_LABEL
      ? suggestions.urgency
      : null;
  const duplicate = suggestions.duplicate;
  if (!service && !suggestedUrgency && !duplicate) return null;

  return (
    <div
      aria-live="polite"
      className="space-y-2 text-xs text-muted-foreground"
      data-testid="create-incident-suggestions"
    >
      {duplicate && (
        <p>
          Possibly already open:{' '}
          <Link
            href={`${incidentHrefBase}/${duplicate.incidentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {duplicate.title}
          </Link>{' '}
          <span>in {duplicate.serviceName}</span>
        </p>
      )}
      {(service || suggestedUrgency) && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Based on similar past incidents:</span>
          {service && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={CHIP_CLASS}
              onClick={() => onPickService(service.id)}
            >
              Use service {service.name}
            </Button>
          )}
          {suggestedUrgency && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={CHIP_CLASS}
              onClick={() => onPickUrgency(suggestedUrgency.value as Urgency)}
            >
              Set urgency to {URGENCY_LABEL[suggestedUrgency.value]}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

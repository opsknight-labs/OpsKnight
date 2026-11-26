/* eslint-disable security/detect-object-injection -- lifecycle is a typed enum value, never request input */
import type { ReactNode } from 'react';
import type { BusinessServiceLifecycle } from '@prisma/client';
import { ExternalLink } from 'lucide-react';
import { SectionCard } from '@/components/analytics/SectionCard';
import { RelativeTime } from '@/components/patterns';
import { LIFECYCLE_LABEL } from './HealthBadge';

const term = 'text-xs text-muted-foreground';
const chip = 'rounded-full border bg-muted/40 px-2 py-0.5 text-xs';

/**
 * Side panel of the overview: the descriptive facts (lifecycle, environment, tags, links, custom
 * attributes, contact, last review) that used to crowd the header, plus `children` rows such as the
 * dependency summary.
 */
export default function DetailsPanel({
  lifecycle,
  environment,
  tags,
  links,
  attributes,
  contactChannel,
  lastReviewedAt,
  children,
}: {
  lifecycle: BusinessServiceLifecycle;
  environment: string | null;
  tags: readonly string[];
  links: readonly { label: string; url: string }[];
  /** Custom attributes as stored (a flat JSON object); anything else is ignored. */
  attributes: unknown;
  contactChannel: string | null;
  lastReviewedAt: Date | null;
  children?: ReactNode;
}) {
  const attributeEntries =
    attributes && typeof attributes === 'object' && !Array.isArray(attributes)
      ? Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b))
      : [];
  return (
    <SectionCard id="bs-details" title="Details">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className={term}>Lifecycle</dt>
          <dd>
            {LIFECYCLE_LABEL[lifecycle]}
            {environment && <span className="text-muted-foreground"> · {environment}</span>}
          </dd>
        </div>
        {tags.length > 0 && (
          <div>
            <dt className={term}>Tags</dt>
            <dd>
              <ul aria-label="Tags" className="mt-1 flex flex-wrap gap-1.5">
                {tags.map(tag => (
                  <li key={tag} className={chip}>
                    {tag}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {links.length > 0 && (
          <div>
            <dt className={term}>Links</dt>
            <dd>
              <ul aria-label="Links" className="mt-1 space-y-1">
                {links.map(entry => (
                  <li key={entry.url}>
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {entry.label}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {attributeEntries.length > 0 && (
          <div>
            <dt className={term}>Attributes</dt>
            <dd>
              <dl
                aria-label="Custom attributes"
                className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
              >
                {attributeEntries.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-mono text-muted-foreground">{key}</dt>
                    <dd className="min-w-0 break-words">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </dd>
          </div>
        )}
        {contactChannel && (
          <div>
            <dt className={term}>Contact</dt>
            <dd className="break-words">{contactChannel}</dd>
          </div>
        )}
        <div>
          <dt className={term}>Last reviewed</dt>
          <dd>{lastReviewedAt ? <RelativeTime date={lastReviewedAt} /> : 'Never'}</dd>
        </div>
        {children}
      </dl>
    </SectionCard>
  );
}

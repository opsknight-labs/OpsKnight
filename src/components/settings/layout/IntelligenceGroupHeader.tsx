import type { ReactNode } from 'react';
import {
  INTELLIGENCE_SETTINGS_GROUPS,
  type IntelligenceSettingsGroupId,
} from '@/lib/intelligence/settings/routes';

/**
 * Title, lead paragraph and "on this page" links of one Intelligence settings group.
 *
 * `visible` lists the sections the page renders for this viewer; a section that is silent by
 * design (nothing failed, a manager-only card) gets no link.
 */
export function IntelligenceGroupHeader({
  group,
  title,
  children,
  visible,
}: {
  group: IntelligenceSettingsGroupId;
  title?: string;
  children: ReactNode;
  visible?: readonly string[];
}) {
  const definition = INTELLIGENCE_SETTINGS_GROUPS.find(candidate => candidate.id === group);
  if (!definition) return null;
  const sections = definition.sections.filter(
    section => visible === undefined || visible.includes(section.id)
  );
  return (
    <header className="space-y-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{title ?? definition.label}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      {sections.length > 1 && (
        <nav aria-label="On this page">
          <ul className="flex flex-wrap gap-x-1 gap-y-0">
            {sections.map(section => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

/** Wraps one section so `#id` links land below the sticky header. */
export function SectionAnchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 space-y-6">
      {children}
    </div>
  );
}

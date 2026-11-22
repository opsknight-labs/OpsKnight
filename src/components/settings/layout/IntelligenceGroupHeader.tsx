import type { ReactNode } from 'react';
import { Activity, BarChart3, Bot, Layers, ShieldCheck, type LucideIcon } from 'lucide-react';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import IntelligenceSubNav from '@/components/settings/layout/IntelligenceSubNav';
import { LearnMore } from '@/components/settings/layout/LearnMore';
import { SectionLinkTabs } from '@/components/settings/layout/LinkTabs';
import {
  INTELLIGENCE_SETTINGS_GROUPS,
  type IntelligenceSettingsGroupId,
} from '@/lib/intelligence/settings/routes';

const ICONS = new Map<IntelligenceSettingsGroupId, LucideIcon>([
  ['engine', Activity],
  ['noise', ShieldCheck],
  ['services', Layers],
  ['assistant', Bot],
  ['evaluation', BarChart3],
]);

/**
 * Header of one Intelligence settings group: the settings page band (icon, title, one-line
 * description, status badges), the group tabs, an optional "Learn more", and a sticky
 * "On this page" bar linking each section by its anchor.
 *
 * Render it as a direct child of the page's root element, so the sticky bar spans the whole page.
 * `visible` lists the sections the page renders for this viewer; a section that is silent by design
 * (nothing failed, a manager-only card) gets no link.
 */
export function IntelligenceGroupHeader({
  group,
  title,
  children,
  visible,
  badges,
  about,
}: {
  group: IntelligenceSettingsGroupId;
  title?: string;
  /** One sentence on what the page is for. */
  children: ReactNode;
  visible?: readonly string[];
  badges?: ReactNode;
  /** The longer explanation, behind a closed "Learn more". */
  about?: ReactNode;
}) {
  const definition = INTELLIGENCE_SETTINGS_GROUPS.find(candidate => candidate.id === group);
  if (!definition) return null;
  const sections = definition.sections.filter(
    section => visible === undefined || visible.includes(section.id)
  );
  return (
    <>
      <SettingsPageHeader
        eyebrow="AIOps Intelligence"
        title={title ?? definition.label}
        description={children}
        icon={ICONS.get(group)}
        badges={badges}
      />
      <IntelligenceSubNav />
      {about && <LearnMore label="How this works">{about}</LearnMore>}
      {sections.length > 1 && <SectionLinkTabs sections={sections} />}
    </>
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

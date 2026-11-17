import { Book, Github, Globe, Heart, LifeBuoy, Mail } from 'lucide-react';
import { APP_VERSION } from '@/lib/constants';
import { requirePageAccess } from '@/lib/access/server';
import {
  MobileIconTile,
  MobileListCard,
  MobileListRow,
  MobileSection,
} from '@/components/mobile/MobileList';

const RESOURCES = [
  {
    href: 'https://opsknight.com/docs',
    title: 'Documentation',
    subtitle: 'Responder guides and API reference',
    icon: Book,
  },
  {
    href: 'https://opsknight.com/',
    title: 'Website',
    subtitle: 'Release notes and updates',
    icon: Globe,
  },
  {
    href: 'https://github.com/opsknight-labs/OpsKnight',
    title: 'GitHub',
    subtitle: 'Source code, issues and discussions',
    icon: Github,
  },
  {
    href: 'https://github.com/sponsors/Dushyant-rahangdale',
    title: 'Sponsor',
    subtitle: 'Support the project',
    icon: Heart,
  },
];

export default async function MobileHelpPage() {
  await requirePageAccess('/m/help');
  return (
    <div className="responsive-page space-y-5">
      <MobileSection
        id="help-resources"
        title="Resources"
        description="Links open in your browser."
      >
        <MobileListCard>
          {RESOURCES.map(item => (
            <MobileListRow
              key={item.title}
              href={item.href}
              external
              leading={<MobileIconTile icon={item.icon} />}
              title={item.title}
              subtitle={item.subtitle}
              ariaLabel={`${item.title} (opens in a new tab)`}
            />
          ))}
        </MobileListCard>
      </MobileSection>

      <MobileSection id="help-contact" title="Contact">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <MobileIconTile icon={LifeBuoy} />
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-foreground">Need assistance?</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Email us about integrations, alert routing or account issues.
              </p>
            </div>
          </div>
          <a
            href="mailto:help@opsknight.com"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 active:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            Email support
          </a>
        </div>
      </MobileSection>

      <p className="text-center text-xs tabular-nums text-muted-foreground">
        OpsKnight Mobile {APP_VERSION}
      </p>
    </div>
  );
}

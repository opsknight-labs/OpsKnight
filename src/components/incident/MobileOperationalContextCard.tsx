import React, { useState } from 'react';
import Link from 'next/link';
import { Tag, ExternalLink, Users, ChevronRight } from 'lucide-react';
import { JiraLogo } from '@/components/common/BrandLogos';
import { IncidentWarRoomManager } from '@/components/incident/war-room/IncidentWarRoomManager';
import type { IncidentCollaborationView } from '@/lib/incident-collaboration/types';
import Badge from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export type MobileContextCapabilities = {
  /** Whether a Jira integration is configured for this workspace. */
  jiraConfigured: boolean;
};

export type MobileOperationalContextCardProps = {
  service: {
    id: string;
    name: string;
    slaTier?: string | null;
  };
  team?: {
    id: string;
    name: string;
  } | null;
  tags?: Array<{
    id: string;
    name: string;
    color?: string | null;
  }>;
  collaboration?: IncidentCollaborationView;
  jiraLinks?: Array<{
    id: string;
    issueKey: string;
    issueUrl: string;
    status?: string;
    summary?: string;
  }>;
  capabilities?: MobileContextCapabilities;
  className?: string;
};

export default function MobileOperationalContextCard({
  service,
  team,
  tags = [],
  collaboration,
  jiraLinks = [],
  capabilities,
  className,
}: MobileOperationalContextCardProps) {
  const [showManager, setShowManager] = useState(false);
  const showJira = capabilities ? capabilities.jiraConfigured || jiraLinks.length > 0 : true;
  const hasJira = jiraLinks.length > 0;

  return (
    <>
      <section
        aria-label="Operational context"
        className={cn(
          'rounded-xl border border-border bg-card p-3.5 text-card-foreground shadow-none space-y-3',
          className
        )}
      >
        <div className="flex items-center justify-between border-b border-border/70 pb-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Operational Context
          </h2>
          <span className="text-[10px] text-muted-foreground font-medium">Responder view</span>
        </div>

        <div className="space-y-2.5 text-xs">
          {/* Tags */}
          <div className="flex items-start justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground shrink-0 pt-0.5">
              <Tag className="h-3.5 w-3.5 text-slate-400" />
              <span>Tags</span>
            </span>
            <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0">
              {tags.length > 0 ? (
                tags.map(tag => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border border-border/60 bg-muted/40 text-foreground truncate max-w-[120px]"
                    style={
                      tag.color ? { borderLeftColor: tag.color, borderLeftWidth: 3 } : undefined
                    }
                  >
                    {tag.name}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground text-[11px]">None</span>
              )}
            </div>
          </div>

          {/* Unified War Rooms Row */}
          {collaboration?.visible && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground shrink-0">
                <Users className="h-3.5 w-3.5" />
                <span>War rooms</span>
              </span>
              <div className="min-w-0 text-right">
                <button
                  type="button"
                  onClick={() => setShowManager(true)}
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline truncate max-w-[200px]"
                >
                  <span>
                    {collaboration.summary.activeRooms > 0
                      ? `${collaboration.providers
                          .filter(p => p.currentRoom)
                          .map(p => p.displayName)
                          .join(' · ')} · ${collaboration.summary.activeRooms} active`
                      : collaboration.providers.some(p => p.canCreate)
                        ? 'Available to create'
                        : `${collaboration.summary.totalHistoricalRooms} previous`}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
                </button>
              </div>
            </div>
          )}

          {/* Jira — only shown when Jira is configured or a link already exists */}
          {showJira && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground shrink-0">
                <JiraLogo className="h-3.5 w-3.5" />
                <span>Jira</span>
              </span>
              <div className="min-w-0 text-right">
                {hasJira ? (
                  <div className="inline-flex items-center gap-1.5">
                    <a
                      href={jiraLinks[0].issueUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                    >
                      <span>{jiraLinks[0].issueKey}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                    </a>
                    {jiraLinks[0].status && (
                      <Badge variant="default" className="h-4 px-1 text-[9px] font-normal">
                        {jiraLinks[0].status}
                      </Badge>
                    )}
                    {jiraLinks.length > 1 && (
                      <span className="text-[10px] text-muted-foreground font-medium">
                        +{jiraLinks.length - 1}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-[11px]">Unlinked</span>
                )}
              </div>
            </div>
          )}

          {/* Service & Team Summary */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/70 text-[11px]">
            <div className="min-w-0">
              <span className="text-muted-foreground block text-[10px]">Service</span>
              <Link
                href={`/m/services/${service.id}`}
                className="mt-0.5 font-semibold text-foreground hover:underline truncate block"
              >
                {service.name}
              </Link>
            </div>
            <div className="min-w-0">
              <span className="text-muted-foreground block text-[10px]">Team</span>
              {team ? (
                <Link
                  href={`/m/teams/${team.id}`}
                  className="mt-0.5 font-semibold text-foreground hover:underline truncate block"
                >
                  {team.name}
                </Link>
              ) : (
                <span className="mt-0.5 text-muted-foreground truncate block">Unassigned</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {collaboration?.visible && (
        <IncidentWarRoomManager
          collaboration={collaboration}
          open={showManager}
          onOpenChange={setShowManager}
          presentation="mobile"
        />
      )}
    </>
  );
}

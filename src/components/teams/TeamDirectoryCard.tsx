import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Users, ArrowRight, Shield } from 'lucide-react';
import TeamLeadBadge from './TeamLeadBadge';
import TeamAvatarStack from './TeamAvatarStack';
import TeamOwnedServicesGrid from './TeamOwnedServicesGrid';

type TeamDirectoryCardProps = {
  team: {
    id: string;
    name: string;
    description?: string | null;
    teamLead?: {
      id: string;
      name: string;
      avatarUrl?: string | null;
      gender?: string | null;
    } | null;
    members: Array<{
      userId: string;
      role: string;
      user: {
        id?: string;
        name: string;
        avatarUrl?: string | null;
        gender?: string | null;
      };
    }>;
    services: Array<{
      id: string;
      name: string;
    }>;
    _count: {
      members: number;
      services: number;
    };
  };
};

export default function TeamDirectoryCard({ team }: TeamDirectoryCardProps) {
  return (
    <Card className="group flex flex-col justify-between overflow-hidden border-border/70 shadow-2xs hover:border-primary/50 hover:shadow-xs transition-all">
      <div>
        {/* Card Header with Icon, Name & Team Lead */}
        <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/teams/${team.id}`}
                  className="font-bold text-sm text-foreground hover:text-primary transition-colors truncate block"
                >
                  {team.name}
                </Link>
                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                  {team.description || 'No mission defined.'}
                </p>
              </div>
            </div>

            <TeamLeadBadge lead={team.teamLead} size="sm" className="shrink-0" />
          </div>
        </CardHeader>

        {/* Card Body: Avatars & Services Preview */}
        <CardContent className="p-4 space-y-3">
          {/* Members Stack & Count */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground font-medium shrink-0">
              <Users className="h-3.5 w-3.5 text-muted-foreground/70" />
              <span>Members ({team._count.members}):</span>
            </div>
            <TeamAvatarStack members={team.members} maxVisible={5} size="sm" />
          </div>

          {/* Owned Services Preview */}
          <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-border/50">
            <div className="flex items-center gap-1.5 text-muted-foreground font-medium shrink-0">
              <Shield className="h-3.5 w-3.5 text-muted-foreground/70" />
              <span>Services ({team._count.services}):</span>
            </div>
            <TeamOwnedServicesGrid services={team.services} compact />
          </div>
        </CardContent>
      </div>

      {/* Card Footer: Action Link */}
      <div className="border-t bg-muted/10 px-4 py-2.5 sm:px-5 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {team._count.members > 0 ? 'Active roster' : 'Needs setup'}
        </span>
        <Link
          href={`/teams/${team.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline underline-offset-2"
        >
          <span>Manage Team</span>
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Card>
  );
}

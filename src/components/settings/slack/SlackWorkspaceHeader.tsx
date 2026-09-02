'use client';

import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { SlackLogo } from '@/components/common/BrandLogos';
import { CheckCircle2, RefreshCw, ArrowRightLeft } from 'lucide-react';

interface SlackWorkspaceHeaderProps {
  workspaceName: string;
  installerName: string;
  updatedAt: Date;
  enabled: boolean;
  isAdmin: boolean;
  onReconnect?: () => void;
  onReplaceWorkspace?: () => void;
}

export function SlackWorkspaceHeader({
  workspaceName,
  installerName,
  updatedAt,
  enabled,
  isAdmin,
  onReconnect,
  onReplaceWorkspace,
}: SlackWorkspaceHeaderProps) {
  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Logo and Info */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-[#4A154B]/10 border border-[#4A154B]/20 shrink-0">
            <SlackLogo className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-bold tracking-tight text-foreground truncate">
                {workspaceName || 'Slack Workspace'}
              </h3>
              <Badge
                variant={enabled ? 'success' : 'neutral'}
                className="text-[10px] font-semibold gap-1"
              >
                {enabled ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Active
                  </>
                ) : (
                  'Disabled'
                )}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connected by <span className="font-medium text-foreground">{installerName}</span> on{' '}
              {new Date(updatedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
        </div>

        {/* Right: Actions */}
        {isAdmin && (
          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            {onReconnect && (
              <Button
                variant="outline"
                size="sm"
                onClick={onReconnect}
                className="h-8 text-xs font-semibold gap-1.5 border-border/80 hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Reconnect</span>
              </Button>
            )}
            {onReplaceWorkspace && (
              <Button
                variant="outline"
                size="sm"
                onClick={onReplaceWorkspace}
                className="h-8 text-xs font-semibold gap-1.5 border-border/80 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                <span>Replace Workspace</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SlackWorkspaceHeader;

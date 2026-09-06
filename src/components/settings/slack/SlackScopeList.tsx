'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';

interface SlackScopeListProps {
  presentScopes: string[];
  requiredScopes: string[];
  optionalScopes: string[];
  onReconnect?: () => void;
  isAdmin?: boolean;
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'chat:write': 'Post incident alerts, war-room updates, and status changes',
  'channels:read': 'List public channels in workspace for incident triage',
  'channels:join': 'Auto-join public channels when service notifications are configured',
  'channels:manage': 'Automatically create dedicated incident war-room channels',
  'channels:history': 'Read messages to index pinned incident context and notes',
  'groups:read': 'Discover private channels the bot has been invited into',
  'groups:write': 'Create and manage private war rooms for sensitive security incidents',
  'groups:history': 'Read private channel history for pinned notes',
  'reactions:read': 'Listen for 📌 emoji reactions to capture notes automatically',
  'users:read': 'Resolve Slack user IDs to display responder names and avatars',
  'users:read.email': 'Match Slack users with OpsKnight responders for automated on-call paging',
  'im:read': 'Support 1-on-1 direct message triage notifications',
  'mpim:read': 'Support multi-party group direct message notifications',
};

function getScopeDescription(scope: string): string {
  if (Object.prototype.hasOwnProperty.call(SCOPE_DESCRIPTIONS, scope)) {
    return SCOPE_DESCRIPTIONS[scope as keyof typeof SCOPE_DESCRIPTIONS];
  }
  return 'Slack bot capability';
}

export function SlackScopeList({
  presentScopes,
  requiredScopes,
  optionalScopes,
  onReconnect,
  isAdmin = false,
}: SlackScopeListProps) {
  const [isOpen, setIsOpen] = useState(false);
  const scopeSet = new Set(presentScopes);
  const missingRequired = requiredScopes.filter(scope => !scopeSet.has(scope));
  const allScopes = [...requiredScopes, ...optionalScopes];
  const isHealthy = missingRequired.length === 0;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between px-5 py-4 h-auto hover:bg-muted/40 rounded-none"
          >
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg border shrink-0 ${
                  isHealthy
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                }`}
              >
                {isHealthy ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground text-sm">Scope Checklist</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    ({presentScopes.length} of {allScopes.length} scopes active)
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Permissions granted to the OpsKnight bot in this Slack workspace
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant={isHealthy ? 'success' : 'destructive'}
                className="text-[10px] font-semibold gap-1"
              >
                {isHealthy ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    All required scopes present
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3" />
                    {missingRequired.length} missing
                  </>
                )}
              </Badge>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform duration-200',
                  isOpen && 'rotate-180'
                )}
              />
            </div>
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-5 pb-5 pt-2 border-t bg-muted/10">
          <div className="space-y-2 mt-2">
            {allScopes.map(scope => {
              const isRequired = requiredScopes.includes(scope);
              const hasScope = scopeSet.has(scope);
              const description = getScopeDescription(scope);

              return (
                <div
                  key={scope}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg border text-xs transition-colors ${
                    hasScope
                      ? 'border-border/60 bg-background/60 hover:bg-background'
                      : isRequired
                        ? 'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10'
                        : 'border-border/40 bg-muted/20 opacity-70'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {hasScope ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="font-mono font-semibold text-foreground text-[11px]">
                          {scope}
                        </code>
                        <Badge
                          variant={hasScope ? 'outline' : isRequired ? 'destructive' : 'secondary'}
                          className="text-[9px] px-1.5 py-0 h-4 font-medium"
                        >
                          {hasScope ? 'Granted' : isRequired ? 'Required' : 'Optional'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 pt-3 border-t text-xs text-muted-foreground">
            <p>Scope changes take effect after reinstalling or reconnecting Slack.</p>
            {missingRequired.length > 0 && isAdmin && onReconnect && (
              <Button
                variant="outline"
                size="sm"
                onClick={onReconnect}
                className="h-8 text-xs font-semibold gap-1.5 shrink-0 self-start sm:self-auto"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reconnect to refresh scopes
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default SlackScopeList;

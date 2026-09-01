'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { KeyRound, LogOut, Shield, ArrowUpRight, Clock } from 'lucide-react';

export type SecurityAuditItem = {
  id: string;
  action: string;
  timestamp: string | Date;
  actorEmail?: string | null;
  actorName?: string | null;
  details?: Record<string, unknown> | null;
};

type Props = {
  events: SecurityAuditItem[];
  userEmail: string | null;
};

export default function SecurityRecentActivity({ events, userEmail }: Props) {
  const getActionConfig = (action: string) => {
    switch (action) {
      case 'user.password.updated':
      case 'password.changed':
        return {
          label: 'Password Changed',
          variant: 'default' as const,
          icon: <KeyRound className="h-3.5 w-3.5" />,
          description: 'Account credentials successfully updated',
        };
      case 'session.revoked_all':
      case 'session.revoked':
        return {
          label: 'Sessions Revoked',
          variant: 'destructive' as const,
          icon: <LogOut className="h-3.5 w-3.5" />,
          description: 'All active sessions were terminated',
        };
      case 'auth.login':
      case 'user.login':
        return {
          label: 'Sign In',
          variant: 'secondary' as const,
          icon: <Shield className="h-3.5 w-3.5" />,
          description: 'Authenticated into workspace',
        };
      default:
        return {
          label: action.replace(/\./g, ' '),
          variant: 'outline' as const,
          icon: <Shield className="h-3.5 w-3.5" />,
          description: 'Security parameter modified',
        };
    }
  };

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm space-y-1">
        <Shield className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="font-medium text-foreground">No recent security alerts</p>
        <p className="text-xs">
          Your account has no recorded anomalous or credential security events.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
        {events.map(event => {
          const config = getActionConfig(event.action);
          const date = new Date(event.timestamp);

          return (
            <div
              key={event.id}
              className="flex items-center justify-between p-3.5 hover:bg-muted/40 transition-colors gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted border border-border text-foreground shrink-0">
                  {config.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-foreground">{config.label}</span>
                    <Badge
                      variant={config.variant}
                      className="text-[10px] uppercase font-semibold px-1.5 py-0"
                    >
                      {event.action.split('.')[0]}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{config.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 font-mono">
                <Clock className="h-3 w-3 text-muted-foreground/70" />
                <span>
                  {date.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted-foreground">
          Showing latest security events for {userEmail || 'your account'}
        </p>
        <Button variant="ghost" size="sm" asChild className="gap-1 text-xs h-8">
          <Link href="/audit">
            View Complete Audit Log
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

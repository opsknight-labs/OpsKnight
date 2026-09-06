'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Hash, Lock, CheckCircle, Plus, Loader2, Send, Power, AlertCircle } from 'lucide-react';

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

interface SlackChannelCardProps {
  channel: SlackChannel;
  onJoin: () => void;
  onLeave: () => void;
  onTest: () => void;
  isJoining: boolean;
  isLeaving: boolean;
  isTesting: boolean;
  testResult?: { success: boolean; message: string } | null;
}

export function SlackChannelCard({
  channel,
  onJoin,
  onLeave,
  onTest,
  isJoining,
  isLeaving,
  isTesting,
  testResult,
}: SlackChannelCardProps) {
  const isConnected = channel.isMember;
  const isPrivate = channel.isPrivate;
  const canAutoJoin = !isConnected && !isPrivate;

  return (
    <div
      className={cn(
        'group relative flex items-center justify-between gap-4 px-4 py-3 rounded-lg border transition-all duration-200',
        'hover:shadow-sm',
        isConnected && 'border-l-4 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20',
        !isConnected &&
          isPrivate &&
          'border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20',
        canAutoJoin && 'border-l-4 border-l-slate-300 hover:border-l-primary'
      )}
    >
      {/* Channel Info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {isPrivate ? <Lock className="h-4 w-4 text-amber-600" /> : <Hash className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate" title={channel.name}>
            {channel.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {isPrivate ? 'Private channel' : 'Public channel'}
          </p>
        </div>
      </div>

      {/* Status & Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {isConnected ? (
          <>
            <Badge variant="success" size="xs" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              Connected
            </Badge>

            {/* Test Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onTest}
              disabled={isTesting}
              className="h-8 px-2 text-xs"
              title="Send test notification"
            >
              {isTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : testResult ? (
                testResult.success ? (
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                )
              ) : (
                <>
                  <Send className="h-3.5 w-3.5 mr-1" />
                  Test
                </>
              )}
            </Button>

            {/* Disconnect Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onLeave}
              disabled={isLeaving || isTesting}
              className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Disconnect bot from channel"
            >
              {isLeaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
            </Button>
          </>
        ) : isPrivate ? (
          <Badge
            variant="outline"
            className="border-amber-500 text-amber-700 dark:text-amber-400 gap-1"
          >
            <Lock className="h-3 w-3" />
            Invite Required
          </Badge>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onJoin}
            disabled={isJoining}
            className="h-8 gap-1.5"
          >
            {isJoining ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Joining...
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Connect
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export default SlackChannelCard;

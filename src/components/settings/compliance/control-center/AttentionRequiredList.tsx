'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import type {
  AttentionRequiredItem,
  AttentionRequiredSeverity,
  AttentionRequiredType,
} from '@/lib/compliance/control-center/types';
import { cn } from '@/lib/utils';

interface AttentionRequiredListProps {
  readonly items: readonly AttentionRequiredItem[];
  readonly onSelectControl: (controlId: string) => void;
  readonly onEvaluate?: () => void;
  readonly onNavigateToTab?: (tab: string) => void;
}

const severityBadgeConfig: Record<AttentionRequiredSeverity, { label: string; className: string }> =
  {
    HIGH: {
      label: 'High Severity',
      className:
        'border-status-critical-border/25 bg-status-critical-soft dark:border-status-critical/35 dark:bg-status-critical/15 text-status-critical-deep dark:text-rose-300 font-semibold',
    },
    MEDIUM: {
      label: 'Medium Severity',
      className:
        'border-status-elevated-border/30 bg-status-elevated-soft dark:border-status-elevated/35 dark:bg-status-elevated/15 text-status-elevated-deep dark:text-amber-300 font-medium',
    },
    LOW: {
      label: 'Low Severity',
      className: 'border-border bg-muted text-ink-600 font-normal',
    },
  };

const typeIconMap: Record<AttentionRequiredType, typeof AlertCircle> = {
  ACTION_REQUIRED: AlertCircle,
  INTEGRITY_MISMATCH: ShieldAlert,
  UNVERIFIED: HelpCircle,
  STALE_EVALUATION: AlertTriangle,
};

export function AttentionRequiredList({
  items,
  onSelectControl,
  onEvaluate,
  onNavigateToTab,
}: AttentionRequiredListProps) {
  if (items.length === 0) {
    return (
      <Card className="border-status-ok-border/30 bg-status-ok-soft dark:border-status-ok/35 dark:bg-status-ok/15">
        <CardContent className="p-6 flex items-center gap-3 text-status-ok-deep dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold">No Attention Items Outstanding</h4>
            <p className="text-xs text-muted-foreground">
              All runtime controls are verified, up-to-date, and backed by cryptographically valid
              evidence.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span>Attention Required</span>
            <Badge variant="secondary" className="text-xs font-mono">
              {items.length}
            </Badge>
          </h3>
          <p className="text-xs text-muted-foreground">
            Runtime controls requiring immediate operator remediation or cryptographic verification.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        {items.map(item => {
          const Icon = typeIconMap[item.type] ?? AlertCircle;
          const sevConfig = severityBadgeConfig[item.severity];

          const handleAction = () => {
            if (item.actionType === 'EVALUATE' && onEvaluate) {
              onEvaluate();
            } else if (item.actionType === 'VIEW_EVIDENCE' && onNavigateToTab) {
              onNavigateToTab('evidence');
            } else if (item.actionType === 'VIEW_OPERATIONS' && onNavigateToTab) {
              onNavigateToTab('operations');
            } else {
              onSelectControl(item.controlId);
            }
          };

          return (
            <div
              key={item.id}
              className="p-3.5 rounded-lg border border-border/80 bg-card hover:bg-muted/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-1.5 rounded bg-muted shrink-0 mt-0.5">
                  <Icon className="h-4 w-4 text-status-elevated-deep dark:text-amber-300" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {item.controlId}
                    </span>
                    <span className="text-xs font-medium text-foreground truncate">
                      {item.controlTitle}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn('text-2xs py-0 px-1.5', sevConfig.className)}
                    >
                      {sevConfig.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.reason}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSelectControl(item.controlId)}
                  className="text-xs h-8"
                >
                  View Control
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleAction}
                  className="text-xs h-8 gap-1"
                >
                  <span>{item.actionLabel}</span>
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

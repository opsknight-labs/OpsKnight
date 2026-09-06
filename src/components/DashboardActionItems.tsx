'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ListChecks,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashboardActionItemsProps {
  stats: {
    total: number;
    open: number;
    inProgress: number;
    completed: number;
    overdue: number;
    highPriority: number;
  };
  recentItems?: Array<{
    id: string;
    title: string;
    status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    dueDate?: string;
    owner?: string;
    incidentId: string;
  }>;
}

export default function DashboardActionItems({
  stats,
  recentItems = [],
}: DashboardActionItemsProps) {
  const completionRate = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0;

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'OPEN':
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          text: 'text-blue-700',
          dot: 'bg-blue-500',
        };
      case 'IN_PROGRESS':
        return {
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          text: 'text-amber-700',
          dot: 'bg-amber-500',
        };
      case 'COMPLETED':
        return {
          bg: 'bg-green-50',
          border: 'border-green-200',
          text: 'text-green-700',
          dot: 'bg-green-500',
        };
      case 'BLOCKED':
        return {
          bg: 'bg-red-50',
          border: 'border-red-200',
          text: 'text-red-700',
          dot: 'bg-red-500',
        };
      default:
        return {
          bg: 'bg-neutral-50',
          border: 'border-neutral-200',
          text: 'text-neutral-700',
          dot: 'bg-neutral-500',
        };
    }
  };

  const getPriorityVariant = (priority: string) => {
    switch (priority) {
      case 'HIGH':
        return 'danger';
      case 'MEDIUM':
        return 'warning';
      case 'LOW':
        return 'neutral';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="p-5 bg-gradient-to-br from-white to-neutral-50/50 border border-border rounded-lg shadow-lg">
      {/* Header */}
      <div className="flex justify-between items-start mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ListChecks className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-bold text-foreground">Action Items</h3>
          </div>
          <p className="text-sm text-muted-foreground">Track postmortem follow-ups</p>
        </div>
        <Link href="/action-items">
          <Badge variant="default" size="sm">
            {stats.total} Total
          </Badge>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Link href="/action-items?status=OPEN" className="no-underline">
          <div className="p-4 bg-white border-2 border-blue-200 rounded-lg text-center transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            <div className="flex items-center justify-center gap-2 mb-1">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <div className="text-2xl font-bold text-blue-600">{stats.open}</div>
            </div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Open
            </div>
          </div>
        </Link>
        <Link href="/action-items?status=IN_PROGRESS" className="no-underline">
          <div className="p-4 bg-white border-2 border-amber-200 rounded-lg text-center transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-amber-600" />
              <div className="text-2xl font-bold text-amber-600">{stats.inProgress}</div>
            </div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              In Progress
            </div>
          </div>
        </Link>
        <Link href="/action-items?status=COMPLETED" className="no-underline">
          <div className="p-4 bg-white border-2 border-green-200 rounded-lg text-center transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            <div className="flex items-center justify-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            </div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Completed
            </div>
          </div>
        </Link>
        <Link href="/action-items?status=OPEN" className="no-underline">
          <div
            className={cn(
              'p-4 border-2 rounded-lg text-center transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
              stats.overdue > 0 ? 'bg-red-50 border-red-300' : 'bg-white border-neutral-200'
            )}
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <div
                className={cn(
                  'text-2xl font-bold',
                  stats.overdue > 0 ? 'text-red-600' : 'text-neutral-500'
                )}
              >
                {stats.overdue}
              </div>
            </div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Overdue
            </div>
          </div>
        </Link>
      </div>

      {/* Progress Bar */}
      <div className="mb-5 p-4 bg-white rounded-lg border border-border">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-semibold text-foreground">Completion Rate</span>
          <Badge variant="outline" size="xs">
            {completionRate.toFixed(0)}%
          </Badge>
        </div>
        <div className="w-full h-3 bg-neutral-200 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-300 ease-out rounded-full',
              completionRate === 100 ? 'bg-green-500' : 'bg-blue-500'
            )}
            style={{ width: `${completionRate}%` }}
          />
        </div>
      </div>

      {/* Recent Items */}
      {recentItems.length > 0 && (
        <div className="mb-5">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-bold text-foreground">Recent Items</h4>
            <Link
              href="/action-items"
              className="text-xs text-primary font-semibold hover:underline"
            >
              View All <ArrowRight className="inline h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {recentItems.slice(0, 5).map(item => {
              const isOverdue =
                item.dueDate && new Date(item.dueDate) < new Date() && item.status !== 'COMPLETED';
              const config = getStatusConfig(item.status);
              return (
                <Link
                  key={item.id}
                  href={`/postmortems/${item.incidentId}`}
                  className={cn(
                    'flex items-center justify-between p-3 bg-white rounded-lg border-2 transition-all duration-200',
                    'hover:shadow-md hover:translate-x-1 no-underline',
                    config.border
                  )}
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="text-sm font-semibold text-foreground mb-1 truncate">
                      {item.title}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={getPriorityVariant(item.priority)}
                        size="xs"
                        className="font-bold"
                      >
                        {item.priority}
                      </Badge>
                      {isOverdue && (
                        <Badge variant="danger" size="xs">
                          Overdue
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className={cn('w-3 h-3 rounded-full shrink-0', config.dot)} />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="pt-5 border-t border-border">
        <Button asChild className="w-full font-semibold shadow-md hover:shadow-lg transition-all">
          <Link href="/action-items">
            View All Action Items <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import {
  Compass,
  Server,
  ShieldAlert,
  BarChart2,
  Users,
  Video,
  ArrowUpRight,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type IncidentQuickLinksCardProps = {
  incidentId: string;
  service: {
    id: string;
    name: string;
    status: string;
    slaTier?: string | null;
    policy?: {
      id: string;
      name: string;
    } | null;
  };
  team?: {
    id: string;
    name: string;
  } | null;
  warRoomUrl?: string | null;
  slackChannelName?: string | null;
  className?: string;
};

export default function IncidentQuickLinksCard({
  incidentId,
  service,
  team,
  warRoomUrl,
  className,
}: IncidentQuickLinksCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden dark:bg-slate-900 dark:border-slate-800 transition-all',
        className
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            <Compass className="h-4 w-4 shrink-0" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 whitespace-nowrap">
            Quick Links
          </h3>
        </div>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
          Resources
        </span>
      </div>

      {/* Links List */}
      <div className="p-3 space-y-2">
        {/* Service Catalog */}
        <Link
          href={`/services/${service.id}`}
          className="group flex items-center justify-between p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-800/20 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 hover:border-slate-200 dark:hover:border-slate-700 transition-all text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Server className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-primary transition-colors">
                {service.name}
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                Service Catalog · {service.slaTier || 'Standard Tier'}
              </p>
            </div>
          </div>
          <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0 ml-2" />
        </Link>

        {/* Escalation Policy */}
        {service.policy && (
          <Link
            href="/policies"
            className="group flex items-center justify-between p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-800/20 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 hover:border-slate-200 dark:hover:border-slate-700 transition-all text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <ShieldAlert className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-primary transition-colors">
                  {service.policy.name}
                </p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                  Escalation Policy &amp; Rotations
                </p>
              </div>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0 ml-2" />
          </Link>
        )}

        {/* Analytics */}
        <Link
          href={`/analytics?incident=${incidentId}`}
          className="group flex items-center justify-between p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-800/20 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 hover:border-slate-200 dark:hover:border-slate-700 transition-all text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <BarChart2 className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-primary transition-colors">
                Incident Analytics
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                MTTR &amp; Frequency Metrics
              </p>
            </div>
          </div>
          <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0 ml-2" />
        </Link>

        {/* Assigned Team */}
        {team && (
          <Link
            href={`/teams/${team.id}`}
            className="group flex items-center justify-between p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-800/20 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 hover:border-slate-200 dark:hover:border-slate-700 transition-all text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Users className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-primary transition-colors">
                  {team.name}
                </p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                  Team Members &amp; Schedule
                </p>
              </div>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0 ml-2" />
          </Link>
        )}

        {/* War Room Live Link */}
        {warRoomUrl && (
          <a
            href={warRoomUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between p-2.5 rounded-lg border border-rose-200/80 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/20 hover:bg-rose-50/80 dark:hover:bg-rose-950/40 transition-all text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-md bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <Video className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-rose-900 dark:text-rose-200 truncate">
                  Join War Room
                </p>
                <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80 truncate">
                  Live Video Conference Bridge
                </p>
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-rose-500 opacity-75 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0 ml-2" />
          </a>
        )}
      </div>
    </div>
  );
}

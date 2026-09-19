'use client';

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { ExternalLink, Shield, Clock, Cpu, ChevronRight } from 'lucide-react';
import type { ComplianceFramework } from '@/lib/compliance/types';
import { FrameworkRequirementsModal } from '../FrameworkRequirementsModal';

export interface FrameworkCardItem {
  readonly id: ComplianceFramework;
  readonly title: string;
  readonly scope: string;
  readonly source: string;
  readonly version?: string;
  readonly summaryView?: {
    readonly mappedRequirementsCount: number;
    readonly mappedControlsCount: number;
    readonly runtimeBackedCount: number;
    readonly repositoryBackedCount: number;
    readonly operatorDependencyCount: number;
    readonly organizationalDependencyCount: number;
    readonly futureRequirementsCount: number;
  };
}

interface FrameworksViewProps {
  readonly frameworks: readonly FrameworkCardItem[];
  readonly initialSelectedFramework?: ComplianceFramework | null;
}

export function FrameworksView({
  frameworks,
  initialSelectedFramework = null,
}: FrameworksViewProps) {
  const [selectedFramework, setSelectedFramework] = useState<ComplianceFramework | null>(
    initialSelectedFramework
  );

  return (
    <div className="space-y-6">
      {/* Scope Disclaimer */}
      <div className="p-4 rounded-xl border border-border/80 bg-muted/20 flex items-start gap-3 text-xs text-muted-foreground">
        <Shield className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-foreground">Versioned Framework Mapping Engine</p>
          <p className="leading-relaxed">
            OpsKnight maps technical operational and repository controls to published framework
            requirements. Mapping a control to a requirement means OpsKnight collects relevant
            supporting runtime or codebase evidence. It does not certify compliance, nor does it
            replace legal advice or third-party audits.
          </p>
        </div>
      </div>

      {/* Framework Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {frameworks.map(fw => {
          const summary = fw.summaryView;

          return (
            <Card
              key={fw.id}
              className="border-border/80 bg-card hover:border-primary/40 transition-all cursor-pointer flex flex-col justify-between group"
              onClick={() => setSelectedFramework(fw.id)}
            >
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
                        {fw.title}
                      </CardTitle>
                      {fw.version && (
                        <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5">
                          {fw.version}
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-xs line-clamp-2">{fw.scope}</CardDescription>
                  </div>

                  <a
                    href={fw.source}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
                    title="Official Specification"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-4">
                {summary ? (
                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between p-2 rounded bg-muted/30">
                      <span className="text-muted-foreground">Mapped Reqs:</span>
                      <span className="font-mono font-bold text-foreground">
                        {summary.mappedRequirementsCount}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded bg-muted/30">
                      <span className="text-muted-foreground">Backed Controls:</span>
                      <span className="font-mono font-bold text-foreground">
                        {summary.mappedControlsCount}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded bg-muted/30">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Cpu className="h-3 w-3 text-sky-500" />
                        Runtime:
                      </span>
                      <span className="font-mono font-bold text-sky-700 dark:text-sky-400">
                        {summary.runtimeBackedCount}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded bg-muted/30">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3 text-indigo-500" />
                        Future:
                      </span>
                      <span className="font-mono font-bold text-indigo-700 dark:text-indigo-400">
                        {summary.futureRequirementsCount}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic py-2">
                    Standard framework definition.
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs gap-1.5 justify-between group-hover:border-primary/50"
                >
                  <span>Explore Requirement Mappings</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Requirement Modal / Drawer */}
      <FrameworkRequirementsModal
        frameworkId={selectedFramework}
        isOpen={Boolean(selectedFramework)}
        onClose={() => setSelectedFramework(null)}
      />
    </div>
  );
}

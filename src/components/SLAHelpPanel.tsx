'use client';

import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import {
  HelpCircle,
  Shield,
  Clock,
  Activity,
  Target,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  Zap,
} from 'lucide-react';

export default function SLAHelpPanel() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-slate-500 hover:text-indigo-600"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          What are SLAs?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
              <Shield className="h-4 w-4" />
            </div>
            Understanding SLA Definitions
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Service Level Agreements define performance targets for your services
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basics" className="mt-4">
          <TabsList className="grid w-full grid-cols-4 h-9">
            <TabsTrigger value="basics" className="text-xs">
              Basics
            </TabsTrigger>
            <TabsTrigger value="metrics" className="text-xs">
              Metric Types
            </TabsTrigger>
            <TabsTrigger value="windows" className="text-xs">
              Time Windows
            </TabsTrigger>
            <TabsTrigger value="tips" className="text-xs">
              Best Practices
            </TabsTrigger>
          </TabsList>

          {/* Basics Tab */}
          <TabsContent value="basics" className="space-y-4 pt-4">
            <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
              <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                <Target className="h-4 w-4 text-indigo-500" />
                What is an SLA?
              </h4>
              <p className="text-sm text-slate-600">
                A <strong>Service Level Agreement (SLA)</strong> is a commitment to maintain a
                specific level of service quality. SLAs define measurable targets that your team
                must meet.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-100 bg-white p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium text-slate-800">Target</span>
                </div>
                <p className="text-xs text-slate-500">
                  The percentage or value you commit to achieving (e.g., 99.9% uptime)
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium text-slate-800">Window</span>
                </div>
                <p className="text-xs text-slate-500">
                  The time period over which compliance is measured (e.g., 30 days)
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-violet-500" />
                  <span className="text-sm font-medium text-slate-800">Metric</span>
                </div>
                <p className="text-xs text-slate-500">
                  What you're measuring: uptime, response time, resolution time, etc.
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-slate-800">Breach</span>
                </div>
                <p className="text-xs text-slate-500">
                  When current performance falls below the target threshold
                </p>
              </div>
            </div>
          </TabsContent>

          {/* Metrics Tab */}
          <TabsContent value="metrics" className="space-y-4 pt-4">
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Uptime / Availability</p>
                    <p className="text-xs text-emerald-700 mt-1">
                      Percentage of time the service is operational. Calculated from incident
                      duration.
                      <br />
                      <span className="font-mono text-[10px] bg-emerald-100 px-1 rounded mt-1 inline-block">
                        (Total Time - Downtime) / Total Time × 100
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                <div className="flex items-start gap-3">
                  <Activity className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      MTTA (Mean Time to Acknowledge)
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      Average time to first acknowledge an incident. Lower is better.
                      <br />
                      <span className="font-mono text-[10px] bg-amber-100 px-1 rounded mt-1 inline-block">
                        Target: Maximum minutes allowed before breach
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                <div className="flex items-start gap-3">
                  <Activity className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      MTTR (Mean Time to Resolve)
                    </p>
                    <p className="text-xs text-amber-700 mt-1">
                      Average time to fully resolve an incident. Lower is better.
                      <br />
                      <span className="font-mono text-[10px] bg-amber-100 px-1 rounded mt-1 inline-block">
                        Target: Maximum minutes allowed before breach
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                <div className="flex items-start gap-3">
                  <Zap className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-blue-800">Latency P99</p>
                    <p className="text-xs text-blue-700 mt-1">
                      99th percentile response time. 99% of requests complete within this time.
                      <br />
                      <span className="font-mono text-[10px] bg-blue-100 px-1 rounded mt-1 inline-block">
                        Target: Maximum milliseconds allowed
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Windows Tab */}
          <TabsContent value="windows" className="space-y-4 pt-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h4 className="font-semibold text-slate-800 mb-3">Time Window Options</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-sm font-medium text-slate-700">7 Days</span>
                  <span className="text-xs text-slate-500">Short-term operational view</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-sm font-medium text-slate-700">30 Days</span>
                  <span className="text-xs text-slate-500">Most common, monthly reporting</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-sm font-medium text-slate-700">90 Days</span>
                  <span className="text-xs text-slate-500">Quarterly business review</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-sm font-medium text-slate-700">Quarterly</span>
                  <span className="text-xs text-slate-500">Aligned to calendar quarters</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-slate-700">Yearly</span>
                  <span className="text-xs text-slate-500">Long-term reliability trends</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
              <div className="flex items-start gap-2">
                <Clock className="h-4 w-4 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-blue-800">Rolling Windows</p>
                  <p className="text-xs text-blue-700 mt-1">
                    All windows are rolling (e.g., "last 30 days"), not calendar-fixed. This ensures
                    continuous monitoring without monthly resets.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Best Practices Tab */}
          <TabsContent value="tips" className="space-y-4 pt-4">
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">
                      Start with achievable targets
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Set targets based on historical performance, then improve incrementally.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Define SLAs per service</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Critical services (payments) need stricter SLAs than internal tools.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">
                      Monitor trends, not just breaches
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      A declining trend indicates problems before a breach occurs.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Use multiple metrics</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Combine uptime with MTTA/MTTR for a complete reliability picture.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-amber-100 bg-amber-50/30 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Avoid These Mistakes</p>
                  <ul className="text-xs text-amber-700 mt-1 space-y-1 list-disc list-inside">
                    <li>Setting unrealistic targets (100% is impossible)</li>
                    <li>Using only one metric (uptime doesn't capture response quality)</li>
                    <li>Ignoring near-miss events that almost breached</li>
                    <li>Setting and forgetting - review SLAs quarterly</li>
                  </ul>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

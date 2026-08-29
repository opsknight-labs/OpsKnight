import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { createSchedule } from './actions';
import ScheduleDirectoryList from '@/components/schedules/ScheduleDirectoryList';
import ScheduleCreateForm from '@/components/ScheduleCreateForm';
import { Calendar, Plus, Layers3, Users, CheckCircle2, Sparkles } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';

export default async function SchedulesPage() {
  const schedules = await prisma.onCallSchedule.findMany({
    include: {
      layers: {
        include: {
          users: {
            select: {
              userId: true,
              user: {
                select: {
                  name: true,
                  avatarUrl: true,
                  gender: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const totalLayers = schedules.reduce((sum, schedule) => sum + schedule.layers.length, 0);
  const totalUniqueResponders = new Set(
    schedules.flatMap(s => s.layers.flatMap(l => l.users.map(u => u.userId)))
  ).size;
  const hasConfiguredResponders = schedules.some(schedule =>
    schedule.layers.some(layer => layer.users.length > 0)
  );

  const permissions = await getUserPermissions();
  const canManageSchedules = permissions.isAdminOrResponder;

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      {/* Header with Glassmorphic Stats Capsule matching Schedule Detail Page */}
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-r from-primary to-primary/80 p-4 text-primary-foreground shadow-lg md:p-6">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-primary-foreground/[0.08] blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
              <Calendar className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/75">
                On-call schedules
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-primary-foreground md:text-3xl">
                Schedules
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-primary-foreground/85">
                Design rotations, monitor coverage, and keep responders aligned across all services.
              </p>
            </div>
          </div>

          {/* Glassmorphic Stats Capsule */}
          <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 p-1.5 backdrop-blur-sm lg:min-w-[330px]">
            <div className="min-w-0 rounded-md px-3 py-2 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                Responders
              </p>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground">
                <Users className="h-3.5 w-3.5" /> {totalUniqueResponders}
              </p>
            </div>
            <div className="min-w-0 rounded-md border-x border-primary-foreground/20 px-3 py-2 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                Layers
              </p>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground">
                <Layers3 className="h-3.5 w-3.5" /> {totalLayers}
              </p>
            </div>
            <div className="min-w-0 rounded-md px-3 py-2 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                Status
              </p>
              <p
                className={`mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground ${
                  hasConfiguredResponders ? 'text-emerald-100' : 'text-amber-100'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {hasConfiguredResponders ? 'Configured' : 'Needs setup'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        {/* Schedules List with Live Search & Filters */}
        <div className="xl:col-span-3 space-y-4">
          {schedules.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Calendar className="h-16 w-16 text-muted-foreground mb-4" />
                <CardTitle className="text-xl mb-2">No schedules yet</CardTitle>
                <CardDescription className="mb-6 max-w-md">
                  Create a schedule to start building your on-call coverage
                </CardDescription>
                {canManageSchedules && (
                  <Button asChild>
                    <a href="#new-schedule" className="gap-2">
                      <Plus className="h-4 w-4" />
                      Create Your First Schedule
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <ScheduleDirectoryList schedules={schedules} canManageSchedules={canManageSchedules} />
          )}
        </div>

        {/* Sidebar: New Schedule Form & Step Guide */}
        <aside className="space-y-4">
          <ScheduleCreateForm action={createSchedule} canCreate={canManageSchedules} />

          {/* Clean Guidance Card */}
          <Card className="overflow-hidden border-border/70 shadow-xs">
            <CardHeader className="border-b bg-muted/20 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <Sparkles className="h-3 w-3" />
                </div>
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Schedule Lifecycle
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  1
                </span>
                <div>
                  <p className="font-semibold text-foreground">Rotation Layers</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Configure shift lengths (12h, 24h, weekly) and rotation start times.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  2
                </span>
                <div>
                  <p className="font-semibold text-foreground">Assign Responders</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Add team members in rotation sequence with easy reordering.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  3
                </span>
                <div>
                  <p className="font-semibold text-foreground">Coverage Overrides</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Schedule temporary shift replacements or extra coverage anytime.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

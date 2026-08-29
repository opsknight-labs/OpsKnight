'use client';

// This component acts as the "Right Sidebar" action panel
// It houses the Shadcn Sheet triggers for Layers and Overrides

import LayerCreateForm from './LayerCreateForm';
import OverrideForm from './OverrideForm';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Plus } from 'lucide-react';

type ScheduleActionsPanelProps = {
  scheduleId: string;
  users: Array<{ id: string; name: string }>;
  canManageSchedules: boolean;
  createLayer: (scheduleId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  createOverride: (
    scheduleId: string,
    formData: FormData
  ) => Promise<{ error?: string } | undefined>;
  defaultStartDate: string;
  scheduleTimeZone: string;
};

export default function ScheduleActionsPanel({
  scheduleId,
  users,
  canManageSchedules,
  createLayer,
  createOverride,
  defaultStartDate,
  scheduleTimeZone,
}: ScheduleActionsPanelProps) {
  if (!canManageSchedules) return null;

  return (
    <Card className="overflow-hidden border-slate-200/80">
      <CardHeader className="p-4 pb-3 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plus className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
            <CardDescription className="text-xs">Add rotations or overrides</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        <LayerCreateForm
          scheduleId={scheduleId}
          canManageSchedules={canManageSchedules}
          createLayer={createLayer}
          defaultStartDate={defaultStartDate}
          timeZone={scheduleTimeZone}
          users={users}
        />

        <OverrideForm
          scheduleId={scheduleId}
          users={users}
          canCreateOverride={canManageSchedules}
          createOverride={createOverride}
          scheduleTimeZone={scheduleTimeZone}
        />
      </CardContent>
    </Card>
  );
}

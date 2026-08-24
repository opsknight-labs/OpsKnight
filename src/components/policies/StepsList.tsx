'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import SortableEscalationStepItem from '@/components/policies/SortableEscalationStepItem';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-product-notification';
import PolicyStepCreateForm from '@/components/PolicyStepCreateForm';

type EscalationStep = {
  id: string;
  stepOrder: number;
  delayMinutes: number;
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  targetUser: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  targetTeam: {
    id: string;
    name: string;
    teamLead?: { id: string; name: string; email: string } | null;
  } | null;
  targetSchedule: { id: string; name: string } | null;
  notifyOnlyTeamLead: boolean;
};

type StepsListProps = {
  initialSteps: EscalationStep[];
  policyId: string;
  canManage: boolean;
  updateStep: (stepId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  deleteStep: (stepId: string) => Promise<{ error?: string } | undefined>;
  moveStep: (stepId: string, direction: 'up' | 'down') => Promise<{ error?: string } | undefined>;
  reorderSteps: (policyId: string, newOrder: string[]) => Promise<{ error?: string } | undefined>;
  addStep: (policyId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  users: any[];
  teams: any[];
  schedules: any[];
};

export default function StepsList({
  initialSteps,
  policyId,
  canManage,
  updateStep,
  deleteStep,
  moveStep,
  reorderSteps,
  addStep,
  users,
  teams,
  schedules,
}: StepsListProps) {
  const [steps, setSteps] = useState(initialSteps);
  const { showToast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setSteps(initialSteps);
  }, [initialSteps]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setSteps(items => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over?.id);

        // 1. Capture original delays in order
        const delays = items.map(item => item.delayMinutes);

        // 2. Reorder the items (targets move)
        const newItems = arrayMove(items, oldIndex, newIndex);

        // 3. Re-assign delays based on the *position*
        // This ensures Step 1 always keeps Step 1's delay (usually 0), etc.
        const itemsWithFixedDelays = newItems.map((item, index) => ({
          ...item,
          delayMinutes: delays[index],
        }));

        // Trigger server update
        startTransition(async () => {
          const newOrderIds = itemsWithFixedDelays.map(s => s.id);
          const result = await reorderSteps(policyId, newOrderIds);
          if (result?.error) {
            showToast(result.error, 'error');
            router.refresh(); // Sync back on error
          }
        });

        return itemsWithFixedDelays;
      });
    }
  }

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-slate-500" />
          Escalation Steps
        </CardTitle>
        <CardDescription>
          Defines the order of notifications when an incident is triggered.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 pt-8 space-y-0">
        {steps.length === 0 ? (
          <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <p className="text-slate-500 font-medium">No steps defined yet.</p>
            <p className="text-sm text-slate-400">Add a step below to start.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={steps} strategy={verticalListSortingStrategy}>
              <div className="pb-8 space-y-4">
                {steps.map((step, index) => (
                  <SortableEscalationStepItem
                    key={step.id}
                    step={{
                      ...step,
                      // Re-mapping stepOrder based on current index for display correctness during drag
                      stepOrder: index,
                      targetTeam: step.targetTeam
                        ? {
                            ...step.targetTeam,
                            teamLead: (step.targetTeam as any).teamLead,
                          }
                        : null,
                    }}
                    policyId={policyId}
                    canManage={canManage}
                    updateStep={updateStep}
                    deleteStep={deleteStep}
                    moveStep={moveStep}
                    isFirst={index === 0}
                    isLast={index === steps.length - 1}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {canManage && (
          <div className="pt-6 border-t border-slate-100">
            <h3 className="font-semibold text-sm mb-4">Add New Step</h3>
            <PolicyStepCreateForm
              policyId={policyId}
              users={users}
              teams={teams}
              schedules={schedules}
              addStep={addStep}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

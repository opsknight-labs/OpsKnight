'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import EscalationStepItem from './EscalationStepItem';
import { GripVertical } from 'lucide-react';

type EscalationStep = {
  id: string;
  stepOrder: number;
  delayMinutes: number;
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  targetUserId?: string | null;
  targetTeamId?: string | null;
  targetScheduleId?: string | null;
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

type SortableEscalationStepItemProps = {
  step: EscalationStep;
  policyId: string;
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  updateStep: (stepId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  deleteStep: (stepId: string) => Promise<{ error?: string } | undefined>;
  moveStep: (stepId: string, direction: 'up' | 'down') => Promise<{ error?: string } | undefined>;
  users?: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
  teams?: Array<{ id: string; name: string }>;
  schedules?: Array<{ id: string; name: string }>;
};

export default function SortableEscalationStepItem(props: SortableEscalationStepItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.step.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 20 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group/sortable relative pl-8">
      {/* Drag Handle */}
      {props.canManage && (
        <div
          {...attributes}
          {...listeners}
          className="absolute left-0 top-1/2 -translate-y-1/2 p-2 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors opacity-0 group-hover/sortable:opacity-100"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      <EscalationStepItem {...props} />
    </div>
  );
}

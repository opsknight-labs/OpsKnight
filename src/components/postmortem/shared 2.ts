import { Search, Megaphone, Wrench, CheckCircle2 } from 'lucide-react';

export const POSTMORTEM_STATUS_CONFIG = {
  DRAFT: { label: 'Draft', variant: 'warning' as const },
  PUBLISHED: { label: 'Published', variant: 'success' as const },
  ARCHIVED: { label: 'Archived', variant: 'neutral' as const },
};

export const ACTION_ITEM_STATUS_CONFIG = {
  OPEN: {
    color: 'text-blue-500',
    bg: 'bg-blue-500/20',
    border: 'border-blue-500/40',
    label: 'Open',
    variant: 'info' as const,
  },
  IN_PROGRESS: {
    color: 'text-amber-500',
    bg: 'bg-amber-500/20',
    border: 'border-amber-500/40',
    label: 'In Progress',
    variant: 'warning' as const,
  },
  COMPLETED: {
    color: 'text-green-500',
    bg: 'bg-green-500/20',
    border: 'border-green-500/40',
    label: 'Completed',
    variant: 'success' as const,
  },
  BLOCKED: {
    color: 'text-red-500',
    bg: 'bg-red-500/20',
    border: 'border-red-500/40',
    label: 'Blocked',
    variant: 'danger' as const,
  },
};

export const ACTION_ITEM_PRIORITY_CONFIG = {
  HIGH: { color: 'text-red-500', bg: 'bg-red-500/20', label: 'High' },
  MEDIUM: { color: 'text-amber-500', bg: 'bg-amber-500/20', label: 'Medium' },
  LOW: { color: 'text-gray-500', bg: 'bg-gray-500/20', label: 'Low' },
};

export const TIMELINE_EVENT_TYPE_CONFIG = {
  DETECTION: {
    color: 'text-blue-500',
    bg: 'bg-blue-500/20',
    solidBg: 'bg-blue-500',
    border: 'border-blue-500/40',
    borderLeft: 'border-l-blue-500',
    label: 'Detection',
    Icon: Search,
  },
  ESCALATION: {
    color: 'text-amber-500',
    bg: 'bg-amber-500/20',
    solidBg: 'bg-amber-500',
    border: 'border-amber-500/40',
    borderLeft: 'border-l-amber-500',
    label: 'Escalation',
    Icon: Megaphone,
  },
  MITIGATION: {
    color: 'text-purple-500',
    bg: 'bg-purple-500/20',
    solidBg: 'bg-purple-500',
    border: 'border-purple-500/40',
    borderLeft: 'border-l-purple-500',
    label: 'Mitigation',
    Icon: Wrench,
  },
  RESOLUTION: {
    color: 'text-green-500',
    bg: 'bg-green-500/20',
    solidBg: 'bg-green-500',
    border: 'border-green-500/40',
    borderLeft: 'border-l-green-500',
    label: 'Resolution',
    Icon: CheckCircle2,
  },
};

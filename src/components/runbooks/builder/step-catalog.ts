import {
  Box,
  CheckSquare,
  Container,
  GitBranch,
  Globe,
  Hand,
  Hourglass,
  Server,
  Stethoscope,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { RunbookRiskClass, RunbookStepType } from '@/lib/runbooks/types';
import type { Tone } from '../ui/primitives';

export type StepCatalogEntry = {
  type: RunbookStepType;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const STEP_CATALOG: Record<RunbookStepType, StepCatalogEntry> = {
  MANUAL: {
    type: 'MANUAL',
    label: 'Manual task',
    description: 'A responder follows written instructions, then marks it done.',
    icon: Hand,
  },
  APPROVAL: {
    type: 'APPROVAL',
    label: 'Approval',
    description: 'Pause until an authorised responder approves.',
    icon: CheckSquare,
  },
  WAIT: {
    type: 'WAIT',
    label: 'Wait',
    description: 'Pause for a fixed time, e.g. to let a service warm up.',
    icon: Hourglass,
  },
  CONDITION: {
    type: 'CONDITION',
    label: 'Condition',
    description: 'Continue only when incident or input values match.',
    icon: GitBranch,
  },
  LINUX_DIAGNOSTICS: {
    type: 'LINUX_DIAGNOSTICS',
    label: 'Linux diagnostics',
    description: 'Read-only disk, memory, CPU and network checks on a host.',
    icon: Stethoscope,
  },
  SYSTEMD: {
    type: 'SYSTEMD',
    label: 'Systemd',
    description: 'Check, start, stop or restart a service unit.',
    icon: Server,
  },
  BASH: {
    type: 'BASH',
    label: 'Bash',
    description: 'Run an allowlisted shell command on an Agent.',
    icon: Terminal,
  },
  DOCKER: {
    type: 'DOCKER',
    label: 'Docker',
    description: 'Inspect, read logs or restart a container.',
    icon: Container,
  },
  KUBERNETES: {
    type: 'KUBERNETES',
    label: 'Kubernetes',
    description: 'Describe, restart or scale workloads in a namespace.',
    icon: Box,
  },
  HTTP: {
    type: 'HTTP',
    label: 'HTTP request',
    description: 'Call an internal endpoint and check the response.',
    icon: Globe,
  },
};

export const STEP_CATEGORIES: Array<{ label: string; types: RunbookStepType[] }> = [
  { label: 'Human', types: ['MANUAL', 'APPROVAL', 'WAIT', 'CONDITION'] },
  { label: 'Linux', types: ['LINUX_DIAGNOSTICS', 'SYSTEMD', 'BASH'] },
  { label: 'Containers', types: ['DOCKER', 'KUBERNETES'] },
  { label: 'Network', types: ['HTTP'] },
];

export const RISK_META: Record<RunbookRiskClass, { label: string; tone: Tone; dot: string }> = {
  READ_ONLY: { label: 'Read-only', tone: 'success', dot: 'bg-emerald-500' },
  IDEMPOTENT_WRITE: { label: 'Safe write', tone: 'warning', dot: 'bg-amber-500' },
  NON_IDEMPOTENT: { label: 'Mutation', tone: 'danger', dot: 'bg-rose-500' },
};

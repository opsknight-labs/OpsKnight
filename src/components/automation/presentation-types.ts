import type { getAutomationArea } from '@/app/(app)/services/[id]/automation/actions';
export type Data = Awaited<ReturnType<typeof getAutomationArea>>;
export type Area = 'overview' | 'context' | 'rules' | 'test' | 'activity';
export type Counts = {
  evaluated: number;
  same: number;
  routes: number;
  priorities: number;
  skips: number;
  errors: number;
};

import type { Observation } from '@/lib/automation/discovery';
export type Discovery = Observation & {
  source?: 'EVENT' | 'PROVIDER';
  frequency?: number;
  examples?: string[];
};

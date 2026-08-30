import { memo } from 'react';
import { cn } from '@/lib/utils';
import {
  Server,
  Code2,
  BookOpen,
  UserCheck,
  Building2,
  Activity,
  Sliders,
  Check,
} from 'lucide-react';

export type FactorType =
  | 'INFRASTRUCTURE'
  | 'CODE_DEFECT'
  | 'PROCESS'
  | 'HUMAN_FACTOR'
  | 'VENDOR_DEPENDENCY'
  | 'MONITORING_GAP'
  | 'CONFIGURATION';

export const CONTRIBUTING_FACTORS_CONFIG: Record<
  FactorType,
  {
    label: string;
    icon: typeof Server;
    style: string;
  }
> = {
  INFRASTRUCTURE: {
    label: 'Infrastructure',
    icon: Server,
    style: 'bg-blue-50 text-blue-700 border-blue-200/80',
  },
  CODE_DEFECT: {
    label: 'Code Defect',
    icon: Code2,
    style: 'bg-rose-50 text-rose-700 border-rose-200/80',
  },
  PROCESS: {
    label: 'Process / Runbook',
    icon: BookOpen,
    style: 'bg-amber-50 text-amber-700 border-amber-200/80',
  },
  HUMAN_FACTOR: {
    label: 'Human Factor',
    icon: UserCheck,
    style: 'bg-purple-50 text-purple-700 border-purple-200/80',
  },
  VENDOR_DEPENDENCY: {
    label: 'Third-Party Vendor',
    icon: Building2,
    style: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
  },
  MONITORING_GAP: {
    label: 'Monitoring Gap',
    icon: Activity,
    style: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  },
  CONFIGURATION: {
    label: 'Configuration Drift',
    icon: Sliders,
    style: 'bg-slate-100 text-slate-700 border-slate-200/80',
  },
};

export type ContributingFactorsSelectorProps = {
  selectedFactors?: FactorType[];
  onToggle?: (factor: FactorType) => void;
  isEditable?: boolean;
  className?: string;
};

function ContributingFactorsSelector({
  selectedFactors = [],
  onToggle,
  isEditable = false,
  className,
}: ContributingFactorsSelectorProps) {
  if (!isEditable) {
    if (selectedFactors.length === 0) {
      return (
        <span className="text-xs text-muted-foreground italic">
          No specific contributing factors tagged.
        </span>
      );
    }

    return (
      <div className={cn('flex flex-wrap gap-2', className)}>
        {selectedFactors.map(factor => {
          const config = CONTRIBUTING_FACTORS_CONFIG[factor];
          if (!config) return null;
          const Icon = config.icon;

          return (
            <span
              key={factor}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border shadow-2xs',
                config.style
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{config.label}</span>
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {(Object.keys(CONTRIBUTING_FACTORS_CONFIG) as FactorType[]).map(factor => {
        const config = CONTRIBUTING_FACTORS_CONFIG[factor];
        const Icon = config.icon;
        const isSelected = selectedFactors.includes(factor);

        return (
          <button
            key={factor}
            type="button"
            onClick={() => onToggle?.(factor)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer select-none',
              isSelected
                ? cn(config.style, 'ring-2 ring-primary/20 shadow-xs')
                : 'bg-white text-muted-foreground border-slate-200 hover:border-slate-300 hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{config.label}</span>
            {isSelected && <Check className="h-3 w-3 ml-0.5" />}
          </button>
        );
      })}
    </div>
  );
}

export default memo(ContributingFactorsSelector);

'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Plus, Trash2, CheckCircle2, Sparkles } from 'lucide-react';

export type FiveWhysStep = {
  id: string;
  question: string;
  answer: string;
};

export type FiveWhysBuilderProps = {
  initialSteps?: FiveWhysStep[];
  onChange?: (steps: FiveWhysStep[]) => void;
  isEditable?: boolean;
  className?: string;
};

const DEFAULT_STEPS: FiveWhysStep[] = [
  {
    id: 'why-1',
    question: 'Why did the service fail?',
    answer: 'The database connection pool was exhausted due to a surge in API traffic.',
  },
  {
    id: 'why-2',
    question: 'Why was the connection pool exhausted?',
    answer: 'A newly deployed query had no index, causing connections to stay open 10x longer.',
  },
  {
    id: 'why-3',
    question: 'Why was the query deployed without an index?',
    answer: 'The migration was omitted from the automated release pipeline.',
  },
];

export default function FiveWhysBuilder({
  initialSteps = DEFAULT_STEPS,
  onChange,
  isEditable = false,
  className,
}: FiveWhysBuilderProps) {
  const [steps, setSteps] = useState<FiveWhysStep[]>(
    initialSteps.length > 0 ? initialSteps : DEFAULT_STEPS
  );

  const handleUpdate = (updated: FiveWhysStep[]) => {
    setSteps(updated);
    onChange?.(updated);
  };

  const handleAddStep = () => {
    const nextIndex = steps.length + 1;
    const newStep: FiveWhysStep = {
      id: `why-${Date.now()}`,
      question: `Why #${nextIndex}?`,
      answer: '',
    };
    handleUpdate([...steps, newStep]);
  };

  const handleRemoveStep = (indexToRemove: number) => {
    const updated = steps.filter((_, idx) => idx !== indexToRemove);
    handleUpdate(updated);
  };

  const handleFieldChange = (index: number, field: 'question' | 'answer', value: string) => {
    const updated = steps.map((step, idx) => (idx === index ? { ...step, [field]: value } : step));
    handleUpdate(updated);
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">5-Whys Root Cause Chain</h3>
        </div>
        {isEditable && steps.length < 7 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddStep}
            className="h-7 text-xs gap-1"
          >
            <Plus className="h-3 w-3" />
            <span>Add Why Step</span>
          </Button>
        )}
      </div>

      <div className="relative pl-6 space-y-4 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;

          return (
            <div key={step.id} className="relative group">
              {/* Node Icon */}
              <div
                className={cn(
                  'absolute -left-6 top-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ring-4 ring-white z-10 transition-colors',
                  isLast ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground'
                )}
              >
                {isLast ? <CheckCircle2 className="h-3 w-3" /> : idx + 1}
              </div>

              {/* Step Card */}
              <div
                className={cn(
                  'p-3 rounded-lg border transition-all',
                  isLast
                    ? 'bg-emerald-50/50 border-emerald-200/80 shadow-sm'
                    : 'bg-white border-slate-200 shadow-xs'
                )}
              >
                {isEditable ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={step.question}
                        onChange={e => handleFieldChange(idx, 'question', e.target.value)}
                        placeholder={`Why #${idx + 1}...`}
                        className="h-8 text-xs font-semibold"
                      />
                      {steps.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStep(idx)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <Input
                      value={step.answer}
                      onChange={e => handleFieldChange(idx, 'answer', e.target.value)}
                      placeholder="Identified reason / finding..."
                      className="h-8 text-xs bg-slate-50"
                    />
                  </div>
                ) : (
                  <div>
                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <span className={cn(isLast ? 'text-emerald-700' : 'text-primary')}>
                        {isLast ? '🎯 Root Cause Finding' : `Why #${idx + 1}: ${step.question}`}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {step.answer || 'Finding pending investigation.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

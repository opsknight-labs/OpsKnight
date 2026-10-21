'use client';
import { useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { Button } from '@/components/ui/shadcn/button';
import type { Field, Rule } from '@/lib/automation/contract';
import { usesField } from './useAutomationDraft';

/** Confirms context-field removal; fields still referenced by rules cannot be removed. */
export function RemoveFieldDialog({
  field,
  rules,
  onCancel,
  onViewRules,
  onConfirm,
}: {
  field: Field | null;
  rules: Rule[];
  onCancel: () => void;
  onViewRules: (ruleIds: string[]) => void;
  onConfirm: (field: Field) => void;
}) {
  const [prevField, setPrevField] = useState<Field | null>(field);
  const [cachedField, setCachedField] = useState<Field | null>(field);

  if (field !== prevField) {
    setPrevField(field);
    if (field) {
      setCachedField(field);
    }
  }

  const currentField = field ?? cachedField;

  const affected = useMemo(
    () => (currentField ? rules.filter(rule => usesField(rule, currentField.key)) : []),
    [currentField, rules]
  );
  return (
    <AlertDialog open={!!field} onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {currentField?.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            {affected.length
              ? `${currentField?.label} is used by ${affected.length} ${affected.length === 1 ? 'rule' : 'rules'}. Update those rules before removing this field.`
              : `No rules use ${currentField?.label}. The field is removed from the draft only; you can undo for 10 seconds.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
          {affected.length > 0 ? (
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="outline"
                onClick={() => onViewRules(affected.map(rule => rule.id))}
              >
                View affected rules
              </Button>
            </AlertDialogAction>
          ) : (
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (field) onConfirm(field);
                }}
              >
                Confirm field removal
              </Button>
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

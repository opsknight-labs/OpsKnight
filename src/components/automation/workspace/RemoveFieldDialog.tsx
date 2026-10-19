'use client';
import { useMemo } from 'react';
import {
  AlertDialog,
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
  const affected = useMemo(
    () => (field ? rules.filter(rule => usesField(rule, field.key)) : []),
    [field, rules]
  );
  return (
    <AlertDialog open={!!field} onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {field?.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            {affected.length
              ? `${field?.label} is used by ${affected.length} ${affected.length === 1 ? 'rule' : 'rules'}. Update those rules before removing this field.`
              : `No rules use ${field?.label}. The field is removed from the draft only; you can undo for 10 seconds.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
          {affected.length > 0 ? (
            <Button variant="outline" onClick={() => onViewRules(affected.map(rule => rule.id))}>
              View affected rules
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => {
                if (field) onConfirm(field);
              }}
            >
              Confirm field removal
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

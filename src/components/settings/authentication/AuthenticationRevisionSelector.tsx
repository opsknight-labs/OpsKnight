'use client';

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/shadcn/select';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { CheckCircle2, Clock, Trash2, AlertCircle } from 'lucide-react';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';

export type AuthenticationRevisionSelectorProps = {
  label?: string;
  onSelect?: (id: string) => void;
  showCleanup?: boolean;
};

export default function AuthenticationRevisionSelector({
  label = 'Saved provider configuration',
  onSelect,
  showCleanup = true,
}: AuthenticationRevisionSelectorProps) {
  const {
    data,
    revisionId,
    setRevisionId,
    pending,
    perform,
    refresh,
    setMessage,
    setImpact,
    setConfirmation,
  } = useAuthenticationWorkspace();

  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [bulkCleanupOpen, setBulkCleanupOpen] = useState(false);

  const selectedRevision =
    data.revisions.find(rev => rev.id === revisionId) ?? data.revisions[0];

  const activeRevisions = data.revisions.filter(r => r.id === data.activeRevisionId);
  const stagedRevisions = data.revisions.filter(
    r => r.id !== data.activeRevisionId && !r.activatedAt
  );
  const previousRevisions = data.revisions.filter(
    r => r.id !== data.activeRevisionId && Boolean(r.activatedAt)
  );

  const isDeletable =
    selectedRevision &&
    selectedRevision.id !== data.activeRevisionId &&
    !selectedRevision.activatedAt;

  const handleSelect = (id: string) => {
    if (onSelect) {
      onSelect(id);
    } else {
      setRevisionId(id);
      setImpact(null);
      setConfirmation(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date);
    } catch {
      return dateString;
    }
  };

  const handleDeleteSingle = async (id: string) => {
    await perform(async () => {
      await authenticationRequest({ action: 'deleteRevision', revisionId: id });
      setDeleteCandidateId(null);
      setImpact(null);
      setConfirmation(false);
      setMessage('Staged configuration deleted.');
      await refresh();
      // Select the first remaining revision
      const remaining = data.revisions.filter(r => r.id !== id);
      if (remaining[0]) {
        setRevisionId(remaining[0].id);
      }
    });
  };

  const handleBulkCleanup = async () => {
    await perform(async () => {
      const result = await authenticationRequest<{ count: number }>({
        action: 'cleanupRevisions',
      });
      setBulkCleanupOpen(false);
      setImpact(null);
      setConfirmation(false);
      setMessage(`Cleaned up ${result.count ?? stagedRevisions.length} unused staged configurations.`);
      await refresh();
      // Reset to active or latest remaining
      const remaining = data.revisions.filter(r => r.activatedAt || r.id === data.activeRevisionId);
      if (remaining[0]) {
        setRevisionId(remaining[0].id);
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-foreground tracking-tight">
          {label}
        </label>
        {showCleanup && stagedRevisions.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1 font-medium transition-colors"
            onClick={() => setBulkCleanupOpen(true)}
          >
            <Trash2 className="h-3 w-3" />
            Clean up {stagedRevisions.length} staged drafts
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <select
          aria-label={label}
          value={revisionId || selectedRevision?.id || ''}
          disabled={pending || data.revisions.length === 0}
          onChange={e => handleSelect(e.target.value)}
          className="sr-only"
          tabIndex={-1}
        >
          {data.revisions.map(r => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        <div className="flex-1 min-w-0">
          <Select
            value={revisionId || selectedRevision?.id || ''}
            onValueChange={handleSelect}
            disabled={pending || data.revisions.length === 0}
          >
            <SelectTrigger
              aria-label="Select saved configuration"
              className="h-auto min-h-[44px] py-2 px-3 bg-background border rounded-xl hover:border-primary/40 focus:ring-2 focus:ring-primary/20 transition-all text-left"
            >
              {selectedRevision ? (
                <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden pr-2">
                  {selectedRevision.id === data.activeRevisionId ? (
                    <Badge variant="success" className="text-[10px] font-semibold shrink-0">
                      Active
                    </Badge>
                  ) : selectedRevision.activatedAt ? (
                    <Badge variant="outline" className="text-[10px] font-medium shrink-0 border-muted-foreground/30">
                      Previous
                    </Badge>
                  ) : (
                    <Badge variant="neutral" className="text-[10px] font-medium shrink-0 bg-primary/10 text-primary border-primary/20">
                      Staged Candidate
                    </Badge>
                  )}
                  <div className="flex items-center gap-1.5 min-w-0 text-xs truncate">
                    <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground truncate">
                      {formatDate(selectedRevision.createdAt)}
                    </span>
                  </div>
                  {selectedRevision.testedAt && (
                    <div className="ml-auto flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Tested</span>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {data.revisions.length === 0 ? 'No configurations saved' : 'Choose a saved configuration...'}
                </span>
              )}
            </SelectTrigger>

            <SelectContent className="max-h-80 w-[var(--radix-select-trigger-width)] min-w-[320px] rounded-xl border bg-popover shadow-xl p-1">
              {activeRevisions.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Currently Active
                  </SelectLabel>
                  {activeRevisions.map(rev => (
                    <SelectItem
                      key={rev.id}
                      value={rev.id}
                      className="rounded-lg py-2 pl-8 pr-2.5 cursor-pointer my-0.5"
                    >
                      <div className="flex items-center justify-between gap-2 w-full min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="success" className="text-[10px] font-semibold shrink-0">
                            Active
                          </Badge>
                          <span className="text-xs font-medium text-foreground truncate">
                            {formatDate(rev.createdAt)}
                          </span>
                        </div>
                        {rev.testedAt && (
                          <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Verified</span>
                          </div>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}

              {stagedRevisions.length > 0 && (
                <SelectGroup>
                  {activeRevisions.length > 0 && <SelectSeparator />}
                  <SelectLabel className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                    <span>Staged Candidates ({stagedRevisions.length})</span>
                    <span className="text-[10px] font-normal lowercase text-muted-foreground">ready for test</span>
                  </SelectLabel>
                  {stagedRevisions.map((rev, index) => (
                    <SelectItem
                      key={rev.id}
                      value={rev.id}
                      className="rounded-lg py-2 pl-8 pr-2.5 cursor-pointer my-0.5"
                    >
                      <div className="flex items-center justify-between gap-2 w-full min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="neutral" className="text-[10px] font-medium shrink-0 bg-primary/10 text-primary border-primary/20">
                            Staged #{stagedRevisions.length - index}
                          </Badge>
                          <span className="text-xs font-medium text-foreground truncate">
                            {formatDate(rev.createdAt)}
                          </span>
                        </div>
                        {rev.testedAt ? (
                          <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Verified</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium shrink-0">
                            Unverified
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}

              {previousRevisions.length > 0 && (
                <SelectGroup>
                  <SelectSeparator />
                  <SelectLabel className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Previous Configurations
                  </SelectLabel>
                  {previousRevisions.map(rev => (
                    <SelectItem
                      key={rev.id}
                      value={rev.id}
                      className="rounded-lg py-2 pl-8 pr-2.5 cursor-pointer my-0.5"
                    >
                      <div className="flex items-center justify-between gap-2 w-full min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="text-[10px] font-medium shrink-0 border-muted-foreground/30">
                            Previous
                          </Badge>
                          <span className="text-xs font-medium text-muted-foreground truncate">
                            {formatDate(rev.createdAt)}
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Delete button for currently selected unactivated staged revision */}
        {isDeletable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            className="h-[44px] px-3 border-destructive/30 hover:border-destructive text-destructive hover:bg-destructive/10 shrink-0 transition-colors"
            title="Delete this staged configuration"
            onClick={() => setDeleteCandidateId(selectedRevision.id)}
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline text-xs ml-1.5">Delete draft</span>
          </Button>
        )}
      </div>

      {/* Confirmation Dialog: Delete Single Staged Revision */}
      <Dialog
        open={Boolean(deleteCandidateId)}
        onOpenChange={open => !open && setDeleteCandidateId(null)}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Delete staged configuration?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-1.5 leading-relaxed">
              This permanently deletes this unactivated staged candidate and any associated sign-in test verification proofs.
              Your active single sign-on provider and authentication policies are completely unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setDeleteCandidateId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => deleteCandidateId && void handleDeleteSingle(deleteCandidateId)}
            >
              Delete configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog: Bulk Cleanup Staged Revisions */}
      <Dialog open={bulkCleanupOpen} onOpenChange={setBulkCleanupOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Clean up all {stagedRevisions.length} staged drafts?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-1.5 leading-relaxed">
              This removes all unactivated staged configuration candidates created during testing.
              Active configurations and previous historical rollbacks are preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setBulkCleanupOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => void handleBulkCleanup()}
            >
              Clean up all staged drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

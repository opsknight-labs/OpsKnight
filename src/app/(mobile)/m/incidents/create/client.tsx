'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileButton from '@/components/mobile/MobileButton';
import { cn } from '@/lib/utils';
import { notify as toast } from '@/lib/toast';

type Service = { id: string; name: string };
type User = { id: string; name: string | null; email: string };
type CreateIncidentResult = { id?: string } | null;

export default function MobileCreateIncidentClient({
  services,
  users,
  createAction,
}: {
  services: Service[];
  users: User[];
  createAction: (formData: FormData) => Promise<CreateIncidentResult>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultServiceId = searchParams.get('serviceId') || '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [urgency, setUrgency] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('LOW');

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError('');

    try {
      const result = await createAction(formData);
      if (result && result.id) {
        toast.success('Incident created successfully');
        // Ensure we redirect to the MOBILE view
        router.push(`/m/incidents/${result.id}`);
      } else {
        toast.success('Incident created');
        // Fallback if no ID returned (shouldn't happen)
        router.push('/m/incidents');
      }
    } catch (err: unknown) {
      const errorInfo =
        err && typeof err === 'object' ? (err as { message?: string; digest?: string }) : {};
      // We removed the server-side redirect, so NEXT_REDIRECT shouldn't happen,
      // but keeping this check doesn't hurt.
      if (errorInfo.message === 'NEXT_REDIRECT' || errorInfo.digest?.startsWith('NEXT_REDIRECT')) {
        throw err;
      }
      setError(errorInfo.message || 'Failed to create incident');
      setLoading(false);
    }
  }

  // Helper to truncate long names for mobile dropdowns
  const truncate = (str: string | null, len: number) => {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  };

  return (
    <form action={handleSubmit}>
      <div className="flex flex-col gap-4">
        {/* Title */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            name="title"
            required
            placeholder="e.g. API Gateway High Latency"
            className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
            Description
          </label>
          <textarea
            name="description"
            rows={4}
            placeholder="What's happening? Add context..."
            className="w-full resize-none rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Service */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
            Service <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              name="serviceId"
              required
              defaultValue={defaultServiceId}
              className="w-full appearance-none rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-3 pr-10 text-sm text-[color:var(--text-primary)] shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="" disabled>
                Select a service
              </option>
              {services.map(s => (
                <option key={s.id} value={s.id}>
                  {truncate(s.name, 25)}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        {/* Urgency */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
            Urgency
          </label>
          <div className="grid grid-cols-3 gap-2">
            <UrgencyRadio
              name="urgency"
              value="HIGH"
              label="High"
              checked={urgency === 'HIGH'}
              onChange={() => setUrgency('HIGH')}
            />
            <UrgencyRadio
              name="urgency"
              value="MEDIUM"
              label="Medium"
              checked={urgency === 'MEDIUM'}
              onChange={() => setUrgency('MEDIUM')}
            />
            <UrgencyRadio
              name="urgency"
              value="LOW"
              label="Low"
              checked={urgency === 'LOW'}
              onChange={() => setUrgency('LOW')}
            />
          </div>
        </div>

        {/* Assignee */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
            Assignee (Optional)
          </label>
          <div className="relative">
            <select
              name="assigneeId"
              className="w-full appearance-none rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-3 pr-10 text-sm text-[color:var(--text-primary)] shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Unassigned</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {truncate(u.name || u.email, 25)}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <MobileButton
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={() => router.back()}
          >
            Cancel
          </MobileButton>
          <MobileButton
            type="submit"
            variant={urgency === 'HIGH' ? 'danger' : urgency === 'MEDIUM' ? 'warning' : 'success'}
            className="flex-1"
            loading={loading}
          >
            {loading ? 'Submitting...' : 'Submit Incident'}
          </MobileButton>
        </div>
      </div>
    </form>
  );
}

function UrgencyRadio({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition',
        checked
          ? value === 'HIGH'
            ? 'border-red-500 bg-red-100 text-red-700 dark:border-red-600 dark:bg-red-900/40 dark:text-red-300'
            : value === 'MEDIUM'
              ? 'border-amber-500 bg-amber-100 text-amber-700 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-300'
              : 'border-emerald-500 bg-emerald-100 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'border-[color:var(--border)] bg-[color:var(--bg-surface)] text-[color:var(--text-secondary)]'
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span>{label}</span>
    </label>
  );
}

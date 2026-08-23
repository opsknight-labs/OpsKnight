'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../ToastProvider';
import { trapFocus } from '@/lib/focus-trap';

type SnoozeDurationDialogProps = {
  incidentId: string;
  onClose: () => void;
  onSnooze: (incidentId: string, durationMinutes: number, reason?: string) => Promise<void>;
};

export default function SnoozeDurationDialog({
  incidentId,
  onClose,
  onSnooze,
}: SnoozeDurationDialogProps) {
  const [duration, setDuration] = useState<number>(60); // Default 1 hour
  const [customDuration, setCustomDuration] = useState<string>('');
  const [durationType, setDurationType] = useState<'preset' | 'custom'>('preset');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    if (dialogRef.current) {
      const cleanup = trapFocus(dialogRef.current, onClose);
      return cleanup;
    }
  }, [onClose]);

  const presetDurations = [
    { label: '15 minutes', minutes: 15 },
    { label: '30 minutes', minutes: 30 },
    { label: '1 hour', minutes: 60 },
    { label: '2 hours', minutes: 120 },
    { label: '4 hours', minutes: 240 },
    { label: '8 hours', minutes: 480 },
    { label: '12 hours', minutes: 720 },
    { label: '24 hours', minutes: 1440 },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      let finalDuration = duration;
      if (durationType === 'custom' && customDuration) {
        const hours = parseInt(customDuration);
        if (isNaN(hours) || hours <= 0) {
          showToast('Please enter a valid number of hours', 'error');
          setIsSubmitting(false);
          return;
        }
        finalDuration = hours * 60;
      }

      await onSnooze(incidentId, finalDuration, reason || undefined);
      showToast(`Incident snoozed for ${Math.round(finalDuration / 60)} hour(s)`, 'success');
      onClose();
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to snooze incident', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '2rem',
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snooze-dialog-title"
        className="bg-card text-card-foreground border border-border"
        style={{
          borderRadius: '12px',
          padding: '2rem',
          maxWidth: '500px',
          width: '100%',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h3
          id="snooze-dialog-title"
          style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}
        >
          Snooze Incident
        </h3>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.5rem' }}>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Duration
            </label>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  checked={durationType === 'preset'}
                  onChange={() => setDurationType('preset')}
                  style={{ margin: 0 }}
                />
                <span style={{ fontSize: '0.9rem' }}>Preset</span>
              </label>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  checked={durationType === 'custom'}
                  onChange={() => setDurationType('custom')}
                  style={{ margin: 0 }}
                />
                <span style={{ fontSize: '0.9rem' }}>Custom</span>
              </label>
            </div>

            {durationType === 'preset' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {presetDurations.map(preset => (
                  <button
                    key={preset.minutes}
                    type="button"
                    onClick={() => setDuration(preset.minutes)}
                    style={{
                      padding: '0.625rem',
                      border:
                        duration === preset.minutes
                          ? '2px solid var(--primary-color)'
                          : '1px solid var(--border)',
                      borderRadius: '0px',
                      background: duration === preset.minutes ? '#fef2f2' : 'white',
                      color: 'var(--text-primary)',
                      fontWeight: duration === preset.minutes ? 600 : 400,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="number"
                  min="1"
                  value={customDuration}
                  onChange={e => setCustomDuration(e.target.value)}
                  placeholder="Hours"
                  style={{
                    padding: '0.625rem',
                    border: '1px solid var(--border)',
                    borderRadius: '0px',
                    fontSize: '0.9rem',
                    width: '100px',
                  }}
                />
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>hours</span>
              </div>
            )}
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Reason (Optional)
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why are you snoozing this incident?"
              rows={3}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '0px',
                fontSize: '0.9rem',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid var(--border)',
                borderRadius: '0px',
                background: 'white',
                color: 'var(--text-primary)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '0.75rem 1.5rem',
                border: 'none',
                borderRadius: '0px',
                background: 'var(--primary-color)',
                color: 'white',
                fontWeight: 600,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              {isSubmitting ? 'Snoozing...' : 'Snooze'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

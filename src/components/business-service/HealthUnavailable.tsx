import { ErrorState } from '@/components/patterns';

/**
 * Inline error when live health could not be computed (database or engine failure). The rest of the
 * page still renders; the next refresh tries again.
 */
export default function HealthUnavailable({
  message = 'Live status, impact history and uptime could not be loaded. Everything else on this page is current; refresh in a moment to try again.',
}: {
  message?: string;
}) {
  return <ErrorState variant="inline" title="Health is unavailable right now" message={message} />;
}

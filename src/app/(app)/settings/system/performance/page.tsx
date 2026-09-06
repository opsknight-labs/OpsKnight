import { permanentRedirect } from 'next/navigation';

export default function DeprecatedPerformancePage() {
  permanentRedirect('/settings/system/health');
}

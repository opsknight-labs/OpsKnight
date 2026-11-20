import SettingsSubpageNav from '@/components/settings/SettingsSubpageNav';

/** Review pages are focused cards rather than full settings pages; keep the settings trail. */
export default function McpApprovalsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <SettingsSubpageNav currentLabel="Review request" />
      {children}
    </div>
  );
}

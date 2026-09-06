type Props = {
  isAdmin?: boolean;
  isResponderOrAbove?: boolean;
  children: React.ReactNode;
};

export default function SettingsShell({ children }: Props) {
  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 min-h-[calc(100vh-4rem)]">
      <main className="w-full">{children}</main>
    </div>
  );
}

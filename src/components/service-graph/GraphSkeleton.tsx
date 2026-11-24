/** Placeholder while the canvas code loads or the layout is computed. */
export default function GraphSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="grid h-full grid-cols-3 gap-6 p-8"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <div
          key={index}
          className="h-16 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
          style={{ marginTop: (index % 3) * 18 }}
        />
      ))}
    </div>
  );
}

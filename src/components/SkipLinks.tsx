// Visually hidden until focused. A negative `top` offset left both links peeking into the
// viewport once touch styles raised links to 44px, overlapping each other at the top edge.
const skipLinkClass =
  'sr-only focus:not-sr-only focus:fixed focus:left-0 focus:top-0 focus:z-[10000] focus:rounded-br-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:no-underline';

export default function SkipLinks() {
  return (
    <>
      <a href="#main-content" className={skipLinkClass}>
        Skip to main content
      </a>
      <a href="#navigation" className={skipLinkClass}>
        Skip to navigation
      </a>
    </>
  );
}

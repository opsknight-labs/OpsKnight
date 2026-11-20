/**
 * OpsKnight type scale steps. Values live once, as CSS variables in
 * src/styles/foundation/tokens.css (`--font-size-<step>` plus
 * `--font-size-<step>--line-height` / `--letter-spacing`); Tailwind's
 * `text-<step>` utilities resolve those variables, so CSS and Tailwind can
 * never drift. See DESIGN.md "Typography".
 */
export const TYPE_SCALE_STEPS = [
  '2xs',
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
] as const;

export type TypeScaleStep = (typeof TYPE_SCALE_STEPS)[number];

type TailwindFontSize = [fontSize: string, options: { lineHeight: string; letterSpacing: string }];

/** Tailwind `theme.extend.fontSize` entries backed by the token variables. */
export const TAILWIND_FONT_SIZES = Object.fromEntries(
  TYPE_SCALE_STEPS.map(step => [
    step,
    [
      `var(--font-size-${step})`,
      {
        lineHeight: `var(--font-size-${step}--line-height)`,
        letterSpacing: `var(--font-size-${step}--letter-spacing)`,
      },
    ],
  ])
) as Record<TypeScaleStep, TailwindFontSize>;

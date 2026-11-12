import * as React from 'react';
import './squire-mascot.css';

/**
 * OpsKnight Squire: animated AIOps assistant mascot.
 * Self-contained: pure SVG + CSS, no dependencies beyond React.
 *
 * States map to the assistant lifecycle:
 *   idle       ready, waiting for input
 *   greeting   first open / onboarding / empty state
 *   listening  user typing or voice input
 *   thinking   request in flight (RCA, correlation, LLM call)
 *   speaking   streaming a response
 *   success    remediation / runbook step succeeded
 *   alert      new incident or anomaly needs a human
 *   error      action failed / provider unreachable
 *   offline    assistant unavailable or network disconnected
 *
 * Variants: "full" (with body, for panels and empty states) and
 * "avatar" (head only, for 16-40px chat avatars and buttons).
 * Honours prefers-reduced-motion.
 */
export type SquireState =
  | 'idle'
  | 'greeting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'success'
  | 'alert'
  | 'error'
  | 'offline';

export interface OpsKnightSquireProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  state?: SquireState;
  variant?: 'full' | 'avatar';
  /** px number or CSS length. Default 96 (full) / 32 (avatar). */
  size?: number | string;
  /** Animation speed multiplier: 1 = default, 2 = half speed. */
  speed?: number;
  /** Respect the application motion preference in addition to the OS preference. */
  animated?: boolean;
  /** Accessible label. Pass "" to mark decorative. */
  label?: string;
}

const LABELS: Record<SquireState, string> = {
  idle: 'Squire is ready',
  greeting: 'Squire says hello',
  listening: 'Squire is listening',
  thinking: 'Squire is analysing',
  speaking: 'Squire is responding',
  success: 'Squire completed the action',
  alert: 'Squire needs your attention',
  error: 'Squire hit an error',
  offline: 'Squire is offline',
};

export function OpsKnightSquire({
  state = 'idle',
  variant = 'full',
  size,
  speed = 1,
  animated = true,
  label,
  className,
  style,
  ...rest
}: OpsKnightSquireProps) {
  const px = size ?? (variant === 'avatar' ? 32 : 96);
  const dim = typeof px === 'number' ? `${px}px` : px;
  // State is a closed union; these labels are fixed application strings.
  // eslint-disable-next-line security/detect-object-injection
  const a11y = label ?? LABELS[state];
  const duration = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const decorative = a11y === '';
  return (
    <svg
      viewBox={variant === 'avatar' ? '12 -3 96 92' : '0 0 120 120'}
      xmlns="http://www.w3.org/2000/svg"
      className={['opsknight-squire', className].filter(Boolean).join(' ')}
      data-state={state}
      data-motion={animated ? 'on' : 'off'}
      focusable="false"
      data-variant={variant}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : a11y}
      aria-hidden={decorative || undefined}
      style={{ width: dim, height: dim, ['--oksq-dur' as string]: duration, ...style }}
      {...rest}
    >
      <ellipse className="oksq-shadow" cx="60" cy="117" rx="24" ry="2.6" />
      <g className="oksq-rig">
        <g className="oksq-body">
          <path
            className="oksq-cape"
            d="M47 80C37 84 27 96 17 113C26 110.5 33 112 41 116.5L54 95Z"
          />
          <path
            className="oksq-cape-shade"
            d="M41 116.5L54 95L49 91C43 99 39 107 36 114.5C38 115 39.5 115.7 41 116.5Z"
          />
          {/* left arm */}
          <g className="oksq-arm-l">
            <circle className="oksq-joint" cx="37" cy="92" r="4.5" />
            <rect className="oksq-armor" x="30.5" y="93" width="13" height="15" rx="6.5" />
            <circle className="oksq-glove" cx="37" cy="110" r="6" />
          </g>
          {/* torso */}
          <path
            className="oksq-armor-shade"
            d="M41 84C41 80 50 77 60 77S79 80 79 84L81 106C81 113 72 118.5 60 118.5S39 113 39 106Z"
          />
          <path
            className="oksq-armor"
            d="M42.5 84C42.5 80.5 50.5 78 60 78S77.5 80.5 77.5 84L79 104C79 110 71 114.5 60 114.5S41 110 41 104Z"
          />
          <path className="oksq-seam" d="M45 106.5C50 109 70 109 75 106.5" />
          {/* chest crest */}
          <g className="oksq-crest">
            <circle className="oksq-crest-ring" cx="60" cy="96" r="9" />
            <path
              className="oksq-rim"
              d="M51.5 88.5H68.5V96C68.5 101.8 64.5 105.4 60 107.4C55.5 105.4 51.5 101.8 51.5 96Z"
            />
            <path
              className="oksq-red"
              d="M54 90.8H66V96C66 100.2 63.2 103 60 104.6C56.8 103 54 100.2 54 96Z"
            />
            <path className="oksq-red-hi" d="M54 90.8H60V104.6C56.8 103 54 100.2 54 96Z" />
          </g>
          <ellipse className="oksq-armor-shade" cx="40" cy="86" rx="9.5" ry="7.5" />
          <ellipse className="oksq-armor" cx="39.5" cy="85" rx="8.5" ry="6.5" />
          <ellipse className="oksq-armor-shade" cx="80" cy="86" rx="9.5" ry="7.5" />
          <ellipse className="oksq-armor" cx="80.5" cy="85" rx="8.5" ry="6.5" />
          {/* right arm (waves) */}
          <g className="oksq-arm-r">
            <circle className="oksq-joint" cx="84" cy="90" r="4.5" />
            <rect className="oksq-armor" x="77.5" y="91" width="13" height="15" rx="6.5" />
            <g className="oksq-hand">
              <circle className="oksq-glove" cx="84" cy="108" r="6" />
              <ellipse className="oksq-glove" cx="78.6" cy="105.5" rx="2.4" ry="3.2" />
            </g>
          </g>
        </g>
        {/* scarf */}
        <path
          className="oksq-cape"
          d="M37.5 80.5C45 74.5 75 74.5 82.5 80.5C77 87 43 87 37.5 80.5Z"
        />
        <path
          className="oksq-cape-shade"
          d="M40 82.2C48 85.6 72 85.6 80 82.2C74 86.6 46 86.6 40 82.2Z"
        />
        <circle className="oksq-rim" cx="60" cy="84" r="3.6" />
        <circle className="oksq-armor" cx="59.4" cy="83.4" r="1.6" />
        {/* head */}
        <g className="oksq-head">
          <g className="oksq-plume">
            <path
              className="oksq-red"
              d="M49 16C44 5 31 1.5 20 7C28 7.5 32.5 10 35 13.5C26 13.5 17.5 19.5 13 30C23 24 33.5 22 43 24.5Z"
            />
            <path
              className="oksq-red-shade"
              d="M43 24.5C33.5 22 23 24 13 30C20 26.5 30 25.5 37 27Z"
            />
            <path className="oksq-red-hi-line" d="M44 15C40 9.5 33 7 27 8" />
          </g>
          <path
            className="oksq-fin"
            d="M53.5 17.5C55.5 12.5 58 9.5 61 8C63 10 65 13.5 66.5 17.5Z"
          />
          <circle className="oksq-ear-ring" cx="24.5" cy="50" r="9" />
          <circle className="oksq-ear-ring" cx="95.5" cy="50" r="9" />
          <circle className="oksq-rim" cx="24.5" cy="50" r="9" />
          <circle className="oksq-armor" cx="23.6" cy="49.4" r="5.8" />
          <circle className="oksq-rim" cx="95.5" cy="50" r="9" />
          <circle className="oksq-armor" cx="96.4" cy="49.4" r="5.8" />
          <ellipse className="oksq-helm-shade" cx="60" cy="46" rx="36" ry="33" />
          <ellipse className="oksq-helm" cx="58.6" cy="44.2" rx="34.4" ry="31.2" />
          <path className="oksq-vent" d="M47.2 21.8L48.3 26.2M72.8 21.8L71.7 26.2" />
          {/* visor */}
          <path
            className="oksq-visor"
            d="M39 29.5H81C87.5 29.5 92 34.5 92 41.5V54.5C92 62.5 86 68 78 68H42C34 68 28 62.5 28 54.5V41.5C28 34.5 32.5 29.5 39 29.5Z"
          />
          <path className="oksq-gloss" d="M77 33C82.5 33.5 87 36.5 88.3 41.5" />
          <g className="oksq-face">
            <g className="oksq-brows">
              <path className="oksq-ink oksq-brow l" d="M42.5 39Q47 35 52.5 37" />
              <path className="oksq-ink oksq-brow r" d="M67.5 37Q73 35 77.5 39" />
            </g>
            <g className="oksq-eyes">
              <g className="oksq-eyes-open">
                <ellipse className="oksq-fill oksq-eye l" cx="48" cy="49" rx="5" ry="6.6" />
                <ellipse className="oksq-fill oksq-eye r" cx="72" cy="49" rx="5" ry="6.6" />
              </g>
              <path
                className="oksq-ink oksq-eyes-happy"
                d="M42.6 52Q48 43.5 53.4 52M66.6 52Q72 43.5 77.4 52"
              />
              <path
                className="oksq-ink oksq-eyes-closed"
                d="M42.6 49.5Q48 54 53.4 49.5M66.6 49.5Q72 54 77.4 49.5"
              />
            </g>
            <path className="oksq-ink oksq-mouth" d="M54.5 59.5Q60 64.2 65.5 59.5" />
            <ellipse className="oksq-fill oksq-mouth-o" cx="60" cy="61" rx="2.8" ry="3.3" />
            <g className="oksq-dots">
              <circle className="oksq-fill" cx="54" cy="61.5" r="1.8" />
              <circle className="oksq-fill" cx="60" cy="61.5" r="1.8" />
              <circle className="oksq-fill" cx="66" cy="61.5" r="1.8" />
            </g>
          </g>
        </g>
        {/* badges */}
        <g className="oksq-zzz">
          <path className="oksq-z" d="M98 22H104L98 28H104" />
          <path className="oksq-z s" d="M106 12H110L106 16H110" />
        </g>
        <path
          className="oksq-spark s1"
          d="M104 26L105.5 30.5L110 32L105.5 33.5L104 38L102.5 33.5L98 32L102.5 30.5Z"
        />
        <path className="oksq-spark s2" d="M16 40L17 43L20 44L17 45L16 48L15 45L12 44L15 43Z" />
      </g>
    </svg>
  );
}

export default OpsKnightSquire;

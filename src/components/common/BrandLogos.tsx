import React, { useId } from 'react';

type BrandLogoProps = {
  className?: string;
  size?: number;
};

export function SlackLogo({ className = 'h-4 w-4' }: BrandLogoProps) {
  return (
    <svg viewBox="0 0 128 128" className={className} fill="none" aria-label="Slack logo">
      <path d="M26.002 81.996a12.998 12.998 0 1 1-12.998-13h12.998v13z" fill="#E01E5A" />
      <path
        d="M32.503 81.996a12.998 12.998 0 0 1 25.996 0v32.496a12.998 12.998 0 1 1-25.996 0v-32.496z"
        fill="#E01E5A"
      />
      <path d="M45.501 26.002a12.998 12.998 0 1 1 13-12.998v12.998h-13z" fill="#36C5F0" />
      <path
        d="M45.501 32.503a12.998 12.998 0 0 1 0 25.996H13.005a12.998 12.998 0 0 1 0-25.996h32.496z"
        fill="#36C5F0"
      />
      <path d="M101.998 45.501a12.998 12.998 0 1 1 12.998 13h-12.998v-13z" fill="#2EB67D" />
      <path
        d="M95.497 45.501a12.998 12.998 0 0 1-25.996 0V13.005a12.998 12.998 0 1 1 25.996 0v32.496z"
        fill="#2EB67D"
      />
      <path d="M82.499 101.998a12.998 12.998 0 1 1-13 12.998v-12.998h13z" fill="#ECB22E" />
      <path
        d="M82.499 95.497a12.998 12.998 0 0 1 0-25.996h32.496a12.998 12.998 0 1 1 0 25.996H82.499z"
        fill="#ECB22E"
      />
    </svg>
  );
}

export function JiraLogo({ className = 'h-4 w-4' }: BrandLogoProps) {
  const id = useId().replace(/:/g, '');
  const gradA = `jira-grad-a-${id}`;
  const gradB = `jira-grad-b-${id}`;

  return (
    <svg viewBox="0 0 128 128" className={className} fill="none" aria-label="Jira logo">
      <defs>
        <linearGradient
          id={gradA}
          gradientUnits="userSpaceOnUse"
          x1="22.034"
          y1="9.773"
          x2="17.118"
          y2="14.842"
          gradientTransform="scale(4)"
        >
          <stop offset="0.176" stopColor="#0052cc" />
          <stop offset="1" stopColor="#2684ff" />
        </linearGradient>
        <linearGradient
          id={gradB}
          gradientUnits="userSpaceOnUse"
          x1="16.641"
          y1="15.564"
          x2="10.957"
          y2="21.094"
          gradientTransform="scale(4)"
        >
          <stop offset="0.176" stopColor="#0052cc" />
          <stop offset="1" stopColor="#2684ff" />
        </linearGradient>
      </defs>
      <path
        d="M108.023 16H61.805c0 11.52 9.324 20.848 20.847 20.848h8.5v8.226c0 11.52 9.328 20.848 20.848 20.848V19.977A3.98 3.98 0 00108.023 16z"
        fill="#2684ff"
      />
      <path
        d="M85.121 39.04H38.902c0 11.519 9.325 20.847 20.844 20.847h8.504v8.226c0 11.52 9.328 20.848 20.848 20.848V43.016a3.983 3.983 0 00-3.977-3.977z"
        fill={`url(#${gradA})`}
      />
      <path
        d="M62.219 62.078H16c0 11.524 9.324 20.848 20.848 20.848h8.5v8.23c0 11.52 9.328 20.844 20.847 20.844V66.059a3.984 3.984 0 00-3.976-3.98z"
        fill={`url(#${gradB})`}
      />
    </svg>
  );
}

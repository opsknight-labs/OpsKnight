import React from 'react';

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
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-label="Jira logo">
      <path
        d="M11.53 2c0 2.4-1.97 4.35-4.4 4.35H2.73C1.22 6.35 0 7.58 0 9.08v4.4C0 15.9 1.97 17.85 4.4 17.85h4.4c1.51 0 2.73-1.22 2.73-2.72V10.73c0-2.4 1.97-4.35 4.4-4.35h4.4c1.51 0 2.73-1.22 2.73-2.73V2H11.53z"
        fill="#0052CC"
      />
      <path
        d="M11.53 7.82c0 2.4-1.97 4.35-4.4 4.35H2.73C1.22 12.17 0 13.4 0 14.9v4.4C0 21.72 1.97 23.67 4.4 23.67h4.4c1.51 0 2.73-1.22 2.73-2.72V16.55c0-2.4 1.97-4.35 4.4-4.35h4.4c1.51 0 2.73-1.22 2.73-2.73V7.82H11.53z"
        fill="#2684FF"
      />
    </svg>
  );
}

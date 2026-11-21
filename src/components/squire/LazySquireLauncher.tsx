'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type SquireLauncher from './SquireLauncher';

const Launcher = dynamic(() => import('./SquireLauncher'), { ssr: false });

/** Keep the assistant and its dialog out of the initial application bundle. */
export default function LazySquireLauncher(props: ComponentProps<typeof SquireLauncher>) {
  return <Launcher {...props} />;
}

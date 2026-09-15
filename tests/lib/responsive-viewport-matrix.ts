export type ViewportProfile = {
  name: string;
  width: number;
  height: number;
  category: 'compact-phone' | 'normal-phone' | 'comfortable-phone' | 'large-phone' | 'landscape';
};

export const VIEWPORT_MATRIX: Record<string, ViewportProfile> = {
  verySmallPhone: {
    name: 'Very small phone (iPhone SE 1st gen / narrow)',
    width: 320,
    height: 568,
    category: 'compact-phone',
  },
  compactAndroid: {
    name: 'Compact Android (Galaxy A-series / Moto)',
    width: 360,
    height: 740,
    category: 'compact-phone',
  },
  iphoneCompact: {
    name: 'iPhone compact (iPhone SE 2nd/3rd gen / 8)',
    width: 375,
    height: 667,
    category: 'normal-phone',
  },
  modernIphone390: {
    name: 'Modern iPhone (iPhone 12/13/14)',
    width: 390,
    height: 844,
    category: 'normal-phone',
  },
  modernIphone393: {
    name: 'Modern iPhone (iPhone 14/15/16 Pro)',
    width: 393,
    height: 852,
    category: 'normal-phone',
  },
  mediumPhone: {
    name: 'Medium phone (Pixel 7/8 / Galaxy S23)',
    width: 402,
    height: 874,
    category: 'comfortable-phone',
  },
  largePhone: {
    name: 'Large phone (iPhone 15/16 Pro Max / Galaxy S24 Ultra)',
    width: 430,
    height: 932,
    category: 'large-phone',
  },
  phoneLandscape: {
    name: 'Phone landscape (iPhone / Modern phone)',
    width: 844,
    height: 390,
    category: 'landscape',
  },
  smallLandscape: {
    name: 'Small landscape (Compact phone landscape)',
    width: 667,
    height: 375,
    category: 'landscape',
  },
};

export const ALL_VIEWPORTS = Object.values(VIEWPORT_MATRIX);

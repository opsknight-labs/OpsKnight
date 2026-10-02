export type KeyboardShortcutCategory = 'Incident Triage' | 'Navigation' | 'Actions';

export type KeyboardShortcutDefinition = {
  id: string;
  keys: string[];
  description: string;
  category: KeyboardShortcutCategory;
  scope: 'global' | 'incidents';
  runtimeOwner: 'GlobalKeyboardHandler' | 'SidebarSearch' | 'IncidentsListTable';
};

export const GLOBAL_NAVIGATION_SHORTCUTS = [
  { key: 'd', href: '/', description: 'Go to Dashboard' },
  { key: 'i', href: '/incidents', description: 'Go to Incidents' },
  { key: 's', href: '/services', description: 'Go to Services' },
  { key: 't', href: '/teams', description: 'Go to Teams' },
  { key: 'u', href: '/users', description: 'Go to Users' },
  { key: 'c', href: '/schedules', description: 'Go to Schedules' },
  { key: 'p', href: '/policies', description: 'Go to Policies' },
  { key: 'a', href: '/analytics', description: 'Go to Analytics' },
] as const;

export const KEYBOARD_SHORTCUTS: KeyboardShortcutDefinition[] = [
  ...GLOBAL_NAVIGATION_SHORTCUTS.map(item => ({
    id: `navigate-${item.key}`,
    keys: ['G', item.key.toUpperCase()],
    description: item.description,
    category: 'Navigation' as const,
    scope: 'global' as const,
    runtimeOwner: 'GlobalKeyboardHandler' as const,
  })),
  { id: 'global-search', keys: ['⌘/Ctrl', 'K'], description: 'Open global search', category: 'Actions', scope: 'global', runtimeOwner: 'SidebarSearch' },
  { id: 'shortcut-help', keys: ['?'], description: 'Toggle keyboard shortcuts', category: 'Actions', scope: 'global', runtimeOwner: 'GlobalKeyboardHandler' },
  { id: 'quick-create', keys: ['C'], description: 'Open Quick Create', category: 'Actions', scope: 'global', runtimeOwner: 'GlobalKeyboardHandler' },
  { id: 'new-incident', keys: ['N'], description: 'Create incident from an Incidents page', category: 'Actions', scope: 'incidents', runtimeOwner: 'GlobalKeyboardHandler' },
  { id: 'incident-next', keys: ['J', '↓'], description: 'Next incident in list', category: 'Incident Triage', scope: 'incidents', runtimeOwner: 'IncidentsListTable' },
  { id: 'incident-previous', keys: ['K', '↑'], description: 'Previous incident in list', category: 'Incident Triage', scope: 'incidents', runtimeOwner: 'IncidentsListTable' },
  { id: 'incident-select', keys: ['X'], description: 'Select or deselect focused incident', category: 'Incident Triage', scope: 'incidents', runtimeOwner: 'IncidentsListTable' },
  { id: 'incident-ack', keys: ['A'], description: 'Acknowledge focused incident', category: 'Incident Triage', scope: 'incidents', runtimeOwner: 'IncidentsListTable' },
  { id: 'incident-resolve', keys: ['R', 'E'], description: 'Resolve focused incident', category: 'Incident Triage', scope: 'incidents', runtimeOwner: 'IncidentsListTable' },
  { id: 'incident-open', keys: ['Enter', 'O'], description: 'Open focused incident', category: 'Incident Triage', scope: 'incidents', runtimeOwner: 'IncidentsListTable' },
  { id: 'incident-search', keys: ['/'], description: 'Focus incident-list search', category: 'Incident Triage', scope: 'incidents', runtimeOwner: 'IncidentsListTable' },
  { id: 'incident-clear', keys: ['Esc'], description: 'Clear incident selection or focus', category: 'Incident Triage', scope: 'incidents', runtimeOwner: 'IncidentsListTable' },
];

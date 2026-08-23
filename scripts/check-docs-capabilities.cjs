#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const inventoryPath = fs.existsSync(path.join(root, 'docs', 'V1_5_CAPABILITY_INVENTORY.md'))
  ? path.join(root, 'docs', 'V1_5_CAPABILITY_INVENTORY.md')
  : path.join(root, 'docs', 'V1_4_CAPABILITY_INVENTORY.md');
const inventory = fs.readFileSync(inventoryPath, 'utf8');
const failures = [];

const requiredCapabilities = [
  'Compose evaluation path',
  'Incident create, triage, bulk actions, lifecycle',
  'Desktop navigation and global search',
  'Personal in-app notification inbox',
  'On-call schedules, layers, rotations, overrides',
  'Escalation policies: user, team, schedule targets',
  'Notification history and retry visibility',
  'Docker Compose production configuration',
  'Helm deployment',
  'Kustomize deployment',
  'Database migration and startup behavior',
  'Backup and restore',
  'Health checks and observability',
  'Administrator operational health center',
  'Authentication, sessions, password reset',
  'API keys and scopes',
  'Events API trigger, acknowledge, resolve',
  'Responsive/mobile routes',
  'Accessibility behavior',
];

for (const capability of requiredCapabilities) {
  if (!inventory.includes(`| ${capability}`)) {
    failures.push(`Inventory is missing required capability: ${capability}`);
  }
}

const destinationPattern = /`(v1\.[45]\/[^`#]+)(?:#[^`]*)?`/g;
const destinations = new Set();
let match;
while ((match = destinationPattern.exec(inventory))) destinations.add(match[1]);

for (const destination of destinations) {
  const resolved = path.join(root, 'docs', destination);
  const candidates = [
    resolved,
    `${resolved}.md`,
    path.join(resolved, 'README.md'),
    path.join(resolved, 'index.md'),
  ];
  if (!candidates.some(candidate => fs.existsSync(candidate))) {
    failures.push(`Inventory destination does not exist: ${destination}`);
  }
}

const incompleteRows = inventory
  .split('\n')
  .filter(line => line.startsWith('|') && /\|\s*(Add|Revise)\s*\|/.test(line));
if (incompleteRows.length > 0) {
  failures.push(`Inventory still contains ${incompleteRows.length} Add/Revise row(s).`);
}

if (failures.length > 0) {
  console.error('Documentation capability contract failed:');
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(
  `Documentation capability contract passed: ${requiredCapabilities.length} required capabilities and ${destinations.size} destinations verified.`
);

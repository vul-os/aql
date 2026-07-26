export type NavItem = { to: string; label: string; end?: boolean };

export const APP_NAV_ITEMS: NavItem[] = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/access-points', label: 'Access points' },
  { to: '/app/devices', label: 'Devices' },
  { to: '/app/members', label: 'Members' },
  { to: '/app/grants', label: 'Temp access' },
  { to: '/app/analytics', label: 'Analytics' },
  { to: '/app/settings', label: 'Settings' },
];

// Instance-operator console. Rendered ONLY when me.user.is_platform_admin —
// the item is hidden entirely for everyone else (the route itself 403s too).
export const ADMIN_NAV_ITEM: NavItem = { to: '/app/admin', label: 'Instance admin' };

// Aql's command-center screens, ported from the pre-fold SvelteKit console.
// They run on a hard-coded demo dataset (src/pages/app/preview/demoData.ts) —
// there is no device engine yet (ROADMAP Phase 1). They are deliberately kept
// in their own sidebar section, under their own /app/preview/* path prefix, so
// they can never be mistaken for the gateway-backed items in APP_NAV_ITEMS.
// Every one of these pages renders <DemoBanner /> above the fold.
export const PREVIEW_NAV_LABEL = 'Command center · demo';

export const PREVIEW_NAV_ITEMS: NavItem[] = [
  { to: '/app/preview/devices', label: 'Home devices' },
  { to: '/app/preview/energy', label: 'Energy' },
  { to: '/app/preview/automations', label: 'Automations' },
];

export type NavItem = { to: string; label: string; end?: boolean };

/**
 * Aql's primary nav — the product itself: one hub for the physical world.
 *
 * These four are the same four the pre-fold console shipped with (Overview ·
 * Devices · Automations · Energy, see commit bf99a4d) and they are the top of
 * the tree, unqualified. Access control is one device kind among the seven
 * Aql models (Camera, Lighting, Robot, Climate, Energy, Sensor, Access) — it
 * is the kind that works end to end today, which makes it the best module,
 * not the product.
 *
 * Honesty lives per item inside these screens, not in the nav label: panels
 * and rows fed by src/lib/demoData.ts carry a <DemoChip />, gateway-backed
 * ones don't, and controls with no engine behind them are disabled with a
 * ROADMAP note. See src/components/demo/DemoMarks.tsx.
 */
export const APP_NAV_ITEMS: NavItem[] = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/devices', label: 'Devices' },
  { to: '/app/automations', label: 'Automations' },
  { to: '/app/energy', label: 'Energy' },
];

/**
 * The access-control module. Every screen here is real: it talks to the Go
 * gateway, issues signed commands to a paired controller, and writes an audit
 * row. Grouped under its own heading because it is one module of the hub —
 * deep, complete, and not the headline.
 */
export const ACCESS_NAV_LABEL = 'Access control';

export const ACCESS_NAV_ITEMS: NavItem[] = [
  { to: '/app/access-points', label: 'Access points' },
  { to: '/app/members', label: 'Members' },
  { to: '/app/grants', label: 'Temp access' },
  { to: '/app/analytics', label: 'Analytics' },
  { to: '/app/emergency', label: 'Emergency access' },
  { to: '/app/access-rules', label: 'Access rules' },
  { to: '/app/webhooks', label: 'Webhooks' },
  { to: '/app/api-tokens', label: 'API tokens' },
  { to: '/app/settings', label: 'Settings' },
];

// Instance-operator console. Rendered ONLY when me.user.is_platform_admin —
// the item is hidden entirely for everyone else (the route itself 403s too).
// Kept in its own group: it administers the whole gateway instance, not this
// account's access control.
export const ADMIN_NAV_ITEM: NavItem = { to: '/app/admin', label: 'Instance admin' };

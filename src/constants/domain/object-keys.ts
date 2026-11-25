// F19 object keys (01-api §7.1): they follow the project, not the person.

// Top folders; a key outside them is a pre-F19 key.
export const KEY_ROOT = {
  projects: 'projects/',
  company: 'company/',
} as const;

// Pre-F19 keys: "{uid}/{projectId}/…" and "{uid}/branding/…".
export const LEGACY_KEY = {
  shape: /^([A-Za-z0-9]{1,128})\/(.+)$/,
  brandingFolder: 'branding/',
} as const;

export const KEY_KINDS = ['capture', 'plan', 'branding'] as const;
export const KEY_KIND = {
  capture: 'capture',
  plan: 'plan',
  branding: 'branding',
} as const satisfies Record<(typeof KEY_KINDS)[number], string>;

const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';

// The full shape of each kind; checking it stops a caller signing URLs for paths like "../".
export const KEY_SHAPE = {
  capture: new RegExp(`^projects/(${UUID})/(${UUID})/(${UUID})\\.(jpg|heic|png|mov|mp4|m4a)$`),
  plan: new RegExp(`^projects/(${UUID})/plans/(${UUID})\\.(pdf|jpg|png|heic)$`),
  branding: new RegExp(`^company/branding/(${UUID})\\.(png|jpg)$`),
} as const;

// A session id on /ws.
export const UUID_SHAPE = new RegExp(`^${UUID}$`);

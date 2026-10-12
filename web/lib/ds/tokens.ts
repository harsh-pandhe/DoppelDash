// GENERATED FILE — do not edit. Source: design/tokens.json (node scripts/design/emit.mjs).
export const CORE_HASH = "b9c604c4e27d8f816630a128ad1b63fa40a577ecfe6c42774cd33d5e42d491bd" as const
export type BrandId = "doppeldash" | "doppelmayr"
export const DEFAULT_BRAND: BrandId = "doppeldash"
export const BRANDS = {
  "doppeldash": {
    "id": "doppeldash",
    "name": "DoppelDash",
    "shortName": "DoppelDash",
    "tagline": "Operations, travel, expenses & CRM — for your whole team",
    "tone": "saas",
    "client": "android",
    "seed": "#4F6AF5"
  },
  "doppelmayr": {
    "id": "doppelmayr",
    "name": "Doppelmayr India",
    "shortName": "Doppelmayr",
    "tagline": "Employee workspace",
    "tone": "enterprise",
    "client": "web",
    "seed": "#0057A8"
  }
} as const
export const STATUS_ROLE = {
  "pending": "warning",
  "pending_manager": "warning",
  "pending_admin": "warning",
  "in_review": "info",
  "approved": "success",
  "paid": "success",
  "active": "success",
  "completed": "success",
  "rejected": "error",
  "failed": "error",
  "suspended": "error",
  "returned": "tertiary",
  "needs_revision": "tertiary",
  "cancelled": "neutral",
  "draft": "neutral",
  "inactive": "neutral",
  "expired": "neutral"
} as const
export type StatusRole = 'success' | 'warning' | 'info' | 'error' | 'tertiary' | 'neutral'
export const TYPE_SCALE = {
  "displayLarge": {
    "size": 48,
    "line": 56,
    "weight": 700,
    "track": -0.5,
    "family": "display"
  },
  "headlineLarge": {
    "size": 32,
    "line": 40,
    "weight": 650,
    "track": -0.3,
    "family": "display"
  },
  "headlineMedium": {
    "size": 28,
    "line": 36,
    "weight": 650,
    "track": -0.2,
    "family": "display"
  },
  "headlineSmall": {
    "size": 24,
    "line": 32,
    "weight": 650,
    "track": -0.1,
    "family": "display"
  },
  "titleLarge": {
    "size": 22,
    "line": 28,
    "weight": 600,
    "track": 0,
    "family": "display"
  },
  "titleMedium": {
    "size": 16,
    "line": 24,
    "weight": 600,
    "track": 0.1,
    "family": "sans"
  },
  "titleSmall": {
    "size": 14,
    "line": 20,
    "weight": 600,
    "track": 0.1,
    "family": "sans"
  },
  "bodyLarge": {
    "size": 16,
    "line": 24,
    "weight": 400,
    "track": 0.2,
    "family": "sans"
  },
  "bodyMedium": {
    "size": 14,
    "line": 20,
    "weight": 400,
    "track": 0.2,
    "family": "sans"
  },
  "bodySmall": {
    "size": 12,
    "line": 16,
    "weight": 400,
    "track": 0.3,
    "family": "sans"
  },
  "labelLarge": {
    "size": 14,
    "line": 20,
    "weight": 600,
    "track": 0.1,
    "family": "sans"
  },
  "labelMedium": {
    "size": 12,
    "line": 16,
    "weight": 600,
    "track": 0.4,
    "family": "sans"
  },
  "labelSmall": {
    "size": 11,
    "line": 16,
    "weight": 600,
    "track": 0.5,
    "family": "sans"
  },
  "metricLarge": {
    "size": 36,
    "line": 40,
    "weight": 700,
    "track": -0.5,
    "family": "display",
    "tabular": true
  },
  "metricMedium": {
    "size": 28,
    "line": 32,
    "weight": 650,
    "track": -0.3,
    "family": "display",
    "tabular": true
  },
  "metricSmall": {
    "size": 20,
    "line": 24,
    "weight": 650,
    "track": -0.2,
    "family": "display",
    "tabular": true
  }
} as const
export type TypeStyle = keyof typeof TYPE_SCALE
export const BREAKPOINTS = {"compact":0,"medium":600,"expanded":840,"large":1200,"xlarge":1600} as const
export const DURATION_MS = {"instant":90,"fast":140,"base":220,"slow":320,"emphasized":450} as const
export const MIN_TARGET = {"touch":48,"pointer":40} as const

declare const __SDK_VERSION__: string | undefined;

/**
 * SDK version, injected from package.json at build time (tsup/vitest `define`).
 * Single source of truth: package.json.
 */
export const SDK_VERSION: string =
  typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown';

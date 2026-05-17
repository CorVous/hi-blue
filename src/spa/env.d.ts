/**
 * Type declarations for build-time globals injected by esbuild
 * (see scripts/build-spa.mjs `define`).
 */
declare const __WORKER_BASE_URL__: string;
declare const __COMMIT_SHA__: string;
declare const __COMMIT_TIMESTAMP_MS__: number;
declare const __VERSION__: string;
declare const __RELEASE_VERSION__: string | null;
declare const __LATEST_RELEASE_VERSION__: string | null;
declare const __DEV__: boolean;

/**
 * Side-effect CSS import type (consumed by esbuild's css loader).
 */
declare module "*.css";

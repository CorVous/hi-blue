/* Vite client type stubs — needed because tsconfig sets "types": [] which
   blocks automatic @types/ resolution. Only includes the subset used in
   browser-llm-provider.ts (import.meta.env.DEV). */
interface ImportMetaEnv {
	readonly DEV: boolean;
	readonly PROD: boolean;
	readonly MODE: string;
	readonly BASE_URL: string;
	readonly SSR: boolean;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

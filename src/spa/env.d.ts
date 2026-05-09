declare const __WORKER_BASE_URL__: string;
declare const __COMMIT_SHA__: string;
declare const __COMMIT_TIMESTAMP_MS__: number;

// Allow CSS side-effect imports processed by esbuild
declare module "*.css" {
	const _: string;
	export default _;
}

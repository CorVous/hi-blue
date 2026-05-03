declare const __WORKER_BASE_URL__: string;

// Allow CSS side-effect imports processed by esbuild
declare module "*.css" {
	const _: string;
	export default _;
}

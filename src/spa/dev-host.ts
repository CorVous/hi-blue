export function isDevHost(): boolean {
	return (
		typeof __WORKER_BASE_URL__ !== "undefined" &&
		__WORKER_BASE_URL__ === "http://localhost:8787" &&
		typeof location !== "undefined" &&
		location.origin === __WORKER_BASE_URL__
	);
}

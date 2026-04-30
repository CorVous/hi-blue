// Declare Workers KV bindings for the proxy worker.
// TypeScript merges this with the Cloudflare.Env interface so that
// `env` from `cloudflare:test` and `cloudflare:workers` is typed correctly.
declare namespace Cloudflare {
	interface Env {
		RATE_LIMIT_KV: KVNamespace;
	}
}

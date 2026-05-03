export type Renderer = (root: HTMLElement, params: URLSearchParams) => void;

const routes = new Map<string, Renderer>();

function parseHash(raw: string): { hash: string; params: URLSearchParams } {
	// Support "#/path?key=val" — split on "?"
	const qIdx = raw.indexOf("?");
	if (qIdx === -1) {
		return { hash: raw || "#/", params: new URLSearchParams() };
	}
	return {
		hash: raw.slice(0, qIdx) || "#/",
		params: new URLSearchParams(raw.slice(qIdx + 1)),
	};
}

function dispatch(rootEl: HTMLElement): void {
	const { hash, params } = parseHash(location.hash);
	const renderer = routes.get(hash) ?? routes.get("#/");
	if (renderer) {
		renderer(rootEl, params);
	}
}

export function registerRoute(hash: string, renderer: Renderer): void {
	routes.set(hash, renderer);
}

export function start(rootSelector = "main"): void {
	const rootEl = document.querySelector<HTMLElement>(rootSelector);
	if (!rootEl) {
		throw new Error(`router: root element "${rootSelector}" not found`);
	}
	window.addEventListener("hashchange", () => dispatch(rootEl));
	dispatch(rootEl);
}

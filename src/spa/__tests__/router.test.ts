import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("router", () => {
	beforeEach(() => {
		vi.resetModules();
		// Ensure a <main> element exists in the document
		document.body.innerHTML = "<main></main>";
		location.hash = "";
	});

	afterEach(() => {
		location.hash = "";
	});

	it("dispatches the #/ route on start()", async () => {
		const { registerRoute, start } = await import("../router.js");
		const renderer = vi.fn();
		registerRoute("#/", renderer);

		location.hash = "#/";
		start("main");

		expect(renderer).toHaveBeenCalledOnce();
		expect(renderer).toHaveBeenCalledWith(
			document.querySelector("main"),
			expect.any(URLSearchParams),
		);
	});

	it("dispatches on hashchange", async () => {
		const { registerRoute, start } = await import("../router.js");
		const renderer = vi.fn();
		registerRoute("#/", renderer);
		start("main");

		renderer.mockClear();
		window.dispatchEvent(new HashChangeEvent("hashchange"));

		expect(renderer).toHaveBeenCalledOnce();
	});

	it("falls back to #/ for unknown hashes", async () => {
		const { registerRoute, start } = await import("../router.js");
		const renderer = vi.fn();
		registerRoute("#/", renderer);

		location.hash = "#/unknown";
		start("main");

		expect(renderer).toHaveBeenCalledOnce();
	});

	it("throws when root element is not found", async () => {
		const { registerRoute, start } = await import("../router.js");
		registerRoute("#/", vi.fn());
		expect(() => start("#nonexistent")).toThrow(/root element/);
	});

	it("passes URLSearchParams parsed from hash query string", async () => {
		const { registerRoute, start } = await import("../router.js");
		const renderer = vi.fn();
		registerRoute("#/", renderer);

		location.hash = "#/?foo=bar&baz=qux";
		start("main");

		const params: URLSearchParams = renderer.mock
			.calls[0]?.[1] as URLSearchParams;
		expect(params.get("foo")).toBe("bar");
		expect(params.get("baz")).toBe("qux");
	});
});

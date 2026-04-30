import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

test("workers smoke", async () => {
	const response = await SELF.fetch("https://example.com");
	expect(await response.text()).toBe("ok");
});

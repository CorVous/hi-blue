import { expect, test } from "vitest";
import { SMOKE } from "./_smoke.js";

test("browser smoke", () => {
	expect(SMOKE).toBe("browser");
});

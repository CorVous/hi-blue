// Long-running Chromium server for the manual playtest.
// Launches Chromium, writes the WS endpoint to /tmp/playtest-ws, and stays up
// until killed. Drive it with `client.mjs <command>`.

import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const server = await chromium.launchServer({ headless: true });
writeFileSync("/tmp/playtest-ws", server.wsEndpoint(), "utf8");
console.log("Browser server ready at", server.wsEndpoint());

process.on("SIGINT", async () => {
	await server.close();
	process.exit(0);
});
process.on("SIGTERM", async () => {
	await server.close();
	process.exit(0);
});

// Keep the process alive.
setInterval(() => {}, 60_000);

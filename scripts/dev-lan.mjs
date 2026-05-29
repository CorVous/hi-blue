import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = 8787;

function detectLanIp() {
	const candidates = [];
	for (const addrs of Object.values(networkInterfaces())) {
		for (const addr of addrs ?? []) {
			if (addr.family !== "IPv4" || addr.internal) continue;
			candidates.push(addr.address);
		}
	}
	const preferred = candidates.find((ip) =>
		/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip),
	);
	return preferred ?? candidates[0];
}

const lanIp = detectLanIp();
if (!lanIp) {
	console.error(
		"Could not detect a LAN IP address — are you connected to a network?",
	);
	process.exit(1);
}

const workerBaseUrl = `http://${lanIp}:${PORT}`;
console.log(
	`Serving on all interfaces. Reach it from another device at: ${workerBaseUrl}`,
);

const child = spawn(
	"wrangler",
	["dev", "--local", "--ip", "0.0.0.0", "--port", String(PORT)],
	{
		stdio: "inherit",
		env: { ...process.env, WORKER_BASE_URL: workerBaseUrl },
	},
);

child.on("exit", (code) => process.exit(code ?? 0));

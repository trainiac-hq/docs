// A tiny, dependency-free HTTP server exposing the VIA coverage area in the
// Trainiac /v1 shape: every answer is JSON, every request is a GET, and CORS is
// wide open so it works straight from a browser. Run it with:
//
//   node src/server.ts            # live data from VIA
//   PORT=8787 node src/server.ts
//
// Node 22+ runs TypeScript directly, so there is no build step.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Network } from "./snapshot.ts";
import { route } from "./router.ts";

const here = dirname(fileURLToPath(import.meta.url));
const openapi = readFileSync(join(here, "..", "openapi.v1.json"), "utf8");

export function createApp(network = new Network()) {
	return createServer(async (req, res) => {
		const cors = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "*",
		};
		if (req.method === "OPTIONS") {
			res.writeHead(204, cors);
			res.end();
			return;
		}

		const url = new URL(req.url ?? "/", "http://localhost");

		// The contract document itself, served alongside the data.
		if (url.pathname === "/openapi.v1.json") {
			res.writeHead(200, { ...cors, "Content-Type": "application/json" });
			res.end(openapi);
			return;
		}

		try {
			const result = await route(req.method ?? "GET", url.pathname, url.searchParams, network);
			res.writeHead(result.status, {
				...cors,
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "public, max-age=30",
				"X-Request-Units": String(result.units),
				"X-Coverage-Area": "via-rail-canada",
			});
			res.end(JSON.stringify(result.body));
		} catch (err) {
			res.writeHead(500, { ...cors, "Content-Type": "application/json" });
			res.end(JSON.stringify({ type: "error", error: { type: "internal_error", message: "Unhandled error." } }));
			console.error(err);
		}
	});
}

// Start only when run directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const port = Number(process.env.PORT ?? 8787);
	const app = createApp();
	app.listen(port, () => {
		console.log(`trainiac-via listening on http://localhost:${port}`);
		console.log(`  try: http://localhost:${port}/v1/departures/Toronto`);
	});
}

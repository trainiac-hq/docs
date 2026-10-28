// Prints a sample of every endpoint, using the offline fixtures by default or
// live VIA data when run with `--live`. A quick way to eyeball the mapping.

import { Network } from "../src/snapshot.ts";
import { route } from "../src/router.ts";
import { offlineNetwork } from "../test/offline.ts";

const network = process.argv.includes("--live") ? new Network() : offlineNetwork();

async function show(title: string, path: string) {
	const url = new URL(`http://x${path}`);
	const res = await route("GET", url.pathname, url.searchParams, network);
	console.log(`\n\x1b[1m\x1b[33m${title}\x1b[0m  (${path})  → ${res.status}, ${res.units}u`);
	console.log(JSON.stringify(res.body, null, 2).split("\n").slice(0, 46).join("\n"));
}

await show("Index", "/v1");
await show("Status", "/v1/status");
await show("Summary", "/v1/summary");
await show("Station search", "/v1/stations?q=toronto");
await show("Departures from Toronto", "/v1/departures/Toronto?limit=3");
await show("Departures from Vancouver", "/v1/departures/Vancouver?limit=2");
await show("Journey Toronto → Montréal", "/v1/journey/Toronto/Montr%C3%A9al?limit=2");
await show("Train 1 (the Canadian)", "/v1/train?headcode=1");
await show("Delays", "/v1/delays?min_minutes=5&limit=5");
await show("Activity at Winnipeg", "/v1/stations/Winnipeg/activity?limit=3");
await show("Cancellations", "/v1/cancellations?limit=3");

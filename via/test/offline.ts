// Builds a Network backed by the saved fixtures (a GTFS zip and one capture of
// the live tracker), so tests and the demo run with no network access and give
// stable results.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Gtfs } from "../src/gtfs.ts";
import { Network } from "../src/snapshot.ts";
import { normalizeFeed, type LiveFeed } from "../src/live.ts";
import type { StationRef } from "../src/model.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function offlineGtfs(): Gtfs {
	return Gtfs.fromZip(readFileSync(join(here, "fixtures", "viarail-gtfs.zip")));
}

export function offlineNetwork(): Network {
	const gtfs = offlineGtfs();
	const raw = JSON.parse(readFileSync(join(here, "fixtures", "allData.sample.json"), "utf8"));
	return new Network({
		gtfs,
		live: async (registry: Map<string, StationRef>): Promise<LiveFeed> => {
			const fetchedAtMs = Date.now();
			const runs = normalizeFeed(raw, registry, fetchedAtMs);
			let newest = 0;
			for (const r of runs) if (r.live?.polledAt) newest = Math.max(newest, Date.parse(r.live.polledAt));
			return { runs, fetchedAt: new Date(fetchedAtMs).toISOString(), ageSeconds: newest ? Math.round((fetchedAtMs - newest) / 1000) : null };
		},
	});
}

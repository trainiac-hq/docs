// Builds and caches the network snapshot. GTFS is loaded once and refreshed
// daily; the live feed is polled on demand but cached briefly (a departure
// board does not change faster than the tracker updates). Live runs win over
// scheduled ones for the same train on the same day.

import { Gtfs } from "./gtfs.ts";
import { fetchLive, normalizeFeed, type LiveFeed } from "./live.ts";
import { dateInZone } from "./util/time.ts";
import { AGENCY_TZ, type Snapshot, type Run, type StationRef } from "./model.ts";

export type Sources = {
	/** Override for tests/offline: a pre-loaded GTFS. */
	gtfs?: Gtfs;
	/** Override for tests/offline: a function returning live runs. */
	live?: (registry: Map<string, StationRef>) => Promise<LiveFeed>;
	liveTtlMs?: number;
	gtfsTtlMs?: number;
};

const DEFAULT_LIVE_TTL = 30_000;
const DEFAULT_GTFS_TTL = 6 * 60 * 60 * 1000;

export class Network {
	private gtfs: Gtfs | null = null;
	private gtfsAt = 0;
	private liveCache: LiveFeed | null = null;
	private liveAt = 0;
	private liveInflight: Promise<LiveFeed> | null = null;
	private readonly sources: Sources;

	constructor(sources: Sources = {}) {
		this.sources = sources;
		if (sources.gtfs) {
			this.gtfs = sources.gtfs;
			this.gtfsAt = Date.now();
		}
	}

	private async ensureGtfs(): Promise<Gtfs> {
		const ttl = this.sources.gtfsTtlMs ?? DEFAULT_GTFS_TTL;
		if (this.gtfs && Date.now() - this.gtfsAt < ttl) return this.gtfs;
		if (this.sources.gtfs) return (this.gtfs = this.sources.gtfs); // fixed source, never expires
		const loaded = await Gtfs.load();
		this.gtfs = loaded;
		this.gtfsAt = Date.now();
		return loaded;
	}

	private async getLive(registry: Map<string, StationRef>): Promise<LiveFeed | null> {
		const ttl = this.sources.liveTtlMs ?? DEFAULT_LIVE_TTL;
		if (this.liveCache && Date.now() - this.liveAt < ttl) return this.liveCache;
		if (this.liveInflight) return this.liveInflight;
		const fetcher = this.sources.live ?? ((r: Map<string, StationRef>) => fetchLive(r));
		this.liveInflight = (async () => {
			try {
				const feed = await fetcher(registry);
				this.liveCache = feed;
				this.liveAt = Date.now();
				return feed;
			} finally {
				this.liveInflight = null;
			}
		})();
		try {
			return await this.liveInflight;
		} catch {
			// A live outage must not take the schedule down with it.
			return this.liveCache; // last good, or null
		}
	}

	/** Build the current snapshot. Live data is best-effort; GTFS is required. */
	async snapshot(): Promise<Snapshot> {
		const gtfs = await this.ensureGtfs();
		const registry = gtfs.byCode;
		const now = new Date();
		const today = dateInZone(now, AGENCY_TZ);

		const live = await this.getLive(registry);
		const liveRuns = live?.runs ?? [];

		// Schedule window: a few days back (to keep multi-day trains like the
		// Canadian) through two days forward (upcoming boards and journeys).
		const scheduled = gtfs.materializeWindow(today, 5, 2);

		// Live wins for a given (number, runDate); keep the rest of the schedule.
		const liveKeys = new Set(liveRuns.map((r) => `${r.number}:${r.runDate}`));
		const merged: Run[] = [...liveRuns];
		for (const r of scheduled) {
			if (!liveKeys.has(`${r.number}:${r.runDate}`)) merged.push(r);
		}

		return {
			stations: gtfs.stops,
			byCode: registry,
			runs: merged,
			liveFetchedAt: live?.fetchedAt ?? null,
			liveAgeSeconds: live?.ageSeconds ?? null,
			gtfsLoadedAt: gtfs.loadedAt,
			builtAt: now,
			agencyTz: AGENCY_TZ,
		};
	}

	get gtfsInfo() {
		return this.gtfs ? { start: this.gtfs.feedStart, end: this.gtfs.feedEnd, loadedAt: this.gtfs.loadedAt } : null;
	}
}

export { normalizeFeed };

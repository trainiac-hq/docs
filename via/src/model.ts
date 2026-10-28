// The internal, source-neutral shape of VIA's world. Both the GTFS schedule
// and the live tracker normalise into `Run`s made of `Call`s; the endpoints
// read only from here and never touch a raw feed. Field names echo the
// Trainiac contract so the mapping in `contract.ts` is almost mechanical.

/** A VIA station. `code` is VIA's four-letter code (e.g. VCVR); it occupies the contract's `crs` slot. */
export type StationRef = {
	code: string;
	name: string;
	tz: string;
	lat: number | null;
	lon: number | null;
};

/** One stop on one run. Times are absolute ISO strings with the stop's offset. */
export type Call = {
	station: StationRef;
	seq: number;
	/** Scheduled arrival at this stop, or null at the origin. */
	scheduledArrival: string | null;
	/** Scheduled departure from this stop, or null at the terminal. */
	scheduledDeparture: string | null;
	/** Live/expected arrival, or null when nothing live is known. */
	estimatedArrival: string | null;
	/** Live/expected departure, or null when nothing live is known. */
	estimatedDeparture: string | null;
	/** True once the train is known to have called here (estimate is an actual). */
	passed: boolean;
};

export type LiveState = {
	lat: number | null;
	lon: number | null;
	speed: number | null;
	direction: number | null;
	/** When the tracker last heard from the train. */
	polledAt: string | null;
	departed: boolean;
	arrived: boolean;
	/** Plain-English service alerts (English side of VIA's bilingual messages). */
	alerts: { header: string; description: string }[];
};

export type Run = {
	/** The VIA train number, e.g. "1", "52", "693". The contract's `headcode`. */
	number: string;
	/** Service date of the run's origin, YYYY-MM-DD. */
	runDate: string;
	/** Stable id: `<number>:<runDate>`. The contract's `train.id` / `train_id`. */
	id: string;
	/** Ticketing id, e.g. "VIA1". The contract's `train.uid`. null when unknown. */
	uid: string | null;
	/** Human route name from GTFS, e.g. "Toronto - Vancouver". */
	route: string | null;
	origin: StationRef | null;
	destination: StationRef | null;
	calls: Call[];
	live: LiveState | null;
	/** Set when an alert marks the run cancelled. */
	cancellation: { description: string } | null;
	source: "live" | "schedule";
};

/** A whole-network snapshot the endpoints answer from. */
export type Snapshot = {
	stations: StationRef[];
	byCode: Map<string, StationRef>;
	runs: Run[];
	/** When the live tracker feed used here was fetched. */
	liveFetchedAt: string | null;
	/** Age of the live feed in seconds at snapshot time, or null if unavailable. */
	liveAgeSeconds: number | null;
	/** When GTFS was last loaded. */
	gtfsLoadedAt: string;
	builtAt: Date;
	agencyTz: string;
};

export const OPERATOR = { code: "VIA", name: "VIA Rail" } as const;
export const AGENCY_TZ = "America/Toronto";

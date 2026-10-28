// VIA's live train tracker. One JSON document holds every train in a current
// window (recently finished, running now, and the next to depart), each with a
// GPS position and a full stop list carrying both scheduled and live times.
//
// Endpoint: https://tsimobile.viarail.ca/data/allData.json
//   key:   "1" or "1 (10-25)" when several instances of a number overlap
//   value: { from, to, departed, arrived, lat, lng, speed, direction, poll,
//            alerts[], times[] }
//   times[i]: { station, code, tz, scheduled, estimated,
//               arrival?: {scheduled, estimated}, departure?: {scheduled, estimated},
//               diffMin }

import { dateInZone } from "./util/time.ts";
import type { Run, Call, StationRef, LiveState } from "./model.ts";

const LIVE_URL = "https://tsimobile.viarail.ca/data/allData.json";

type LiveStopTime = { scheduled: string | null; estimated: string | null };
type LiveStop = {
	station: string;
	code: string;
	tz?: string;
	scheduled?: string | null;
	estimated?: string | null;
	arrival?: LiveStopTime;
	departure?: LiveStopTime;
	diffMin?: number;
};
type LiveTrain = {
	from?: string;
	to?: string;
	instance?: string;
	departed?: boolean;
	arrived?: boolean;
	lat?: number;
	lng?: number;
	speed?: number;
	direction?: number;
	poll?: string;
	alerts?: { header?: { en?: string }; description?: { en?: string } }[];
	times?: LiveStop[];
};
type AllData = Record<string, LiveTrain>;

export type LiveFeed = { runs: Run[]; fetchedAt: string; ageSeconds: number | null };

/** VIA uses "&mdash;" and "" for "no time". Normalise those to null. */
function cleanTime(v: string | null | undefined): string | null {
	if (!v) return null;
	if (v.includes("&") || v.trim() === "" || v === "-") return null;
	return v;
}

function titleCase(name: string): string {
	// Live `from`/`to` arrive SHOUTED ("VANCOUVER"); fall back to this when a
	// stop has no registry name. Keeps "(Jct.)" and accented letters intact.
	return name
		.toLowerCase()
		.replace(/(^|[\s(.'-])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());
}

const CANCEL = /\b(cancel|cancelled|annul)/i;

// VIA's `from`/`to` are SHOUTED names ("VANCOUVER") and are the train's true
// endpoints, but the live `times` list sometimes covers only the segment the
// tracker is actively following (the Canadian is streamed Toronto–Jasper). So
// we trust `times` for calling points, but resolve `from`/`to` to real stations
// for origin/destination when they don't match the ends of the list.
const nameIndexCache = new WeakMap<Map<string, StationRef>, Map<string, StationRef>>();

function normName(s: string): string {
	return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[().,'&/-]/g, " ").replace(/\s+/g, " ").trim();
}

function resolveName(registry: Map<string, StationRef>, shouted: string | undefined): StationRef | null {
	if (!shouted) return null;
	let idx = nameIndexCache.get(registry);
	if (!idx) {
		idx = new Map();
		for (const ref of registry.values()) {
			const n = normName(ref.name);
			if (!idx.has(n)) idx.set(n, ref);
		}
		nameIndexCache.set(registry, idx);
	}
	return idx.get(normName(shouted)) ?? null;
}

export function normalizeTrain(
	key: string,
	t: LiveTrain,
	registry: Map<string, StationRef>,
	nowMs: number,
): Run | null {
	const stops = t.times ?? [];
	if (stops.length < 2) return null;

	const number = key.replace(/\s*\(.*\)$/, "").trim();
	const pollIso = cleanTime(t.poll);
	const pollMs = pollIso ? Date.parse(pollIso) : nowMs;

	const alerts = (t.alerts ?? [])
		.map((a) => ({ header: (a.header?.en ?? "").trim(), description: (a.description?.en ?? "").trim() }))
		.filter((a) => a.header || a.description);
	const cancelled = alerts.find((a) => CANCEL.test(a.header) || CANCEL.test(a.description));

	const calls: Call[] = stops.map((s, i): Call => {
		const reg = registry.get(s.code);
		const station: StationRef = reg ?? {
			code: s.code,
			name: titleCase(s.station || s.code),
			tz: s.tz ?? "America/Toronto",
			lat: null,
			lon: null,
		};
		const schedArr = cleanTime(s.arrival?.scheduled) ?? (i > 0 ? cleanTime(s.scheduled) : null);
		const schedDep = cleanTime(s.departure?.scheduled) ?? (i < stops.length - 1 ? cleanTime(s.scheduled) : null);
		const estArr = cleanTime(s.arrival?.estimated) ?? (i > 0 ? cleanTime(s.estimated) : null);
		const estDep = cleanTime(s.departure?.estimated) ?? (i < stops.length - 1 ? cleanTime(s.estimated) : null);

		// A call has happened once its estimate is at or before the last poll,
		// or the whole train has arrived; an un-departed train has passed nothing.
		const refIso = estDep ?? estArr;
		const passed = t.arrived === true || (!!refIso && t.departed === true && Date.parse(refIso) <= pollMs);

		return {
			station,
			seq: i + 1,
			scheduledArrival: i === 0 ? null : schedArr,
			scheduledDeparture: i === stops.length - 1 ? null : schedDep,
			estimatedArrival: i === 0 ? null : estArr,
			estimatedDeparture: i === stops.length - 1 ? null : estDep,
			passed,
		};
	});

	const origin = resolveName(registry, t.from) ?? calls[0].station;
	const destination = resolveName(registry, t.to) ?? calls[calls.length - 1].station;

	// Run date: the service date of the origin departure, in the origin's zone.
	const originIso = calls[0].scheduledDeparture ?? calls[0].estimatedDeparture;
	const runDate = t.instance ?? (originIso ? dateInZone(new Date(Date.parse(originIso)), origin.tz) : dateInZone(new Date(nowMs), origin.tz));

	const live: LiveState = {
		lat: typeof t.lat === "number" ? t.lat : null,
		lon: typeof t.lng === "number" ? t.lng : null,
		speed: typeof t.speed === "number" ? t.speed : null,
		direction: typeof t.direction === "number" ? t.direction : null,
		polledAt: pollIso,
		departed: t.departed === true,
		arrived: t.arrived === true,
		alerts,
	};

	return {
		number,
		runDate,
		id: `${number}:${runDate}`,
		uid: `VIA${number}`,
		route: null,
		origin,
		destination,
		calls,
		live,
		cancellation: cancelled ? { description: cancelled.description || cancelled.header } : null,
		source: "live",
	};
}

export function normalizeFeed(data: AllData, registry: Map<string, StationRef>, fetchedAtMs: number): Run[] {
	const runs: Run[] = [];
	for (const [key, train] of Object.entries(data)) {
		if (!train || typeof train !== "object") continue;
		const run = normalizeTrain(key, train, registry, fetchedAtMs);
		if (run) runs.push(run);
	}
	return runs;
}

export async function fetchLive(registry: Map<string, StationRef>, url = LIVE_URL): Promise<LiveFeed> {
	const res = await fetch(url, { headers: { "User-Agent": "trainiac-via/0.1 (+https://traini.ac)" } });
	if (!res.ok) throw new Error(`live feed failed: HTTP ${res.status}`);
	const fetchedAtMs = Date.now();
	const data = (await res.json()) as AllData;
	const runs = normalizeFeed(data, registry, fetchedAtMs);
	// Feed age: newest poll among all trains tells us how fresh the source is.
	let newest = 0;
	for (const r of runs) {
		if (r.live?.polledAt) newest = Math.max(newest, Date.parse(r.live.polledAt));
	}
	const ageSeconds = newest ? Math.max(0, Math.round((fetchedAtMs - newest) / 1000)) : null;
	return { runs, fetchedAt: new Date(fetchedAtMs).toISOString(), ageSeconds };
}

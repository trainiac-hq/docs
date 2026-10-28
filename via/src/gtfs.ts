// Loads VIA's static GTFS: the authoritative station registry and the forward
// timetable. The live tracker only carries trains in a current window, so GTFS
// is what powers upcoming departures, journey planning and today's counts.
//
// Data © VIA Rail Canada, used under the Open Government Licence – Canada 2.0.

import { readZip } from "./util/zip.ts";
import { parseCsv } from "./util/csv.ts";
import { serviceMidnight, isoInZone, weekdayInZone, dateInZone } from "./util/time.ts";
import type { StationRef, Run, Call } from "./model.ts";
import { AGENCY_TZ } from "./model.ts";

const GTFS_URL = "https://www.viarail.ca/sites/all/files/gtfs/viarail.zip";

type Stop = {
	id: string;
	code: string;
	name: string;
	tz: string;
	lat: number | null;
	lon: number | null;
	locationType: string;
};
type Trip = {
	tripId: string;
	serviceId: string;
	number: string; // trip_short_name, e.g. "1"
	headsign: string;
	routeLong: string;
	ticketingId: string | null;
};
type StopTime = {
	tripId: string;
	seq: number;
	stopId: string;
	arrival: number | null; // seconds since service-date midnight
	departure: number | null;
};
type Service = {
	start: string; // YYYYMMDD
	end: string;
	days: boolean[]; // index 0..6 = Sun..Sat
};

const WEEKDAY_COLS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export class Gtfs {
	readonly stops: StationRef[];
	readonly byCode: Map<string, StationRef>;
	readonly loadedAt: string;
	readonly feedStart: string | null;
	readonly feedEnd: string | null;

	private readonly stopById: Map<string, Stop>;
	private readonly trips: Trip[];
	private readonly stopTimes: Map<string, StopTime[]>; // tripId -> ordered stop_times
	private readonly services: Map<string, Service>;

	private constructor(tables: Map<string, Record<string, string>[]>, loadedAt: string) {
		this.loadedAt = loadedAt;

		const stops = tables.get("stops.txt") ?? [];
		this.stopById = new Map();
		this.byCode = new Map();
		const registry: StationRef[] = [];
		for (const s of stops) {
			// location_type 0 or blank = a stop/platform; 1 = a station we also keep.
			const stop: Stop = {
				id: s.stop_id,
				code: s.stop_code || s.stop_id,
				name: s.stop_name,
				tz: s.stop_timezone || AGENCY_TZ,
				lat: s.stop_lat ? Number(s.stop_lat) : null,
				lon: s.stop_lon ? Number(s.stop_lon) : null,
				locationType: s.location_type || "0",
			};
			this.stopById.set(stop.id, stop);
			const ref: StationRef = { code: stop.code, name: stop.name, tz: stop.tz, lat: stop.lat, lon: stop.lon };
			// Prefer the first (or a boarding stop) for a given code.
			if (!this.byCode.has(stop.code)) {
				this.byCode.set(stop.code, ref);
				registry.push(ref);
			}
		}
		this.stops = registry;

		const routesById = new Map<string, string>();
		for (const r of tables.get("routes.txt") ?? []) routesById.set(r.route_id, r.route_long_name || r.route_short_name);

		this.trips = (tables.get("trips.txt") ?? []).map((t) => ({
			tripId: t.trip_id,
			serviceId: t.service_id,
			number: (t.trip_short_name || "").trim(),
			headsign: t.trip_headsign || "",
			routeLong: routesById.get(t.route_id) ?? "",
			ticketingId: t.ticketing_trip_id || null,
		}));

		this.stopTimes = new Map();
		for (const st of tables.get("stop_times.txt") ?? []) {
			const row: StopTime = {
				tripId: st.trip_id,
				seq: Number(st.stop_sequence),
				stopId: st.stop_id,
				arrival: toSeconds(st.arrival_time),
				departure: toSeconds(st.departure_time),
			};
			let arr = this.stopTimes.get(row.tripId);
			if (!arr) this.stopTimes.set(row.tripId, (arr = []));
			arr.push(row);
		}
		for (const arr of this.stopTimes.values()) arr.sort((a, b) => a.seq - b.seq);

		this.services = new Map();
		for (const c of tables.get("calendar.txt") ?? []) {
			this.services.set(c.service_id, {
				start: c.start_date,
				end: c.end_date,
				days: WEEKDAY_COLS.map((d) => c[d] === "1"),
			});
		}

		const feed = (tables.get("feed_info.txt") ?? [])[0];
		this.feedStart = feed?.feed_start_date ?? null;
		this.feedEnd = feed?.feed_end_date ?? null;
	}

	static async load(url = GTFS_URL): Promise<Gtfs> {
		const res = await fetch(url, { headers: { "User-Agent": "trainiac-via/0.1 (+https://traini.ac)" } });
		if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
		const buf = Buffer.from(await res.arrayBuffer());
		return Gtfs.fromZip(buf);
	}

	static fromZip(buf: Buffer): Gtfs {
		const entries = readZip(buf);
		const tables = new Map<string, Record<string, string>[]>();
		for (const [name, data] of entries) {
			if (name.endsWith(".txt")) tables.set(name, parseCsv(data.toString("utf8")));
		}
		return new Gtfs(tables, new Date().toISOString());
	}

	/** Does this service run on the given YYYY-MM-DD (agency local date)? */
	private runsOn(serviceId: string, isoDate: string, weekday: number): boolean {
		const svc = this.services.get(serviceId);
		if (!svc) return false;
		const ymd = isoDate.replace(/-/g, "");
		if (ymd < svc.start || ymd > svc.end) return false;
		return svc.days[weekday];
	}

	/**
	 * Materialise every trip that starts on `serviceDate` into a schedule-only
	 * `Run` with absolute, per-stop local times. Multi-day trips are anchored to
	 * agency-timezone midnight and each stop rendered in its own zone.
	 */
	materializeRuns(serviceDate: string): Run[] {
		const midnight = serviceMidnight(serviceDate, AGENCY_TZ);
		const weekday = weekdayInZone(midnight, AGENCY_TZ);
		const runs: Run[] = [];
		for (const trip of this.trips) {
			if (!trip.number) continue;
			if (!this.runsOn(trip.serviceId, serviceDate, weekday)) continue;
			const times = this.stopTimes.get(trip.tripId);
			if (!times || times.length === 0) continue;

			const calls: Call[] = [];
			for (const st of times) {
				const stop = this.stopById.get(st.stopId);
				if (!stop) continue;
				const station: StationRef = {
					code: stop.code,
					name: stop.name,
					tz: stop.tz,
					lat: stop.lat,
					lon: stop.lon,
				};
				calls.push({
					station,
					seq: st.seq,
					scheduledArrival: st.arrival === null ? null : isoInZone(new Date(midnight.getTime() + st.arrival * 1000), stop.tz),
					scheduledDeparture:
						st.departure === null ? null : isoInZone(new Date(midnight.getTime() + st.departure * 1000), stop.tz),
					estimatedArrival: null,
					estimatedDeparture: null,
					passed: false,
				});
			}
			if (calls.length < 2) continue;
			// An intermediate call shows only a departure in the board sense, but we
			// keep both scheduled arrival and departure; origin has no arrival and
			// terminal no departure, which we blank out for cleanliness.
			calls[0].scheduledArrival = null;
			calls[calls.length - 1].scheduledDeparture = null;

			runs.push({
				number: trip.number,
				runDate: serviceDate,
				id: `${trip.number}:${serviceDate}`,
				uid: trip.ticketingId ?? `VIA${trip.number}`,
				route: trip.routeLong || null,
				origin: calls[0].station,
				destination: calls[calls.length - 1].station,
				calls,
				live: null,
				cancellation: null,
				source: "schedule",
			});
		}
		return runs;
	}

	/** Materialise a window of service dates (used to catch multi-day trains still en route). */
	materializeWindow(centerDate: string, backDays: number, forwardDays: number): Run[] {
		const out: Run[] = [];
		for (let d = -backDays; d <= forwardDays; d++) {
			const date = shiftDate(centerDate, d);
			out.push(...this.materializeRuns(date));
		}
		return out;
	}
}

function toSeconds(hhmmss: string): number | null {
	if (!hhmmss) return null;
	const m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(hhmmss.trim());
	if (!m) return null;
	return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

function shiftDate(isoDate: string, days: number): string {
	const [y, mo, d] = isoDate.split("-").map(Number);
	const t = new Date(Date.UTC(y, mo - 1, d + days));
	return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export { dateInZone };

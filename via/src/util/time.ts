// Time helpers for a railway that spans six time zones.
//
// VIA's live feed already gives absolute ISO timestamps with offsets, so for
// live data we mostly pass those through. The GTFS schedule, though, gives a
// service date plus a seconds-since-midnight count (which can exceed 24h for
// multi-day trains like the Canadian). The rule, verified against the live
// feed to the minute across every zone, is:
//
//   instant = (agency-timezone midnight of the service date)
//             + (GTFS seconds, counted as elapsed real time)
//
// and each stop is then rendered in *its own* zone. Everything here is built
// on the ICU data Node ships with (`Intl`), so there are no dependencies.

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = partsCache.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		partsCache.set(timeZone, f);
	}
	return f;
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallParts(date: Date, timeZone: string): Wall {
	const o: Record<string, string> = {};
	for (const p of formatter(timeZone).formatToParts(date)) o[p.type] = p.value;
	return {
		year: +o.year,
		month: +o.month,
		day: +o.day,
		hour: +o.hour % 24,
		minute: +o.minute,
		second: +o.second,
	};
}

/** The zone's UTC offset, in minutes, for a given instant. */
export function offsetMinutes(date: Date, timeZone: string): number {
	const w = wallParts(date, timeZone);
	const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
	return Math.round((asUtc - date.getTime()) / 60000);
}

function pad(n: number, width = 2): string {
	return String(Math.abs(n)).padStart(width, "0");
}

/** Render an instant as ISO 8601 with the given zone's offset, e.g. 2026-10-05T14:26:00-04:00. */
export function isoInZone(date: Date, timeZone: string): string {
	const off = offsetMinutes(date, timeZone);
	const w = wallParts(date, timeZone);
	const sign = off >= 0 ? "+" : "-";
	const oh = pad(Math.trunc(Math.abs(off) / 60));
	const om = pad(Math.abs(off) % 60);
	return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${sign}${oh}:${om}`;
}

/**
 * The instant at which a wall-clock time occurs in a zone. Resolves the DST
 * ambiguity by refining the offset once, which is correct everywhere except
 * the one hour a year that does not exist (we bias forward, as transit does).
 */
export function wallToInstant(
	timeZone: string,
	year: number,
	month: number,
	day: number,
	hour = 0,
	minute = 0,
	second = 0,
): Date {
	const guess = Date.UTC(year, month - 1, day, hour, minute, second);
	let off = offsetMinutes(new Date(guess), timeZone);
	let inst = guess - off * 60000;
	const off2 = offsetMinutes(new Date(inst), timeZone);
	if (off2 !== off) inst = guess - off2 * 60000;
	return new Date(inst);
}

/** Agency-timezone midnight of a service date (YYYY-MM-DD), as an instant. */
export function serviceMidnight(serviceDate: string, agencyTz: string): Date {
	const [y, m, d] = serviceDate.split("-").map(Number);
	return wallToInstant(agencyTz, y, m, d, 0, 0, 0);
}

/** "YYYY-MM-DD" for an instant in a zone. */
export function dateInZone(date: Date, timeZone: string): string {
	const w = wallParts(date, timeZone);
	return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Day of week 0..6 (Sun..Sat) for an instant in a zone. */
export function weekdayInZone(date: Date, timeZone: string): number {
	const w = wallParts(date, timeZone);
	// Zeller-free: build a UTC date from the wall parts and read its weekday.
	return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

/** Parse an "HH:MM" or "HHMM" time of day. Returns minutes past midnight, or null. */
export function parseClock(value: string): number | null {
	const m = /^([0-2]?\d):?([0-5]\d)$/.exec(value.trim());
	if (!m) return null;
	const h = +m[1];
	const mi = +m[2];
	if (h > 23) return null;
	return h * 60 + mi;
}

/** Whole minutes between two instants, b - a. */
export function diffMinutes(a: Date, b: Date): number {
	return Math.round((b.getTime() - a.getTime()) / 60000);
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(serviceDate: string, days: number): string {
	const [y, m, d] = serviceDate.split("-").map(Number);
	const t = new Date(Date.UTC(y, m - 1, d + days));
	return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

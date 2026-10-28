import type { DeparturesRequest, Departure, CallingPoint, ApiError } from "../v1.d.ts";
import type { Ctx } from "../context.ts";
import { delayReason } from "../context.ts";
import { place, train, departTime, arriveTime, platformUnknown, departInstant } from "../contract.ts";
import { parseClock, wallToInstant, dateInZone } from "../util/time.ts";
import type { Run, Call } from "../model.ts";

export type DeparturesParams = {
	station: string;
	limit: number;
	fromTime: string | null;
	toTime: string | null;
	callingAt: string | null;
};

export function departures(
	ctx: Ctx,
	params: DeparturesParams,
): { request: DeparturesRequest; data: Departure[] } | { error: ApiError } {
	const resolved = ctx.reg.resolve(params.station, ctx.callsByCode);
	if (resolved.kind === "ambiguous")
		return { error: { type: "station_ambiguous", parameter: "station", query: params.station, candidates: resolved.candidates, message: `'${params.station}' matches more than one station.` } };
	if (resolved.kind === "not_found")
		return { error: { type: "station_not_found", parameter: "station", query: params.station, did_you_mean: resolved.didYouMean, message: `No station matched '${params.station}'.` } };

	const codes = new Set(resolved.stations.map((s) => s.code));
	const anchorTz = resolved.stations[0].tz;
	const today = dateInZone(ctx.now, anchorTz);
	const fromMs = clockToMs(params.fromTime, today, anchorTz) ?? ctx.now.getTime();
	const toMs = clockToMs(params.toTime, today, anchorTz);

	let callingAtCodes: Set<string> | null = null;
	let callingAtArg: DeparturesRequest["calling_at"] = null;
	if (params.callingAt) {
		const ca = ctx.reg.resolve(params.callingAt, ctx.callsByCode);
		if (ca.kind === "ambiguous")
			return { error: { type: "station_ambiguous", parameter: "calling_at", query: params.callingAt, candidates: ca.candidates, message: `'${params.callingAt}' matches more than one station.` } };
		if (ca.kind === "not_found")
			return { error: { type: "station_not_found", parameter: "calling_at", query: params.callingAt, did_you_mean: ca.didYouMean, message: `No station matched '${params.callingAt}'.` } };
		callingAtCodes = new Set(ca.stations.map((s) => s.code));
		callingAtArg = { query: params.callingAt, resolution: ca.resolution };
	}

	const rows: { dep: Departure; sort: number }[] = [];
	for (const run of ctx.snap.runs) {
		for (let i = 0; i < run.calls.length - 1; i++) {
			const call = run.calls[i];
			if (!codes.has(call.station.code)) continue;
			if (!call.scheduledDeparture && !call.estimatedDeparture) continue; // terminal, never departs

			const later = run.calls.slice(i + 1);
			if (callingAtCodes && !later.some((c) => callingAtCodes!.has(c.station.code))) continue;

			const when = departInstant(call);
			if (when < fromMs) continue; // already gone (late trains kept via estimate)
			if (toMs !== null && when > toMs) continue;

			rows.push({ dep: toDeparture(run, i, later), sort: when });
		}
	}
	rows.sort((a, b) => a.sort - b.sort);

	const request: DeparturesRequest = {
		station: { query: params.station, resolution: resolved.resolution },
		calling_at: callingAtArg,
		from_time: params.fromTime,
		to_time: params.toTime,
		limit: params.limit,
	};
	return { request, data: rows.slice(0, params.limit).map((r) => r.dep) };
}

function toDeparture(run: Run, index: number, later: Call[]): Departure {
	const call = run.calls[index];
	const cancelled = run.cancellation !== null;
	const last = run.calls[run.calls.length - 1];

	const calling_points: CallingPoint[] = later.map((c) => ({
		station: place(c.station),
		time: c.scheduledArrival ? arriveTime(c, cancelled) : departTime(c, cancelled),
		platform: platformUnknown(),
	}));

	return {
		train: train(run),
		service_class: "passenger",
		origin: place(run.origin!),
		destination: place(run.destination!),
		departs: departTime(call, cancelled),
		platform: platformUnknown(),
		calling_points,
		destination_arrival: last.scheduledArrival ?? null,
		coaches: null,
		formation_changes: [],
		formed_from: null,
		delay_reason: delayReason(run),
		advertised: true,
	};
}

function clockToMs(hhmm: string | null, isoDate: string, tz: string): number | null {
	if (!hhmm) return null;
	const mins = parseClock(hhmm);
	if (mins === null) return null;
	const [y, mo, d] = isoDate.split("-").map(Number);
	return wallToInstant(tz, y, mo, d, Math.floor(mins / 60), mins % 60, 0).getTime();
}

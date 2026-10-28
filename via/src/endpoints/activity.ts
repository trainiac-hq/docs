import type { ActivityRequest, Movement, ApiError } from "../v1.d.ts";
import type { Ctx } from "../context.ts";
import { place, platformUnknown } from "../contract.ts";

/** What actually happened at a station in the last three hours, newest first. */
export function activity(
	ctx: Ctx,
	stationQuery: string,
	limit: number,
): { request: ActivityRequest; data: Movement[] } | { error: ApiError } {
	const resolved = ctx.reg.resolve(stationQuery, ctx.callsByCode);
	if (resolved.kind === "ambiguous")
		return { error: { type: "station_ambiguous", parameter: "station", query: stationQuery, candidates: resolved.candidates, message: `'${stationQuery}' matches more than one station.` } };
	if (resolved.kind === "not_found")
		return { error: { type: "station_not_found", parameter: "station", query: stationQuery, did_you_mean: resolved.didYouMean, message: `No station matched '${stationQuery}'.` } };

	const codes = new Set(resolved.stations.map((s) => s.code));
	const since = ctx.now.getTime() - 3 * 60 * 60 * 1000;
	const rows: { mv: Movement; at: number }[] = [];

	for (const run of ctx.snap.runs) {
		for (const call of run.calls) {
			if (!codes.has(call.station.code) || !call.passed) continue;
			// Each actual arrival and departure is its own movement.
			for (const [iso, sched, event] of [
				[call.estimatedArrival, call.scheduledArrival, "arrival"] as const,
				[call.estimatedDeparture, call.scheduledDeparture, "departure"] as const,
			]) {
				if (!iso) continue;
				const at = Date.parse(iso);
				if (at < since || at > ctx.now.getTime()) continue;
				rows.push({
					at,
					mv: {
						train: { id: run.id, headcode: run.number },
						location: place(call.station),
						event,
						time: {
							scheduled: sched ?? iso,
							estimate: { type: "actual", at: iso },
							delay_minutes: sched ? Math.round((at - Date.parse(sched)) / 60000) : 0,
						},
						platform: platformUnknown(),
						off_route: false,
					},
				});
			}
		}
	}

	rows.sort((a, b) => b.at - a.at);
	return {
		request: { station: { query: stationQuery, resolution: resolved.resolution }, limit },
		data: rows.slice(0, limit).map((r) => r.mv),
	};
}

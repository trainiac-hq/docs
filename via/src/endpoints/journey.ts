import type { JourneyRequest, Journey, Leg, Connection, Time, ApiError } from "../v1.d.ts";
import type { Ctx } from "../context.ts";
import { place, train, departTime, arriveTime, platformUnknown } from "../contract.ts";
import { parseClock, wallToInstant, dateInZone } from "../util/time.ts";
import type { Run, Call } from "../model.ts";

export type JourneyParams = {
	from: string;
	to: string;
	limit: number;
	maxChanges: number;
	minInterchangeMin: number;
	fromTime: string | null;
	toTime: string | null;
};

const SEARCH_WINDOW_MS = 48 * 60 * 60 * 1000; // look two days ahead for connections
const MAX_CANDIDATES = 400; // hard cap so a bad query can never run away

type Segment = { run: Run; board: Call; alight: Call };

export function journey(
	ctx: Ctx,
	params: JourneyParams,
): { request: JourneyRequest; data: Journey[] } | { error: ApiError } {
	const from = ctx.reg.resolve(params.from, ctx.callsByCode);
	if (from.kind === "ambiguous")
		return { error: { type: "station_ambiguous", parameter: "from", query: params.from, candidates: from.candidates, message: `'${params.from}' matches more than one station.` } };
	if (from.kind === "not_found")
		return { error: { type: "station_not_found", parameter: "from", query: params.from, did_you_mean: from.didYouMean, message: `No station matched '${params.from}'.` } };

	const to = ctx.reg.resolve(params.to, ctx.callsByCode);
	if (to.kind === "ambiguous")
		return { error: { type: "station_ambiguous", parameter: "to", query: params.to, candidates: to.candidates, message: `'${params.to}' matches more than one station.` } };
	if (to.kind === "not_found")
		return { error: { type: "station_not_found", parameter: "to", query: params.to, did_you_mean: to.didYouMean, message: `No station matched '${params.to}'.` } };

	const fromCodes = new Set(from.stations.map((s) => s.code));
	const toCodes = new Set(to.stations.map((s) => s.code));
	if ([...fromCodes].every((c) => toCodes.has(c)) && fromCodes.size === toCodes.size)
		return { error: { type: "same_station", message: "from and to are the same station." } };

	const anchorTz = from.stations[0].tz;
	const today = dateInZone(ctx.now, anchorTz);
	const earliest = clockToMs(params.fromTime, today, anchorTz) ?? ctx.now.getTime();
	const latest = clockToMs(params.toTime, today, anchorTz);

	// Index boardable calls by station code, sorted by departure time.
	const boardable = new Map<string, { run: Run; call: Call; depMs: number }[]>();
	for (const run of ctx.snap.runs) {
		for (let i = 0; i < run.calls.length - 1; i++) {
			const call = run.calls[i];
			const dep = call.scheduledDeparture ?? call.estimatedDeparture;
			if (!dep) continue;
			const depMs = Date.parse(call.estimatedDeparture ?? call.scheduledDeparture!);
			const arr = boardable.get(call.station.code) ?? [];
			arr.push({ run, call, depMs });
			boardable.set(call.station.code, arr);
		}
	}
	for (const arr of boardable.values()) arr.sort((a, b) => a.depMs - b.depMs);

	const results: { journey: Journey; departMs: number }[] = [];
	const maxChanges = Math.min(params.maxChanges, 2); // VIA's network rarely needs more

	const search = (codes: Set<string>, notBefore: number, changesLeft: number, chain: Segment[]) => {
		if (results.length >= MAX_CANDIDATES) return;
		for (const code of codes) {
			for (const opt of boardable.get(code) ?? []) {
				if (opt.depMs < notBefore) continue;
				if (opt.depMs > earliest + SEARCH_WINDOW_MS) break; // sorted: nothing later qualifies
				if (chain.some((s) => s.run === opt.run)) continue; // don't reuse a train

				const boardIdx = opt.run.calls.indexOf(opt.call);
				for (let j = boardIdx + 1; j < opt.run.calls.length; j++) {
					const alight = opt.run.calls[j];
					if (!alight.scheduledArrival && !alight.estimatedArrival) continue;
					const seg: Segment = { run: opt.run, board: opt.call, alight };

					if (toCodes.has(alight.station.code)) {
						pushJourney(results, [...chain, seg], latest, params.minInterchangeMin);
					} else if (changesLeft > 0) {
						const arrMs = Date.parse(alight.estimatedArrival ?? alight.scheduledArrival!);
						search(new Set([alight.station.code]), arrMs + params.minInterchangeMin * 60000, changesLeft - 1, [...chain, seg]);
					}
					if (results.length >= MAX_CANDIDATES) return;
				}
			}
		}
	};
	search(fromCodes, earliest, maxChanges, []);

	// Rank by departure, then fewest changes, then earliest arrival, so a direct
	// train is always preferred over a contrived multi-leg trip that leaves at the
	// same time. Then drop dominated options (one that leaves no earlier, arrives
	// no later and needs no more changes makes the other pointless) and exact
	// duplicates.
	const annotated = results.map((r) => ({
		...r,
		arriveMs: Date.parse(arriveIso(r.journey)),
		changes: r.journey.type === "direct" ? 0 : r.journey.legs.length - 1,
		key: journeyKey(r.journey),
	}));
	annotated.sort((a, b) => a.departMs - b.departMs || a.changes - b.changes || a.arriveMs - b.arriveMs);

	const seen = new Set<string>();
	const kept: typeof annotated = [];
	const data: Journey[] = [];
	for (const r of annotated) {
		if (seen.has(r.key)) continue;
		const dominated = kept.some((k) => k.departMs >= r.departMs && k.arriveMs <= r.arriveMs && k.changes <= r.changes);
		if (dominated) continue;
		seen.add(r.key);
		kept.push(r);
		data.push(r.journey);
		if (data.length >= params.limit) break;
	}

	const request: JourneyRequest = {
		from: { query: params.from, resolution: from.resolution },
		to: { query: params.to, resolution: to.resolution },
		limit: params.limit,
		max_changes: params.maxChanges,
		min_interchange_min: params.minInterchangeMin,
		from_time: params.fromTime,
		to_time: params.toTime,
	};
	return { request, data };
}

function pushJourney(out: { journey: Journey; departMs: number }[], chain: Segment[], latest: number | null, minInterchange: number): void {
	const first = chain[0];
	const departMs = Date.parse(first.board.estimatedDeparture ?? first.board.scheduledDeparture!);
	if (latest !== null && departMs > latest) return;

	const legs = chain.map(toLeg);
	const departs = legs[0].departs;
	const arrives = legs[legs.length - 1].arrives;
	const durationMinutes = Math.round((Date.parse(estAt(arrives)) - Date.parse(estAt(departs))) / 60000);

	if (chain.length === 1) {
		out.push({ journey: { type: "direct", departs, arrives, duration_minutes: durationMinutes, leg: legs[0] }, departMs });
		return;
	}
	const connections: Connection[] = [];
	for (let i = 0; i < chain.length - 1; i++) connections.push(connection(chain[i], chain[i + 1], minInterchange));
	out.push({
		journey: { type: "with_changes", departs, arrives, duration_minutes: durationMinutes, legs, connections },
		departMs,
	});
}

function toLeg(seg: Segment): Leg {
	const cancelled = seg.run.cancellation !== null;
	return {
		train: train(seg.run),
		service_class: "passenger",
		from: place(seg.board.station),
		departs: departTime(seg.board, cancelled),
		departure_platform: platformUnknown(),
		to: place(seg.alight.station),
		arrives: arriveTime(seg.alight, cancelled),
		arrival_platform: platformUnknown(),
		coaches: null,
	};
}

function connection(a: Segment, b: Segment, minInterchange: number): Connection {
	const arrSched = a.alight.scheduledArrival ?? a.alight.scheduledDeparture!;
	const depSched = b.board.scheduledDeparture ?? b.board.scheduledArrival!;
	const scheduledGap = Math.round((Date.parse(depSched) - Date.parse(arrSched)) / 60000);

	const arrEst = a.alight.estimatedArrival ?? a.alight.estimatedDeparture;
	const depEst = b.board.estimatedDeparture ?? b.board.estimatedArrival;

	let outlook: Connection["outlook"];
	if (a.run.cancellation || b.run.cancellation) {
		outlook = "unknown";
	} else if (arrEst && depEst) {
		// Live running on both sides: is enough time still left to change?
		const liveGap = Math.round((Date.parse(depEst) - Date.parse(arrEst)) / 60000);
		outlook = liveGap < minInterchange ? "at_risk" : "safe";
	} else if (arrEst || depEst) {
		outlook = "unknown"; // one side is live, the other is not: can't be sure
	} else {
		outlook = "safe"; // purely timetabled, nothing says otherwise
	}
	return { at: place(a.alight.station), minutes: scheduledGap, outlook };
}

const estAt = (t: Time): string => (t.estimate.type === "actual" || t.estimate.type === "forecast" ? t.estimate.at : t.scheduled);

const arriveIso = (j: Journey): string => estAt(j.arrives);

function journeyKey(j: Journey): string {
	const legs = j.type === "direct" ? [j.leg] : j.legs;
	return legs.map((l) => `${l.train.headcode}@${l.from?.type === "station" ? l.from.crs : "?"}>${l.to.type === "station" ? l.to.crs : "?"}`).join("|");
}

function clockToMs(hhmm: string | null, isoDate: string, tz: string): number | null {
	if (!hhmm) return null;
	const mins = parseClock(hhmm);
	if (mins === null) return null;
	const [y, mo, d] = isoDate.split("-").map(Number);
	return wallToInstant(tz, y, mo, d, Math.floor(mins / 60), mins % 60, 0).getTime();
}

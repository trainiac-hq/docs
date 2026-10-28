import type { DelaysRequest, DelayedTrain } from "../v1.d.ts";
import type { Ctx } from "../context.ts";
import { place, train } from "../contract.ts";
import type { Run, Call } from "../model.ts";

export type DelaysParams = { minMinutes: number; limit: number; passengerOnly: boolean };

/** The most-delayed trains running right now, worst first. */
export function delays(ctx: Ctx, params: DelaysParams): { request: DelaysRequest; data: DelayedTrain[] } {
	const rows: { d: DelayedTrain; delay: number }[] = [];

	for (const run of ctx.snap.runs) {
		if (!run.live || !run.live.departed || run.live.arrived) continue; // running only
		const { delay, last } = currentDelay(run);
		if (delay < params.minMinutes) continue;

		const seenIso = last.estimatedDeparture ?? last.estimatedArrival ?? last.scheduledDeparture ?? last.scheduledArrival!;
		rows.push({
			delay,
			d: {
				train: train(run),
				service_class: "passenger",
				origin: run.origin ? place(run.origin) : null,
				destination: run.destination ? place(run.destination) : null,
				delay_minutes: delay,
				off_route: false,
				last_seen: { location: place(last.station), at: seenIso },
			},
		});
	}

	rows.sort((a, b) => b.delay - a.delay);
	return {
		request: { min_minutes: params.minMinutes, limit: params.limit, passenger_only: params.passengerOnly },
		data: rows.slice(0, params.limit).map((r) => r.d),
	};
}

/** Delay at the last call the train made, and that call. */
function currentDelay(run: Run): { delay: number; last: Call } {
	const passed = run.calls.filter((c) => c.passed);
	const last = passed.length ? passed[passed.length - 1] : run.calls[0];
	const at = last.estimatedDeparture ?? last.estimatedArrival;
	const sched = last.scheduledDeparture ?? last.scheduledArrival;
	const delay = at && sched ? Math.round((Date.parse(at) - Date.parse(sched)) / 60000) : 0;
	return { delay, last };
}

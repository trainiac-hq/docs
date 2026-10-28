import type { Summary } from "../v1.d.ts";
import type { Ctx } from "../context.ts";
import { dateInZone } from "../util/time.ts";

/** Today's headline numbers across the VIA network. */
export function summary(ctx: Ctx): Summary {
	const today = dateInZone(ctx.now, ctx.snap.agencyTz);
	const nowMs = ctx.now.getTime();

	let scheduled = 0;
	let started = 0;
	let runningNow = 0;
	let onTimeCalls = 0;
	let totalCalls = 0;
	let latenessSum = 0;
	let movements = 0;

	for (const run of ctx.snap.runs) {
		if (run.runDate !== today) continue;
		scheduled++;
		if (run.live?.departed) started++;
		if (run.live?.departed && !run.live.arrived) runningNow++;

		for (const call of run.calls) {
			if (!call.passed) continue;
			for (const [iso, sched] of [
				[call.estimatedArrival, call.scheduledArrival] as const,
				[call.estimatedDeparture, call.scheduledDeparture] as const,
			]) {
				if (!iso || !sched) continue;
				const at = Date.parse(iso);
				if (dateInZone(new Date(at), ctx.snap.agencyTz) !== today) continue;
				movements++;
				const delay = Math.round((at - Date.parse(sched)) / 60000);
				totalCalls++;
				latenessSum += delay;
				if (delay <= 0) onTimeCalls++;
			}
		}
	}

	const cancelled = ctx.snap.runs.filter((r) => r.runDate === today && r.cancellation).length;

	return {
		service_date: today,
		scheduled,
		started,
		running_now: { count: runningNow, window_minutes: 30 },
		cancelled: { total: cancelled, planned: 0 },
		punctuality: {
			on_time_percent: totalCalls ? round1((onTimeCalls / totalCalls) * 100) : 100,
			definition:
				"share of calls today whose live time was at or before the timetabled time, to the minute",
			average_lateness_minutes: totalCalls ? round2(latenessSum / totalCalls) : 0,
		},
		movement_reports_today: movements,
	};
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

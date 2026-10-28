import type { TrainRequest, TrainRun, Progress, Report } from "../v1.d.ts";
import type { Ctx } from "../context.ts";
import { place, train, platformUnknown } from "../contract.ts";
import type { Run, Call } from "../model.ts";

export type TrainParams = {
	headcode: string | null;
	trainId: string | null;
	operator: string | null;
	origin: string | null;
	destination: string | null;
	date: string | null;
};

/** Where one train is. Matches by id (exact) or number (may return several runs). */
export function trainLookup(ctx: Ctx, params: TrainParams): { request: TrainRequest; data: TrainRun[] } {
	let runs: Run[];
	if (params.trainId) {
		runs = ctx.snap.runs.filter((r) => r.id === params.trainId);
	} else {
		const hc = params.headcode!.trim();
		runs = ctx.snap.runs.filter((r) => r.number === hc);
	}

	if (params.operator) runs = runs.filter((r) => r.uid?.toUpperCase().includes(params.operator!.toUpperCase()) || params.operator!.toUpperCase() === "VIA");
	if (params.origin) runs = runs.filter((r) => matchStation(r.origin?.code, r.origin?.name, params.origin!));
	if (params.destination) runs = runs.filter((r) => matchStation(r.destination?.code, r.destination?.name, params.destination!));
	if (params.date) runs = runs.filter((r) => r.runDate === params.date);

	// Most recently departed first, like the contract's "most recently seen first".
	runs = [...runs].sort((a, b) => originInstant(b) - originInstant(a)).slice(0, 10);

	const data = runs.map((r) => toTrainRun(r));
	const request: TrainRequest = {
		headcode: params.headcode,
		train_id: params.trainId,
		operator: params.operator,
		origin: params.origin,
		destination: params.destination,
		date: params.date,
	};
	return { request, data };
}

function toTrainRun(run: Run): TrainRun {
	const progress = computeProgress(run);
	return {
		train: train(run),
		run_date: run.runDate,
		origin: run.origin ? place(run.origin) : null,
		destination: run.destination ? place(run.destination) : null,
		progress,
	};
}

function computeProgress(run: Run): Progress {
	const live = run.live;
	if (!live || (!live.departed && !live.arrived)) {
		const first = run.calls[0];
		const last = run.calls[run.calls.length - 1];
		return {
			type: "not_started",
			activated: run.source === "live",
			departs: first.scheduledDeparture ?? first.estimatedDeparture ?? first.scheduledArrival!,
			arrives: last.scheduledArrival ?? last.scheduledDeparture ?? null,
		};
	}

	const last_report = lastReport(run);
	return live.arrived ? { type: "finished", last_report } : { type: "running", last_report };
}

/** The last call the train is known to have made. */
function lastReport(run: Run): Report {
	const passed = run.calls.filter((c) => c.passed);
	const call = passed.length ? passed[passed.length - 1] : run.calls[0];
	const departed = !!call.estimatedDeparture;
	const at = call.estimatedDeparture ?? call.estimatedArrival ?? call.scheduledDeparture ?? call.scheduledArrival!;
	const sched = departed ? call.scheduledDeparture ?? call.scheduledArrival : call.scheduledArrival ?? call.scheduledDeparture;
	const delay = sched ? Math.round((Date.parse(at) - Date.parse(sched)) / 60000) : 0;
	return {
		location: place(call.station),
		at,
		event: departed ? "departure" : "arrival",
		delay_minutes: delay,
		off_route: false,
		platform: platformUnknown(),
	};
}

function originInstant(run: Run): number {
	const iso = run.calls[0].scheduledDeparture ?? run.calls[0].estimatedDeparture;
	return iso ? Date.parse(iso) : 0;
}

function matchStation(code: string | undefined, name: string | undefined, query: string): boolean {
	const q = query.trim().toLowerCase();
	return (code ?? "").toLowerCase() === q || (name ?? "").toLowerCase().includes(q);
}

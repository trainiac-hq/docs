import type { CancellationsRequest, Cancellation, CancellationKind } from "../v1.d.ts";
import type { Ctx } from "../context.ts";
import { place, train } from "../contract.ts";
import type { Run } from "../model.ts";

/**
 * Today's cancellations. VIA signals these through service alerts rather than a
 * structured feed, so the reason carries the alert text; the Delay Attribution
 * code/category/planned fields have no VIA equivalent and are filled honestly.
 */
export function cancellations(
	ctx: Ctx,
	params: { limit: number; passengerOnly: boolean },
): { request: CancellationsRequest; data: Cancellation[] } {
	const rows: { c: Cancellation; at: number }[] = [];

	for (const run of ctx.snap.runs) {
		if (!run.cancellation || !run.live) continue;
		const kind = cancelKind(run);
		const reportedIso = run.live.polledAt ?? run.calls[0].scheduledDeparture ?? ctx.now.toISOString();
		rows.push({
			at: Date.parse(reportedIso),
			c: {
				train: train(run),
				service_class: "passenger",
				origin: run.origin ? place(run.origin) : null,
				destination: run.destination ? place(run.destination) : null,
				cancelled: kind,
				reason: { code: "VIA", description: run.cancellation.description, category: "VIA service alert", planned: false },
				reported_at: reportedIso,
				keyed_at: reportedIso,
			},
		});
	}

	rows.sort((a, b) => b.at - a.at);
	return {
		request: { limit: params.limit, passenger_only: params.passengerOnly },
		data: rows.slice(0, params.limit).map((r) => r.c),
	};
}

function cancelKind(run: Run): CancellationKind {
	const passed = run.calls.filter((c) => c.passed);
	if (!run.live?.departed || passed.length === 0) {
		return { type: "before_departure", at: place(run.origin ?? run.calls[0].station) };
	}
	return { type: "part_way", at: place(passed[passed.length - 1].station) };
}

// Per-request view over a snapshot: the registry for resolving stations and a
// "calls today" tally used both to rank ambiguous names and to fill the
// stations endpoint's calls_today.

import { Registry } from "./stations.ts";
import { dateInZone } from "./util/time.ts";
import type { Snapshot, Run, Call } from "./model.ts";

export type Ctx = {
	snap: Snapshot;
	reg: Registry;
	callsByCode: Map<string, number>;
	now: Date;
};

export function buildContext(snap: Snapshot): Ctx {
	const reg = new Registry(snap.stations);
	const today = dateInZone(snap.builtAt, snap.agencyTz);
	const callsByCode = new Map<string, number>();
	for (const run of snap.runs) {
		const seen = new Set<string>();
		for (const call of run.calls) {
			const iso = call.scheduledDeparture ?? call.scheduledArrival;
			if (!iso) continue;
			if (dateInZone(new Date(Date.parse(iso)), snap.agencyTz) !== today) continue;
			if (seen.has(call.station.code)) continue;
			seen.add(call.station.code);
			callsByCode.set(call.station.code, (callsByCode.get(call.station.code) ?? 0) + 1);
		}
	}
	return { snap, reg, callsByCode, now: snap.builtAt };
}

/** The first non-advisory alert, as a one-line reason, or null. */
export function delayReason(run: Run): string | null {
	if (!run.live) return null;
	for (const a of run.live.alerts) {
		if (/general advisory|tracking system|recommends/i.test(a.header)) continue;
		const text = a.header || a.description;
		if (text) return text.replace(/\s+/g, " ").trim();
	}
	return null;
}

/** Is a call strictly after another in the same run? */
export function callAfter(run: Run, fromSeq: number): Call[] {
	return run.calls.filter((c) => c.seq > fromSeq);
}

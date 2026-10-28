// Maps an HTTP request to an endpoint, validates query parameters the way the
// contract specifies (ranges, time/int formats, at-least-one-of), and wraps the
// result in the standard envelope with the right status code and unit cost.

import type { Network } from "./snapshot.ts";
import { buildContext } from "./context.ts";
import { ok, errorResponse, errors, ERROR_STATUS } from "./contract.ts";
import type { ApiError } from "./v1.d.ts";
import { parseClock } from "./util/time.ts";

import { index } from "./endpoints/index.ts";
import { departures } from "./endpoints/departures.ts";
import { journey } from "./endpoints/journey.ts";
import { trainLookup } from "./endpoints/train.ts";
import { stations } from "./endpoints/stations.ts";
import { activity } from "./endpoints/activity.ts";
import { delays } from "./endpoints/delays.ts";
import { cancellations } from "./endpoints/cancellations.ts";
import { summary } from "./endpoints/summary.ts";
import { status } from "./endpoints/status.ts";

export type RouteResult = { status: number; body: unknown; units: number };

function fail(error: ApiError, units = 1): RouteResult {
	return { status: ERROR_STATUS[error.type], body: errorResponse(error), units };
}

/** Parse an integer query param within [min,max], or return a typed error. */
function intParam(
	raw: string | null,
	name: string,
	def: number,
	min: number,
	max: number,
): { value: number } | { error: ApiError } {
	if (raw === null) return { value: def };
	if (!/^-?\d+$/.test(raw)) return { error: errors.invalid(name, raw, "integer") };
	const n = Number(raw);
	if (n < min || n > max) return { error: errors.outOfRange(name, n, min, max) };
	return { value: n };
}

function boolParam(raw: string | null, name: string, def: boolean): { value: boolean } | { error: ApiError } {
	if (raw === null) return { value: def };
	if (raw === "true") return { value: true };
	if (raw === "false") return { value: false };
	return { error: errors.invalid(name, raw, "boolean") };
}

function timeParam(raw: string | null, name: string): { value: string | null } | { error: ApiError } {
	if (raw === null) return { value: null };
	if (parseClock(raw) === null) return { error: errors.invalid(name, raw, "time") };
	return { value: raw };
}

export async function route(
	method: string,
	pathname: string,
	query: URLSearchParams,
	network: Network,
): Promise<RouteResult> {
	if (method !== "GET") return fail(errors.methodNotAllowed());

	const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["v1","departures","PAD"]

	// The bare root serves the index too, so "/" is a friendly landing page.
	if (parts.length === 0) {
		let snap0;
		try {
			snap0 = await network.snapshot();
		} catch {
			return fail(errors.databaseUnavailable());
		}
		return { status: 200, body: ok({}, index(), snap0.builtAt), units: 1 };
	}
	if (parts[0] !== "v1") return fail(errors.notFound());

	let snap;
	try {
		snap = await network.snapshot();
	} catch {
		return fail(errors.databaseUnavailable());
	}
	const ctx = buildContext(snap);
	const now = ctx.now;

	// /v1
	if (parts.length === 1) return { status: 200, body: ok({}, index(), now), units: 1 };

	const section = parts[1];

	if (section === "departures") {
		const stationArg = decodeURIComponent(parts[2] ?? "");
		if (!stationArg) return fail(errors.notFound(), 3);
		const limit = intParam(query.get("limit"), "limit", 15, 1, 100);
		if ("error" in limit) return fail(limit.error, 3);
		const fromT = timeParam(query.get("from_time"), "from_time");
		if ("error" in fromT) return fail(fromT.error, 3);
		const toT = timeParam(query.get("to_time"), "to_time");
		if ("error" in toT) return fail(toT.error, 3);
		const res = departures(ctx, {
			station: stationArg,
			limit: limit.value,
			fromTime: fromT.value,
			toTime: toT.value,
			callingAt: query.get("calling_at"),
		});
		if ("error" in res) return fail(res.error, 3);
		return { status: 200, body: ok(res.request, res.data, now), units: 3 };
	}

	if (section === "journey") {
		const fromArg = decodeURIComponent(parts[2] ?? "");
		const toArg = decodeURIComponent(parts[3] ?? "");
		if (!fromArg || !toArg) return fail(errors.notFound(), 5);
		const limit = intParam(query.get("limit"), "limit", 10, 1, 100);
		if ("error" in limit) return fail(limit.error, 5);
		const maxChanges = intParam(query.get("max_changes"), "max_changes", 1, 0, 8);
		if ("error" in maxChanges) return fail(maxChanges.error, 5);
		const minInt = intParam(query.get("min_interchange_min"), "min_interchange_min", 5, 1, 60);
		if ("error" in minInt) return fail(minInt.error, 5);
		const fromT = timeParam(query.get("from_time"), "from_time");
		if ("error" in fromT) return fail(fromT.error, 5);
		const toT = timeParam(query.get("to_time"), "to_time");
		if ("error" in toT) return fail(toT.error, 5);
		const units = maxChanges.value === 0 ? 2 : 5;
		const res = journey(ctx, {
			from: fromArg,
			to: toArg,
			limit: limit.value,
			maxChanges: maxChanges.value,
			minInterchangeMin: minInt.value,
			fromTime: fromT.value,
			toTime: toT.value,
		});
		if ("error" in res) return fail(res.error, units);
		return { status: 200, body: ok(res.request, res.data, now), units };
	}

	if (section === "train") {
		const headcode = query.get("headcode");
		const trainId = query.get("train_id");
		if (!headcode && !trainId) return fail(errors.missing(["headcode", "train_id"]));
		const res = trainLookup(ctx, {
			headcode,
			trainId,
			operator: query.get("operator"),
			origin: query.get("origin"),
			destination: query.get("destination"),
			date: query.get("date"),
		});
		if (res.data.length === 0) return fail(errors.trainNotFound());
		return { status: 200, body: ok(res.request, res.data, now), units: 1 };
	}

	if (section === "stations" && parts.length === 2) {
		const q = query.get("q") ?? "";
		const res = stations(ctx, q);
		return { status: 200, body: ok(res.request, res.data, now), units: 1 };
	}

	// /v1/stations/{station}/activity
	if (section === "stations" && parts[3] === "activity") {
		const stationArg = decodeURIComponent(parts[2] ?? "");
		const limit = intParam(query.get("limit"), "limit", 15, 1, 100);
		if ("error" in limit) return fail(limit.error);
		const res = activity(ctx, stationArg, limit.value);
		if ("error" in res) return fail(res.error);
		return { status: 200, body: ok(res.request, res.data, now), units: 1 };
	}

	if (section === "delays") {
		const minMinutes = intParam(query.get("min_minutes"), "min_minutes", 10, 0, 1000);
		if ("error" in minMinutes) return fail(minMinutes.error);
		const limit = intParam(query.get("limit"), "limit", 15, 1, 100);
		if ("error" in limit) return fail(limit.error);
		const passengerOnly = boolParam(query.get("passenger_only"), "passenger_only", true);
		if ("error" in passengerOnly) return fail(passengerOnly.error);
		const res = delays(ctx, { minMinutes: minMinutes.value, limit: limit.value, passengerOnly: passengerOnly.value });
		return { status: 200, body: ok(res.request, res.data, now), units: 1 };
	}

	if (section === "cancellations") {
		const limit = intParam(query.get("limit"), "limit", 15, 1, 100);
		if ("error" in limit) return fail(limit.error);
		const passengerOnly = boolParam(query.get("passenger_only"), "passenger_only", false);
		if ("error" in passengerOnly) return fail(passengerOnly.error);
		const res = cancellations(ctx, { limit: limit.value, passengerOnly: passengerOnly.value });
		return { status: 200, body: ok(res.request, res.data, now), units: 1 };
	}

	if (section === "summary") return { status: 200, body: ok({}, summary(ctx), now), units: 1 };
	if (section === "status") return { status: 200, body: ok({}, status(ctx), now), units: 1 };

	return fail(errors.notFound());
}

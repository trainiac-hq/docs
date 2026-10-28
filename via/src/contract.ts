// The bridge from VIA's internal model to the published Trainiac /v1 types.
// Every value a VIA feed can't supply (platforms, Darwin forecasts, coach
// counts) maps to the contract's honest "we don't know" member rather than a
// guess, exactly as the contract intends.

import type {
	Place,
	Operator,
	Time,
	Estimate,
	Platform,
	Train,
	ApiError,
	ErrorResponse,
} from "./v1.d.ts";
import { OPERATOR, type Run, type Call, type StationRef } from "./model.ts";

export const operator = (): Operator => ({ code: OPERATOR.code, name: OPERATOR.name });

export const place = (s: StationRef): Place => ({ type: "station", crs: s.code, name: s.name });

/** No VIA source carries platform/track, so every platform is honestly unknown. */
export const platformUnknown = (): Platform => ({ type: "unknown" });

export function estimate(scheduled: string, estimated: string | null, passed: boolean, cancelled: boolean): Estimate {
	if (cancelled) return { type: "cancelled" };
	if (estimated) {
		return passed
			? { type: "actual", at: estimated }
			: { type: "forecast", at: estimated, source: "live_report" };
	}
	return { type: "no_information" };
}

function delayMinutes(scheduled: string, est: Estimate): number | null {
	if (est.type === "actual" || est.type === "forecast") {
		return Math.round((Date.parse(est.at) - Date.parse(scheduled)) / 60000);
	}
	return null;
}

export function time(scheduled: string, estimated: string | null, passed: boolean, cancelled: boolean): Time {
	const est = estimate(scheduled, estimated, passed, cancelled);
	return { scheduled, estimate: est, delay_minutes: delayMinutes(scheduled, est) };
}

/** The departure Time at a call (origin/intermediate). */
export function departTime(call: Call, cancelled: boolean): Time {
	const sched = call.scheduledDeparture ?? call.scheduledArrival!;
	return time(sched, call.estimatedDeparture ?? call.estimatedArrival, call.passed, cancelled);
}

/** The arrival Time at a call (intermediate/terminal). */
export function arriveTime(call: Call, cancelled: boolean): Time {
	const sched = call.scheduledArrival ?? call.scheduledDeparture!;
	return time(sched, call.estimatedArrival ?? call.estimatedDeparture, call.passed, cancelled);
}

export function train(run: Run): Train {
	return {
		id: run.source === "live" ? run.id : null, // null until it shows up live, like TRUST activation
		uid: run.uid,
		headcode: run.number,
		operator: operator(),
	};
}

/** The best single instant a call represents, for sorting/filtering. */
export function departInstant(call: Call): number {
	const iso = call.estimatedDeparture ?? call.scheduledDeparture ?? call.estimatedArrival ?? call.scheduledArrival;
	return iso ? Date.parse(iso) : Number.POSITIVE_INFINITY;
}

// ---- the envelope ---------------------------------------------------------

export type Ok<Req, Data> = { type: "ok"; request: Req; data: Data; generated_at: string };

export function ok<Req, Data>(request: Req, data: Data, generatedAt: Date): Ok<Req, Data> {
	return { type: "ok", request, data, generated_at: generatedAt.toISOString() };
}

export function errorResponse(error: ApiError): ErrorResponse {
	return { type: "error", error };
}

/** HTTP status for each error the contract defines. */
export const ERROR_STATUS: Record<ApiError["type"], number> = {
	station_not_found: 404,
	station_ambiguous: 400,
	same_station: 400,
	parameter_out_of_range: 400,
	invalid_parameter: 400,
	missing_parameter: 400,
	train_not_found: 404,
	not_found: 404,
	method_not_allowed: 405,
	rate_limited: 429,
	database_busy: 503,
	database_unavailable: 503,
	query_failed: 503,
	status_unavailable: 503,
	internal_error: 500,
};

// Typed error constructors --------------------------------------------------

type Station = { crs: string; name: string };

export const errors = {
	stationNotFound: (parameter: string, query: string, didYouMean: Station[]): ApiError => ({
		type: "station_not_found",
		parameter,
		query,
		did_you_mean: didYouMean,
		message: `No station matched '${query}'.`,
	}),
	stationAmbiguous: (parameter: string, query: string, candidates: Station[]): ApiError => ({
		type: "station_ambiguous",
		parameter,
		query,
		candidates,
		message: `'${query}' (${parameter}) matches more than one station. Ask again with one of the candidates' codes.`,
	}),
	sameStation: (): ApiError => ({ type: "same_station", message: "from and to are the same station." }),
	outOfRange: (parameter: string, value: number, min: number, max: number): ApiError => ({
		type: "parameter_out_of_range",
		parameter,
		value,
		min,
		max,
		message: `${parameter} must be between ${min} and ${max}; got ${value}.`,
	}),
	invalid: (parameter: string, value: string, expected: "integer" | "boolean" | "time" | "date" | "headcode"): ApiError => ({
		type: "invalid_parameter",
		parameter,
		value,
		expected,
		message: `${parameter} must be a ${expected}; got '${value}'.`,
	}),
	missing: (parameters: string[]): ApiError => ({
		type: "missing_parameter",
		parameters,
		message: `Give at least one of: ${parameters.join(", ")}.`,
	}),
	trainNotFound: (): ApiError => ({ type: "train_not_found", message: "No such train in the last 12 hours or today's timetable." }),
	notFound: (): ApiError => ({ type: "not_found", message: "No such endpoint." }),
	methodNotAllowed: (): ApiError => ({ type: "method_not_allowed", message: "Only GET is allowed." }),
	internal: (): ApiError => ({ type: "internal_error", message: "Something went wrong on our side." }),
	databaseUnavailable: (): ApiError => ({ type: "database_unavailable", message: "The data could not be loaded." }),
};

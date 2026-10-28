// Proves the VIA adapter speaks the Trainiac /v1 contract: every response,
// success or error, is validated against the published openapi.v1.json with a
// strict validator that rejects missing required keys, wrong types and
// unexpected properties. Runs entirely offline from the fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { route } from "../src/router.ts";
import { Validator } from "../src/validate.ts";
import { offlineNetwork } from "./offline.ts";

const here = dirname(fileURLToPath(import.meta.url));
const openapi = JSON.parse(readFileSync(join(here, "..", "openapi.v1.json"), "utf8"));
const validator = new Validator(openapi);
const network = offlineNetwork();

async function call(path: string) {
	const url = new URL(`http://x${path}`);
	return route("GET", url.pathname, url.searchParams, network);
}

function assertValid(schema: string, body: unknown) {
	const errs = validator.validate(schema, body);
	assert.equal(errs.length, 0, `expected valid ${schema}:\n  ${errs.join("\n  ")}`);
}

const okCases: [name: string, path: string, schema: string][] = [
	["index", "/v1", "IndexResponse"],
	["status", "/v1/status", "StatusResponse"],
	["summary", "/v1/summary", "SummaryResponse"],
	["stations", "/v1/stations?q=toronto", "StationsResponse"],
	["stations near-miss", "/v1/stations?q=zzqqxx", "StationsResponse"],
	["departures (code)", "/v1/departures/TRTO?limit=5", "DeparturesResponse"],
	["departures (name)", "/v1/departures/Vancouver?limit=5", "DeparturesResponse"],
	["departures (calling_at)", "/v1/departures/Toronto?calling_at=Kingston&limit=5", "DeparturesResponse"],
	["journey direct", "/v1/journey/Toronto/Montr%C3%A9al?max_changes=0", "JourneyResponse"],
	["journey with changes", "/v1/journey/Toronto/Ottawa?max_changes=1", "JourneyResponse"],
	["train by headcode", "/v1/train?headcode=1", "TrainResponse"],
	["train by id", "/v1/train?train_id=2:2026-10-26", "TrainResponse"],
	["delays", "/v1/delays?min_minutes=0&limit=20", "DelaysResponse"],
	["cancellations", "/v1/cancellations?limit=10", "CancellationsResponse"],
	["activity", "/v1/stations/Winnipeg/activity?limit=10", "ActivityResponse"],
];

for (const [name, path, schema] of okCases) {
	test(`200 ${name} conforms to ${schema}`, async () => {
		const res = await call(path);
		assert.equal(res.status, 200, `status for ${path}: ${JSON.stringify(res.body)}`);
		assert.equal((res.body as any).type, "ok");
		assertValid(schema, res.body);
	});
}

const errorCases: [name: string, path: string, status: number, errorType: string][] = [
	["station not found", "/v1/departures/Nowheresville", 404, "station_not_found"],
	["invalid limit", "/v1/departures/Toronto?limit=abc", 400, "invalid_parameter"],
	["limit out of range", "/v1/departures/Toronto?limit=9999", 400, "parameter_out_of_range"],
	["invalid time", "/v1/departures/Toronto?from_time=25:99", 400, "invalid_parameter"],
	["train missing params", "/v1/train", 400, "missing_parameter"],
	["train not found", "/v1/train?headcode=9999", 404, "train_not_found"],
	["same station", "/v1/journey/Toronto/Toronto", 400, "same_station"],
	["unknown endpoint", "/v1/nonsense", 404, "not_found"],
];

for (const [name, path, status, errorType] of errorCases) {
	test(`error ${name} → ${status} ${errorType}`, async () => {
		const res = await call(path);
		assert.equal(res.status, status, `status for ${path}: ${JSON.stringify(res.body)}`);
		assert.equal((res.body as any).type, "error");
		assert.equal((res.body as any).error.type, errorType);
		assertValid("ErrorResponse", res.body);
	});
}

test("method not allowed → 405", async () => {
	const res = await route("POST", "/v1/summary", new URLSearchParams(), network);
	assert.equal(res.status, 405);
	assertValid("ErrorResponse", res.body);
});

test("request units match the contract", async () => {
	assert.equal((await call("/v1/summary")).units, 1);
	assert.equal((await call("/v1/departures/Toronto")).units, 3);
	assert.equal((await call("/v1/journey/Toronto/Ottawa")).units, 5);
	assert.equal((await call("/v1/journey/Toronto/Ottawa?max_changes=0")).units, 2);
});

test("every station resolves to itself by its own code", async () => {
	const res = await call("/v1/stations?q=Jasper");
	const body = res.body as any;
	assert.equal(body.data.resolves_to.crs, "JASP");
});

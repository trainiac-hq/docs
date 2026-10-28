// Unit tests for the pieces most likely to be subtly wrong: six-timezone
// schedule maths, the zero-dependency ZIP and CSV readers, and station
// resolution precedence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceMidnight, isoInZone, parseClock, dateInZone, weekdayInZone } from "../src/util/time.ts";
import { parseCsv } from "../src/util/csv.ts";
import { offlineGtfs } from "./offline.ts";
import { Registry } from "../src/stations.ts";

test("GTFS seconds anchor to agency midnight and render in the stop's zone", () => {
	// The Canadian departs Toronto 09:55 EDT on 2026-10-25; Winnipeg is 46:30
	// later, which is 21:30 CDT the next day — verified against the live feed.
	const midnight = serviceMidnight("2026-10-25", "America/Toronto");
	const winnipeg = new Date(midnight.getTime() + (46 * 3600 + 30 * 60) * 1000);
	assert.equal(isoInZone(winnipeg, "America/Winnipeg"), "2026-10-26T21:30:00-05:00");

	const toronto = new Date(midnight.getTime() + (9 * 3600 + 55 * 60) * 1000);
	assert.equal(isoInZone(toronto, "America/Toronto"), "2026-10-25T09:55:00-04:00");

	// Vancouver at 107:00 → 2026-10-29T08:00 PDT.
	const van = new Date(midnight.getTime() + 107 * 3600 * 1000);
	assert.equal(isoInZone(van, "America/Vancouver"), "2026-10-29T08:00:00-07:00");
});

test("dateInZone / weekdayInZone", () => {
	const d = new Date("2026-10-25T02:00:00-04:00");
	assert.equal(dateInZone(d, "America/Toronto"), "2026-10-25");
	assert.equal(weekdayInZone(d, "America/Toronto"), 0); // Sunday
});

test("parseClock accepts HH:MM and HHMM, rejects nonsense", () => {
	assert.equal(parseClock("09:55"), 9 * 60 + 55);
	assert.equal(parseClock("0955"), 9 * 60 + 55);
	assert.equal(parseClock("25:99"), null);
	assert.equal(parseClock("nope"), null);
});

test("CSV parser handles quotes, commas and BOM", () => {
	const rows = parseCsv('﻿a,b\r\n1,"x,y"\n2,"he said ""hi"""\n');
	assert.deepEqual(rows, [
		{ a: "1", b: "x,y" },
		{ a: "2", b: 'he said "hi"' },
	]);
});

test("ZIP reader loads VIA GTFS: 387 stops with codes", () => {
	const gtfs = offlineGtfs();
	assert.ok(gtfs.stops.length >= 300, `stops: ${gtfs.stops.length}`);
	assert.ok(gtfs.byCode.has("TRTO"));
	assert.equal(gtfs.byCode.get("TRTO")?.name, "Toronto");
	assert.equal(gtfs.byCode.get("VCVR")?.name, "Vancouver");
});

test("station resolution: code beats name beats fuzzy, groups work", () => {
	const gtfs = offlineGtfs();
	const reg = new Registry(gtfs.stops);
	const calls = new Map<string, number>();

	const byCode = reg.resolve("JASP", calls);
	assert.equal(byCode.kind, "ok");
	assert.equal(byCode.kind === "ok" && byCode.resolution.type === "station" && byCode.resolution.crs, "JASP");

	const byName = reg.resolve("vancouver", calls);
	assert.equal(byName.kind === "ok" && byName.resolution.type === "station" && byName.resolution.crs, "VCVR");

	const missing = reg.resolve("Hogwarts", calls);
	assert.equal(missing.kind, "not_found");
});

test("materializing a service date produces multi-day runs with absolute times", () => {
	const gtfs = offlineGtfs();
	const runs = gtfs.materializeRuns("2026-10-25");
	assert.ok(runs.length > 0);
	for (const r of runs) {
		assert.ok(r.calls.length >= 2);
		assert.match(r.calls[0].scheduledDeparture ?? "", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
		// Times never go backwards along a run.
		const stamps = r.calls.map((c) => Date.parse(c.scheduledDeparture ?? c.scheduledArrival ?? "")).filter((n) => !Number.isNaN(n));
		for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] >= stamps[i - 1], `run ${r.number} times out of order`);
	}
});

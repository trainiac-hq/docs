# Moving from `/api` to `/v1`

`/api` keeps working exactly as it does today until it is removed, which
will be once its last users have moved. `/v1` is the same data, the same query parameters, the same limits and the
same costs, with answers shaped for code: one envelope, a `type` on
everything that can be one of several things, every key always present,
and proper station names.

The quick version: change `/api/` to `/v1/` in your URLs, then read
`body.data` instead of `body.results`, and check `body.type` instead of
`res.ok` plus `body.error`.

## The envelope

| `/api` | `/v1` |
| --- | --- |
| `{generated_at, resolved, results, result_count}` | `{type: "ok", request, data, generated_at}` |
| `results` (always a list) | `data` (a list, or one object for `summary`, `stations` and `status`) |
| `result_count` | `data.length` |
| `resolved.station: {name, crs}` / `{name, group, stations}` | `request.station: {query, resolution: {type: "station", crs, name} \| {type: "group", name, stations}}` |
| `resolved.note` | gone: the shape says it (`progress.type`, `near_misses`) |
| an error: `{error: "station ambiguous", candidates, hint}` | `{type: "error", error: {type: "station_ambiguous", parameter, query, candidates, message}}` |

Every `/v1` error has a stable `error.type`; the full list is in the
README. `"station ambiguous"`, `"destination station not resolved"` and
friends become `station_ambiguous` / `station_not_found` with
`parameter: "to"` saying which end.

## Values that changed shape everywhere

| `/api` | `/v1` |
| --- | --- |
| `"PADDINGTON LONDON"`, or `{name: "PADDINGTON LONDON", crs: "PAD"}` | `{type: "station", crs: "PAD", name: "London Paddington"}`, or `{type: "location", name}` for a junction or siding |
| `"operator": "Great Western Railway"` | `"operator": {code: "GW", name: "Great Western Railway"}` |
| `"service_class": "empty stock"` | `"empty_stock"` |
| `departs` + `expected_departs` + `status` + `status_text` + `data_source` + `lateness_minutes` | `departs: {scheduled, estimate, delay_minutes}` |
| `expected_departs: null` (could mean several things) | `estimate.type`: `no_information`, `delayed_no_estimate` or `cancelled` |
| `status: "departed"` | `estimate: {type: "actual", at}` |
| `data_source: "darwin forecast"` / `"live report"` | `estimate: {type: "forecast", source: "darwin" \| "live_report"}` |
| `platform` + `platform_source` + `platform_withheld` | `platform: {type: "known", number, source: "actual" \| "forecast" \| "timetable"} \| {type: "withheld"} \| {type: "unknown"}` |
| `headcode`, `train_id`, `train_uid`, `operator` side by side | `train: {id, uid, headcode, operator}` |
| `variation_status: "OFF ROUTE"` | `off_route: true` (lateness is already signed) |
| `event_type: "ARRIVAL"` | `event: "arrival"` |

There is no `status_text`: build the sentence from `estimate`, which is now
unambiguous.

`platform_source: "live report"` is `source: "actual"`, `"darwin forecast"`
is `"forecast"`. A withheld platform no longer carries its number.

## Per endpoint

**Departures.** `results[i]` → `data[i]`. `arrives` → `destination_arrival`.
`calling_points[i]` → `{station, time, platform}` (`scheduled`/`expected`
are `time.scheduled`/`time.estimate`). `late_reason` → `delay_reason`.
`not_for_display` → `advertised` (inverted). `formation_changes[i]` →
`{type: "divides" | "joins", at}` (the `note` sentence is gone).
`is_activated` is gone: `train.id` is set once it is.

**Journey.** `changes: 0` → `type: "direct"` with one `leg`; `changes: 1`
and `2+` → `type: "with_changes"` with `legs` and `connections`. The
`leg1_*`/`leg2_*` and `origin_platform`/`interchange_*_platform` prefixes
become fields of each leg (`from`, `departs`, `departure_platform`, `to`,
`arrives`, `arrival_platform`). `interchange` + `connection_minutes` +
`connection_status` → `connections[i]: {at, minutes, outlook}`, with
`"ok"` → `"safe"` and `"at risk"` → `"at_risk"`. `arrival_station` is the
last leg's `to`. `expected_arrives` is `arrives.estimate`.

**Train.** One shape for both cases, told apart by `progress.type`:
`not_started` (was "found in the timetable", with `departs`, `arrives` and
`activated`), `running`, or `finished` (was `is_terminated: true`).
`last_location`, `last_event`, `last_seen`, `lateness_minutes` →
`progress.last_report: {location, event, at, delay_minutes, off_route,
platform}`. `advertised_platform`/`reported_platform`/`platform_conflict`
→ `last_report.platform` (Darwin's advertised one when it has one).
`minutes_since_report` is gone: compare `last_report.at` with
`generated_at`.

**Station search.** `results[i]` → `data.matches[i]`, either
`{type: "station", crs, name, …}` or `{type: "location", kind: "depot" |
"infrastructure" | "other", name, …}`. `description` → `name` (readable).
`calls` → `calls_today`. `resolved.resolves_to` → `data.resolves_to`.
The "closest names" note → `data.near_misses: true`.

**Station activity.** `planned`/`actual`/`lateness_minutes` →
`time: {scheduled, estimate: {type: "actual", at}, delay_minutes}`.
`location` → a `Place`.

**Delays.** `lateness_minutes` → `delay_minutes`; `last_location` +
`last_seen` → `last_seen: {location, at}`; `origin`/`destination` are
`Place`s.

**Cancellations.** `canx_type` → `cancelled.type`: `AT ORIGIN` →
`before_departure`, `EN ROUTE` → `part_way`, `ON CALL` → `not_needed`,
`OUT OF PLAN` → `off_booked_path`, with `location` as `cancelled.at`.
`canx_reason_code`, `reason`, `reason_category`, `planned` →
`reason: {code, description, category, planned}`. `input_at` → `keyed_at`.
`passenger_only` works the same.

**Summary.** No longer a one-row list: `data` is the object.
`running_now` + `running_window_min` → `running_now: {count,
window_minutes}`; `cancelled` + `cancelled_planned` → `cancelled: {total,
planned}`; `on_time_pct`, `on_time_definition`, `avg_lateness_min` →
`punctuality: {on_time_percent, definition, average_lateness_minutes}`;
`movement_events_today` → `movement_reports_today`.

**Status.** Inside the envelope now. `status` → `health`;
`feeds.x.state` + `last_stored_seconds_ago` → `feeds.x.freshness:
{type: "fresh" | "stale", last_stored_seconds_ago} | {type: "silent"} |
{type: "unknown"}`; `trains_running: null` → `{type: "unknown"}`.

**Positions and the live map** stay under `/api`.

## A before and after

```ts
// /api
const r = await fetch("https://api.traini.ac/api/departures/PAD?limit=5");
const b = await r.json();
if (!r.ok) throw new Error(b.error);
for (const d of b.results) console.log(d.headcode, d.status_text, d.destination.name);

// /v1
import type { Answer } from "./v1";
const v = (await (await fetch("https://api.traini.ac/v1/departures/PAD?limit=5")).json()) as Answer<"/v1/departures/{station}">;
if (v.type === "error") throw new Error(v.error.message);
for (const d of v.data) {
  const e = d.departs.estimate;
  const status = e.type === "forecast" ? `Expected ${e.at.slice(11, 16)}`
    : e.type === "actual" ? `Departed ${e.at.slice(11, 16)}`
    : e.type === "cancelled" ? "Cancelled"
    : e.type === "delayed_no_estimate" ? "Delayed" : "Scheduled";
  console.log(d.train.headcode, status, d.destination.name);
}
```

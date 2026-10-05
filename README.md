<p align="center">
  <img src=".github/banner.png" alt="Trainiac: docs for the Trainiac API and MCP server" width="100%">
</p>

Live UK train data, free, as plain JSON. Ask for a station's departures, plan
a journey, find where a train is right now, or see today's delays and
cancellations. It's all built from Network Rail's open feeds and National
Rail's Darwin forecasts.

No sign-up, no API keys. Everything is a `GET`, and it works straight from a
browser (CORS is open).

```sh
curl 'https://api.traini.ac/api/departures/PAD?limit=5'   # next trains from Paddington
curl 'https://api.traini.ac/api/journey/PAD/RDG'          # Paddington to Reading
curl 'https://api.traini.ac/api/train?headcode=1A23'      # where is 1A23?
```

**Using it with an AI?** The same data is an [MCP server](#use-it-from-an-ai-mcp).
In Claude Code it's one line:
`claude mcp add --transport http trainiac https://api.traini.ac/mcp`

## What you can ask

Base URL: `https://api.traini.ac`. `GET /api` lists everything as JSON.

| Ask for | Endpoint |
| --- | --- |
| The departure board at a station | [`/api/departures/{station}`](#departures) |
| Trains from A to B, with changes | [`/api/journey/{from}/{to}`](#journey) |
| Where one train is right now | [`/api/train?headcode=…`](#train) |
| A station's code from its name | [`/api/stations?q=…`](#station-search) |
| What actually ran at a station in the last 3 hours | [`/api/stations/{station}/activity`](#station-activity) |
| The worst delays right now | [`/api/delays`](#delays) |
| Today's cancellations, with reasons | [`/api/cancellations`](#cancellations) |
| Today's headline numbers | [`/api/summary`](#summary) |
| Every train on a map | [`/api/positions`](#positions) |
| Whether the data is fresh right now | [`/api/status`](#status) |

### Five things worth knowing

1. **Stations can be written however you like:** a code (`PAD`), a name
   (`London Paddington`, percent-encoded in a path) or a group (`London`
   means all the London terminals). More in [Stations](#stations).
2. **Times are UK time, with the offset**, like `2026-08-17T03:35:00+01:00`.
   When you send a time, use `HH:MM`. Dates are `YYYY-MM-DD`.
3. **`null` means "we don't know yet"**, not "on time". Delays are in
   minutes, and negative means early.
4. **Show `status_text`, branch on `status`.** Every train has both: a
   sentence for people, and a stable code for your code.
5. **Every live value says where it came from** (`data_source`): a Darwin
   forecast, a live report from the train, or just the timetable.

## Every answer looks the same

Everything except `/api/positions` comes back in one envelope:

```json
{
  "generated_at": "2026-08-17T03:36:57+01:00",
  "resolved": { "station": { "name": "PADDINGTON LONDON", "crs": "PAD" } },
  "results": [ … ],
  "result_count": 2
}
```

- `resolved` is what we took your arguments to mean. Check it: a name
  becomes one specific station, and this is where you see which one.
- `results` can be empty. Empty means "no trains". A station we couldn't
  work out is an error, never an empty list.

<details>
<summary><b>Statuses, sources and platforms in detail</b></summary>

<br>

| `status` | `status_text` |
| --- | --- |
| `on_time` | On time |
| `expected_late` | Expected 03:36 |
| `delayed_no_estimate` | Delayed, no estimate yet |
| `cancelled` | Cancelled |
| `departed` | Departed 03:36 |
| `scheduled` | Scheduled, no live report yet |
| `scheduled_arrival_forecast_only` | Scheduled, forecast covers the arrival only |

`data_source` and `platform_source` are one of:

| Source | Meaning |
| --- | --- |
| `darwin forecast` | National Rail's prediction engine. The best source before a train leaves: it knows about advance delays and "delayed, no estimate". |
| `live report` | A TRUST movement report. Reliable, but only exists once the train is running. |
| `timetable` | Planned only. Nothing live is known. |

The best one always wins: Darwin, then TRUST, then the timetable.
`lateness_minutes` is always the raw TRUST delay, even when Darwin's
forecast is the one shown.

Platforms come as three fields: `platform`, `platform_source` and
`platform_withheld`. `withheld: true` means the operator asked for it not
to be shown on station boards. We tell you anyway, so you can decide. In
journeys the same three appear with a prefix (`origin_platform`,
`interchange_arrival_platform`, …).

`service_class` is `passenger`, `bus`, `freight`, `ship`, `trip`,
`empty stock` or `unknown`.

Booleans in the query are `true`/`false` (or `1`/`0`). An empty query
parameter is the same as leaving it out. Anything but `GET` is a 405.

</details>

## Stations

Anywhere you give a station (in a path, or as `calling_at`, `origin`,
`destination`) you can use:

- a **code**: `PAD`, `KGX`, `CDU`
- a **name**, in any word order: `London Paddington`, `paddington`,
  `Cam & Dursley` (in a path: `Cam%20%26%20Dursley`)
- a **group**: `London`, `Birmingham`, `Manchester`, `Glasgow`, `Edinburgh`

Exact codes win, then exact names, then the busiest match, so `Paddington`
means the main station rather than the Elizabeth line platforms. If a name
really is ambiguous (`bradford`), you get a list to choose from instead of
a guess.

<details>
<summary><b>What <code>resolved</code> looks like for a station and a group</b></summary>

<br>

```json
"resolved": { "station": { "name": "London Paddington", "crs": "PAD" } }
```

A group lists what it covered:

```json
"resolved": { "station": { "name": "London Terminals", "group": true,
  "stations": [ { "crs": "PAD", "name": "London Paddington" },
                { "crs": "KGX", "name": "London Kings Cross" }, … ] } }
```

</details>

## Endpoints

### Departures

`GET /api/departures/{station}`. The live departure board.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | 15 | 1–100 |
| `from_time` | now | Only trains leaving at or after this time |
| `to_time` | — | Only trains leaving at or before this time |
| `calling_at` | — | Only trains that stop here later on |

Late trains stay on the board until their *expected* time passes.

<details>
<summary><b>Example and fields</b></summary>

<br>

```sh
curl 'https://api.traini.ac/api/departures/PAD?limit=1&calling_at=RDG'
```

```json
{
  "generated_at": "2026-08-17T03:37:27+01:00",
  "resolved": {
    "station": { "name": "PADDINGTON LONDON", "crs": "PAD" },
    "calling_at": { "name": "READING", "crs": "RDG" }
  },
  "results": [
    {
      "departs": "2026-08-17T03:35:00+01:00",
      "expected_departs": "2026-08-17T03:37:00+01:00",
      "arrives": "2026-08-17T04:24:00+01:00",
      "formed_from": null,
      "data_source": "darwin forecast",
      "coaches": null,
      "formation_changes": [],
      "late_reason": null,
      "headcode": "2R01",
      "operator": "Great Western Railway",
      "service_class": "passenger",
      "origin": { "name": "PADDINGTON LONDON", "crs": "PAD" },
      "destination": { "name": "READING", "crs": "RDG" },
      "calling_points": [
        { "station": { "name": "EALING BROADWAY", "crs": "EAL" },
          "scheduled": "2026-08-17T03:44:00+01:00",
          "expected": "2026-08-17T03:44:00+01:00", "platform": "3" },
        …
      ],
      "lateness_minutes": null,
      "is_activated": true,
      "not_for_display": true,
      "train_id": "732R01M317",
      "train_uid": "C48259",
      "status": "expected_late",
      "status_text": "Expected 03:37",
      "platform": "10",
      "platform_source": "darwin forecast",
      "platform_withheld": true
    }
  ],
  "result_count": 1
}
```

- `departs` / `arrives`: timetabled departure here, and arrival at the
  destination (`null` if unknown). `expected_departs` is the best live
  estimate.
- `is_activated`: the train exists as a running service, not just a
  timetable row. `train_id` is `null` until then, and once set it's the
  exact key for [`/api/train`](#train).
- `not_for_display`: Darwin asked for this stop to be hidden from public
  boards. We report it rather than hide it.
- `formed_from`: the incoming train that becomes this one, when Darwin
  says: `{ "headcode", "origin": {name, crs}, "expected_arrival" }`.
- `formation_changes`: where the train splits or joins today, each
  `{ "kind": "divides" | "joins", "station": {name, crs}, "note": "…" }`.
- `late_reason`: Darwin's reason for a delay, as a sentence.
- `coaches`: how many coaches, from Darwin.
- `train_uid`: the timetable's own id for the service.

</details>

### Journey

`GET /api/journey/{from}/{to}`. Today's trains between two stations,
including ones with changes. Connections are checked against live delays.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | 10 | 1–100 options |
| `max_changes` | 1 | 0–8. `0` means direct trains only |
| `min_interchange_min` | 5 | 1–60. The least time to allow for a change |
| `from_time` / `to_time` | now / — | When to leave, UK time |

Both ends can be groups. Results come in departure order, and each has a
`changes` count that decides its shape.

<details>
<summary><b>Direct trains (<code>changes: 0</code>)</b></summary>

<br>

```sh
curl 'https://api.traini.ac/api/journey/PAD/RDG?limit=1'
```

```json
{
  "changes": 0,
  "departs": "2026-08-17T03:35:00+01:00",
  "expected_departs": "2026-08-17T03:36:00+01:00",
  "arrives": "2026-08-17T04:24:00+01:00",
  "expected_arrives": "2026-08-17T04:24:00+01:00",
  "duration_minutes": 49,
  "data_source": "darwin forecast",
  "coaches": null,
  "headcode": "2R01",
  "operator": "Great Western Railway",
  "service_class": "passenger",
  "arrival_station": { "name": "READING", "crs": "RDG" },
  "destination": { "name": "READING", "crs": "RDG" },
  "lateness_minutes": null,
  "is_activated": true,
  "not_for_display": true,
  "train_id": "732R01M317",
  "train_uid": "C48259",
  "status": "expected_late",
  "status_text": "Expected 03:36",
  "platform": "10",
  "platform_source": "darwin forecast",
  "platform_withheld": true
}
```

`arrival_station` is where *you* get off. `destination` is where the
train ends up.

</details>

<details>
<summary><b>One change (<code>changes: 1</code>)</b></summary>

<br>

```sh
curl 'https://api.traini.ac/api/journey/PAD/CDU?limit=1&from_time=06:00'
```

```json
{
  "changes": 1,
  "departs": "2026-08-17T06:00:00+01:00",
  "expected_departs": "2026-08-17T06:00:00+01:00",
  "arrives": "2026-08-17T08:15:00+01:00",
  "duration_minutes": 135,
  "arrival_station": { "name": "CAM & DURSLEY", "crs": "CDU" },
  "interchange": { "name": "BRISTOL TEMPLE MEADS", "crs": "BRI" },
  "interchange_arrives": "2026-08-17T07:35:00+01:00",
  "connection_minutes": 5,
  "connection_status": "ok",
  "interchange_departs": "2026-08-17T07:40:00+01:00",
  "leg1_headcode": "1C01", "leg1_operator": "Great Western Railway",
  "leg1_service_class": "passenger", "leg1_status": "on_time",
  "leg1_status_text": "On time", "leg1_train_id": null,
  "leg2_headcode": "2E51", "leg2_operator": "Great Western Railway",
  "leg2_service_class": "passenger", "leg2_status": "on_time",
  "leg2_status_text": "On time", "leg2_train_id": null,
  "origin_platform": "4", "origin_platform_source": "darwin forecast", "origin_platform_withheld": true,
  "interchange_arrival_platform": "15", "interchange_arrival_platform_source": "darwin forecast", "interchange_arrival_platform_withheld": false,
  "interchange_departure_platform": "12", "interchange_departure_platform_source": "darwin forecast", "interchange_departure_platform_withheld": true
}
```

`connection_status` is `ok`, `at risk` (live delays have eaten into the
change) or `unknown` (nothing live to go on). `connection_minutes` is the
time you really have, after any known delay.

</details>

<details>
<summary><b>Two or more changes (<code>changes: 2+</code>)</b></summary>

<br>

Only when `max_changes` is 2 or more. Instead of `leg1_`/`leg2_` prefixes
you get two arrays: `interchanges` (the stations, in order) and `legs`, one
per train, each with `board`, `alight`, `departs`, `arrives`, their
expected times, `headcode`, `operator`, `status`, and `departure_`/
`arrival_` platform fields. The top-level `connection_minutes` and
`connection_status` describe the *tightest* change, which is the one that
decides whether the trip works. Each leg has its own as well.

If both ends are the same place, you get a 400:
`origin and destination are the same`.

</details>

### Train

`GET /api/train?headcode=1A23` or `GET /api/train?train_id=171A23MN16`.
Where one train is right now.

| Parameter | Meaning |
| --- | --- |
| `headcode` | The four-character train number, e.g. `1A23` |
| `train_id` | The exact id from a departures or journey row. Never ambiguous |
| `operator`, `origin`, `destination` | Narrow a headcode down |
| `date` | `YYYY-MM-DD` for a past run. Defaults to today |

You need `headcode` or `train_id`. Headcodes repeat across the country,
so a headcode alone can return up to ten trains, most recently seen
first. Use `train_id` when you have it.

<details>
<summary><b>A train that's moving</b></summary>

<br>

```json
{
  "generated_at": "2026-08-17T03:37:04+01:00",
  "resolved": {},
  "results": [
    {
      "train_id": "171A23MN16",
      "headcode": "1A23",
      "run_date": "2026-08-16",
      "last_location": "KING'S CROSS LONDON",
      "last_event": "ARRIVAL",
      "reported_platform": "6",
      "advertised_platform": "6",
      "platform_conflict": false,
      "variation_status": "LATE",
      "lateness_minutes": 84,
      "last_seen": "2026-08-16T17:46:00+01:00",
      "is_terminated": true,
      "minutes_since_report": 591,
      "origin": "BRADFORD FORSTER SQUARE",
      "destination": "KING'S CROSS LONDON",
      "operator": "LNER",
      "train_uid": "C02119"
    }
  ],
  "result_count": 1
}
```

`reported_platform` is what the train reported; `advertised_platform` is
what the timetable or Darwin said; `platform_conflict` means they really
disagree. `is_terminated` means it has reached its destination. `origin`,
`destination` and `operator` can be `null` for freight.

</details>

<details>
<summary><b>A train that hasn't moved yet</b></summary>

<br>

You get today's timetabled trains with that headcode instead (up to ten,
earliest first), with `resolved.note` explaining why there's no position.
Tell the two apart by `last_location` (moving) or `departs` (timetabled).

```sh
curl 'https://api.traini.ac/api/train?headcode=1C01'
```

```json
{
  "generated_at": "2026-08-17T03:42:58+01:00",
  "resolved": {
    "note": "found in today's timetable, but TRUST has no movement reports for it yet, so there is no position to give. is_activated says whether the train has entered TRUST at all."
  },
  "results": [
    { "train_id": "571C01M417", "headcode": "1C01", "train_uid": "W70749",
      "run_date": "2026-08-17", "is_activated": true,
      "departs": "2026-08-17T04:39:00+01:00", "arrives": "2026-08-17T06:36:00+01:00",
      "origin": { "name": "DERBY", "crs": "DBY" },
      "destination": { "name": "ST PANCRAS LONDON", "crs": "STP" },
      "operator": "East Midlands Railway" },
    …
  ],
  "result_count": 4
}
```

Nothing at all (not in today's timetable, not seen in the last 12 hours)
is a 404 with a hint.

</details>

### Station search

`GET /api/stations?q=paddington`. Find a station's code. Words match in
any order, best match first. `resolved.resolves_to` is the station the same
words would pick in a path.

<details>
<summary><b>Example</b></summary>

<br>

```json
{
  "generated_at": "2026-08-17T03:36:58+01:00",
  "resolved": { "resolves_to": { "name": "London Paddington", "crs": "PAD" }, "query": "paddington" },
  "results": [
    { "stanox": "73000", "tiploc": "PADTON",  "crs": "PAD",  "description": "PADDINGTON LONDON", "type": "station", "calls": 1804 },
    { "stanox": "73003", "tiploc": "PADTLL",  "crs": "PDX",  "description": "PADDINGTON EL",     "type": "station", "calls": 1752 },
    { "stanox": "73104", "tiploc": "PADTNNY", "crs": null,   "description": "PADDINGTON NEW YARD", "type": "depot", "calls": 0 },
    …
  ],
  "result_count": 8
}
```

`type` is `station`, `depot` or `other`. `calls` is how many trains call
there today. `stanox` and `tiploc` are Network Rail's location codes, for
joining with other open data.

</details>

### Station activity

`GET /api/stations/{station}/activity?limit=15`. What actually happened
at a station in the last three hours: real arrivals and departures, planned
against actual, newest first.

<details>
<summary><b>Example</b></summary>

<br>

```json
{
  "generated_at": "2026-08-17T03:36:58+01:00",
  "resolved": { "station": { "name": "PADDINGTON LONDON", "crs": "PAD" } },
  "results": [
    { "headcode": "2P01", "train_id": "742P01M217", "event_type": "ARRIVAL",
      "planned": "2026-08-17T03:11:00+01:00", "actual": "2026-08-17T03:10:00+01:00",
      "lateness_minutes": -1, "variation_status": "EARLY", "platform": "10",
      "location": "PADDINGTON LONDON" }
  ],
  "result_count": 2
}
```

`event_type` is `ARRIVAL` or `DEPARTURE`. `variation_status` is `EARLY`,
`ON TIME`, `LATE` or `OFF ROUTE`.

</details>

### Delays

`GET /api/delays?min_minutes=10&limit=15&passenger_only=true`. The most
delayed trains running right now, worst first, with where each was last
seen. Set `passenger_only=false` to include freight and empty trains.

<details>
<summary><b>Example</b></summary>

<br>

```json
{
  "generated_at": "2026-08-17T03:37:03+01:00",
  "resolved": {},
  "results": [
    { "headcode": "9W09", "train_id": "629W09M217", "lateness_minutes": 21,
      "last_location": "CRICKLEWOOD", "variation_status": "LATE",
      "last_seen": "2026-08-17T03:36:00+01:00", "service_class": "passenger",
      "origin": "BEDFORD MIDLAND", "destination": "THREE BRIDGES", "operator": "Thameslink" }
  ],
  "result_count": 1
}
```

</details>

### Cancellations

`GET /api/cancellations?limit=15`. Today's cancellations, newest first,
with the reason in plain English.

<details>
<summary><b>Example and fields</b></summary>

<br>

```json
{
  "generated_at": "2026-08-17T03:37:04+01:00",
  "resolved": {},
  "results": [
    { "headcode": "9O21", "train_id": "639O21MA17", "train_uid": "C09971",
      "canx_type": "AT ORIGIN", "canx_reason_code": "TI",
      "reason": "Train-crew rostering problem", "reason_category": "Passenger operator",
      "planned": false,
      "reported_at": "2026-08-17T03:36:09+01:00", "input_at": "2026-08-17T03:36:00+01:00",
      "location": "ST ALBANS CITY" }
  ],
  "result_count": 1
}
```

`canx_type` is `AT ORIGIN`, `ON CALL`, `EN ROUTE` or `OUT OF PLAN`.
`planned` is true when the operator planned the cancellation in advance,
which you may want to leave out of a "what went wrong today" view.

</details>

### Summary

`GET /api/summary`. One row of headline numbers for today.

<details>
<summary><b>Example</b></summary>

<br>

```json
{
  "generated_at": "2026-08-17T03:37:04+01:00",
  "resolved": {},
  "results": [
    { "service_date": "2026-08-17", "scheduled": 38444, "started": 1078,
      "running_now": 31, "running_window_min": 30,
      "cancelled": 325, "cancelled_planned": 186,
      "on_time_pct": 58.0,
      "on_time_definition": "share of public calls today whose actual was at or before the timetabled time, so to the minute, not the PPM 5/10 threshold",
      "avg_lateness_min": 6.18, "movement_events_today": 10131 }
  ],
  "result_count": 1
}
```

`on_time_pct` counts to the minute, so it looks much worse than the
official figures, which allow 5 or 10 minutes. Read `on_time_definition`
before you quote it.

</details>

### Status

`GET /api/status`. Whether the API is answering, how fresh each feed's data
is, and how many trains are running. It's answered from a snapshot at most
15 seconds old, so polling it is cheap: 1 unit, and it never waits for the
database.

<details>
<summary><b>Example and fields</b></summary>

<br>

```json
{
  "generated_at": "2026-10-05T10:31:20+01:00",
  "status": "ok",
  "feeds": {
    "trust":  { "state": "fresh", "last_stored_seconds_ago": 3,  "stale_after_seconds": 300 },
    "td":     { "state": "fresh", "last_stored_seconds_ago": 1,  "stale_after_seconds": 300 },
    "darwin": { "state": "fresh", "last_stored_seconds_ago": 12, "stale_after_seconds": 600 }
  },
  "trains_running": 2140,
  "measured_at": "2026-10-05T10:31:09+01:00"
}
```

Not in the usual envelope: it describes the API rather than the railway.

- `feeds`: TRUST (train movements), TD (signalling berth steps) and
  Darwin (forecasts). `last_stored_seconds_ago` is how old the newest data
  we have from that feed is.
- `state` is `fresh` up to `stale_after_seconds`, `stale` after it,
  `silent` when nothing has arrived for hours, and `unknown` when we
  couldn't check.
- `status` is `ok` when every feed is fresh, otherwise `degraded`. Answers
  still work when degraded; they just know less about what's live.
- `trains_running`: trains on the [live map](https://traini.ac) right now,
  seen in the last 30 minutes. `null` if we couldn't count them.

</details>

### Positions

`GET /api/positions`. Every train seen in the last 30 minutes that we can
put on a map.

<details>
<summary><b>Example (an older format)</b></summary>

<br>

This one is different from the rest: a bare array, camelCase, `seen` in
UK time without an offset, and empty strings or `0.0` for unknowns.
`nextLat`/`nextLon` is the next timing point, `0.0` when unknown.

```json
[
  { "id": "181T041217", "headcode": "1T04", "crs": "DGT", "station": "DEANSGATE",
    "lat": 53.473961, "lon": -2.250061, "status": "LATE", "delay": 7,
    "seen": "2026-08-17T03:38:00", "eventType": "ARRIVAL",
    "nextLat": 0.0, "nextLon": 0.0, … },
  …
]
```

</details>

## When something goes wrong

Errors are always JSON with an `error` field, and the HTTP status tells
you whose problem it is:

| Status | Means |
| --- | --- |
| **400** | Something in your request (a bad time, an ambiguous station…) |
| **404** | Nothing there (unknown station, train or endpoint) |
| **429** | You've used your minute's allowance. See [Fair use](#fair-use) |
| **503** | We're busy. Wait a second and try again |
| **500** | Our bug |

<details>
<summary><b>Every error, with examples</b></summary>

<br>

| Status | `error` values |
| --- | --- |
| **400** | `invalid_integer`, `invalid_time`, `invalid_date`, `invalid_boolean`, `missing_station`, `refused`, `station ambiguous`, `limit out of range` (and other `… out of range`), `origin and destination are the same` |
| **404** | `not_found` (no such endpoint), `station not resolved`, `train not found` |
| **405** | `method_not_allowed` |
| **429** | `rate_limited` |
| **503** | `database_busy` (retry in a second), `database_unavailable`, `query_failed`, `station_lookup_failed`, `status_unavailable` |
| **500** | `malformed_result` |

Bad arguments come with a `message`:

```
GET /api/departures/PAD?limit=abc            → 400
{"error":"invalid_integer","message":"limit must be a whole number; got 'abc'"}

GET /api/departures/PAD?from_time=25:99      → 400
{"error":"invalid_time","message":"invalid from_time: '25:99' (use HH:MM or HHMM)"}

GET /api/departures/PAD?limit=500            → 400
{"error":"limit out of range","given":500,"min":1,"max":100}

GET /api/train                               → 400
{"error":"refused","message":"Give a headcode or a train_id."}

GET /api/departures                          → 400
{"error":"missing_station","message":"Give a station: /api/departures/{station}, e.g. /api/departures/PAD"}
```

Station problems tell you where to go next:

```
GET /api/departures/bradford                 → 400
{"error":"station ambiguous","query":"bradford",
 "candidates":[{"crs":"BDI","name":"BRADFORD INTERCHANGE","calls_today":504},
               {"crs":"BDQ","name":"BRADFORD FORSTER SQUARE","calls_today":313},
               {"crs":"BOA","name":"BRADFORD-ON-AVON","calls_today":261}, …],
 "hint":"Repeat the call with one of these CRS codes."}

GET /api/departures/Paddingtn                → 404
{"error":"station not resolved","query":"Paddingtn",
 "did_you_mean":[{"crs":"PAD","name":"PADDINGTON LONDON","calls_today":1804},
                 {"crs":"PDX","name":"PADDINGTON EL","calls_today":1752}],
 "hint":"Give a CRS code or station name; find_station lists candidates. Group names like 'London' are accepted."}
```

On `/api/journey`, station errors say which end failed:
`origin station ambiguous`, `destination station not resolved`.

</details>

## Use it from code

```ts
const res = await fetch(`https://api.traini.ac/api/departures/${crs}?limit=10`);
const body = await res.json();
if (!res.ok) throw new Error(`${res.status}: ${body.error}`);
for (const d of body.results) console.log(d.headcode, d.status_text, d.destination.name);
```

Percent-encode station names in paths (`encodeURIComponent`,
`urllib.parse.quote`). Three small examples you can run are in
[`examples/`](examples/):

- [`next-train.sh`](examples/next-train.sh): curl and jq, the next train from A to B
- [`departures.ts`](examples/departures.ts): a departure board in your terminal (Bun)
- [`journey.py`](examples/journey.py): plan a journey and warn about tight changes (Python, no dependencies)

## Use it from an AI (MCP)

The same data is a [Model Context Protocol](https://modelcontextprotocol.io)
server at `https://api.traini.ac/mcp`, so assistants like Claude can answer
"when's the next train to Reading?" with live data.

- **Claude** (web, desktop and mobile): Settings → Connectors → Add custom
  connector, and paste `https://api.traini.ac/mcp`.
- **Claude Code**:

  ```sh
  claude mcp add --transport http trainiac https://api.traini.ac/mcp
  ```

- **Any other MCP client**: add a remote server over Streamable HTTP at the
  same URL. There's no key and no sign-in.

The tools match the endpoints one to one: `departures`, `find_station`,
`station_activity`, `journey`, `train`, `delays`, `cancellations` and
`live_summary`. A REST answer is exactly the MCP tool's text, so anything
here applies to both.

<details>
<summary><b>Protocol details</b></summary>

<br>

Stateless Streamable HTTP, spec revision 2026-07-28. Anything that isn't
an MCP client should use the REST endpoints.

</details>

## Fair use

It's free, and the limits are generous and the same for everyone. They
count **units of work**, not requests:

| Request | Units |
| --- | --- |
| [Journey](#journey) | 5 |
| [Journey](#journey) with `max_changes=0` (direct trains only) | 2 |
| [Departures](#departures) | 3 |
| Everything else | 1 |

- **120 units a minute per address** (about 40 departure boards). Go over
  and you get a **429** with `Retry-After`.
- **20 units running at once across everyone.** If the database is busy, a
  request waits up to two seconds, then gets a **503** with `Retry-After: 1`.

Every answer tells you where you stand, in headers a browser can read too:

| Header | Means |
| --- | --- |
| `X-Request-Units` | What this request cost |
| `RateLimit-Limit` | Your allowance a minute: `120` |
| `RateLimit-Remaining` | Units left after this request |
| `RateLimit-Reset` | Seconds until what you've spent starts coming back |
| `RateLimit-Policy` | The same, in one line: `120;w=60` |

Please honour `Retry-After`, cache what you can (a departure board doesn't
change faster than every 30 seconds or so), and send a `User-Agent` that
says who you are.

<details>
<summary><b>The details</b></summary>

<br>

The per-address limit covers `/api` and `/mcp` together, over a sliding
window. Refused requests still spend their units, so backing off is the
only way through:

```json
{"error":"rate_limited","message":"This address has spent its allowance of 120 request units a minute (a journey is 5, a departure board 3, most other calls 1). Try again in 42 seconds.","retry_after_seconds":42}
```

When the database is busy:

```json
{"error":"database_busy","message":"Too many queries are running right now. Try again in a moment.","retry_after_seconds":1}
```

Only requests that query the database wait for it. `GET /api` and MCP
`initialize`/`tools/list` never do.

Requests are logged (endpoint, timing, status, forwarded IP, user agent)
to keep the usage dashboards honest. Nothing else is kept.

</details>

## Where the data comes from

Network Rail's open data feeds (TRUST movements, TD berth steps, VSTP,
TSR, the CIF timetable and CORPUS location names) and National Rail's
Darwin Push Port. Times are what those feeds said: nothing is smoothed or
made up. Data © Network Rail Infrastructure Limited and Rail Delivery
Group, used under their open data licences.

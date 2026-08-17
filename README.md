# traini.ac API

Live UK rail data as plain JSON over HTTP. Departure boards, journeys,
where a train is, today's delays and cancellations, and a network summary,
built from Network Rail's open TRUST/TD/VSTP feeds, National Rail's Darwin
forecasts, and the daily CIF timetable.

**Base URL:** `https://api.traini.ac`

Everything is `GET`, read-only, unauthenticated, and CORS-open. There are
no API keys. `GET https://api.traini.ac/api` lists the endpoints as JSON.

```sh
curl 'https://api.traini.ac/api/departures/PAD?limit=5'
curl 'https://api.traini.ac/api/journey/PAD/RDG'
curl 'https://api.traini.ac/api/train?headcode=1A23'
```

If you are wiring this into a model rather than a program, the same data
is served over MCP at `https://api.traini.ac/mcp` — see [For models](#for-models-mcp).

## Endpoints

| Endpoint | Query parameters (default) | What you get |
| --- | --- | --- |
| [`GET /api/departures/{station}`](#departures) | `limit` (15, 1–100), `from_time`, `to_time`, `calling_at` | Live departure board with status, platform, calling points |
| [`GET /api/stations?q={query}`](#station-search) | — | Stations matching a name fragment or CRS code |
| [`GET /api/stations/{station}/activity`](#station-activity) | `limit` (15) | Actual arrivals and departures there in the last 3 hours |
| [`GET /api/journey/{from}/{to}`](#journey) | `limit` (10, 1–100), `max_changes` (1, 0–8), `min_interchange_min` (5, 1–60), `from_time`, `to_time` | Direct trains and itineraries with changes, connections checked against live delays |
| [`GET /api/train`](#train) | `headcode` or `train_id` (one required), `operator`, `origin`, `destination`, `date` | Where one train is now, or its timetable if it has not moved yet |
| [`GET /api/delays`](#delays) | `min_minutes` (10), `limit` (15), `passenger_only` (true) | The worst-delayed trains running right now |
| [`GET /api/cancellations`](#cancellations) | `limit` (15) | Today's cancellations, most recent first, with reasons |
| [`GET /api/summary`](#summary) | — | Today's headline numbers |
| [`GET /api/positions`](#positions) | — | Every train seen in the last 30 minutes, with coordinates |

`{station}` in a path is a CRS code, a station name (percent-encoded:
`London%20Paddington`) or a group name — see [Stations](#stations). Times
in the query are UK local, `HH:MM` or `HHMM`. Dates are `YYYY-MM-DD`.
Booleans are `true`/`false` (or `1`/`0`). An empty query parameter is the
same as leaving it out. Anything but `GET` is a **405**.

## Reading an answer

Every endpoint except `/api/positions` returns the same envelope:

```json
{
  "generated_at": "2026-08-17T03:36:57+01:00",
  "resolved": { "station": { "name": "PADDINGTON LONDON", "crs": "PAD" } },
  "results": [ … ],
  "result_count": 2
}
```

- `generated_at` — when the database answered.
- `resolved` — what your arguments were taken to mean. Always check it: a
  name resolves to one specific station, and this is where you find out
  which. It is `{}` for endpoints with no station arguments.
- `results` — an array, possibly empty. Empty means "no trains", never
  "bad station name": a station that could not be resolved is a 4xx, not
  an empty list.
- `result_count` — `results.length`, for convenience.

Rules that hold everywhere:

- **Times are ISO 8601 with the UK offset**, e.g. `2026-08-17T03:35:00+01:00`.
  A time carries its date, so a journey over midnight compares correctly.
- **Absent is `null`.** Never `""`, never `0`, never a missing key. An
  expected time of `null` means "no information yet", **not** "on time".
- **Delays and durations are minutes.** Negative is early.
- **Every status comes as a pair:** a stable `status` code to branch on
  and a `status_text` sentence to show. Never parse the sentence.

  | `status` | `status_text` |
  | --- | --- |
  | `on_time` | On time |
  | `expected_late` | Expected 03:36 |
  | `delayed_no_estimate` | Delayed, no estimate yet |
  | `cancelled` | Cancelled |
  | `departed` | Departed 03:36 |
  | `scheduled` | Scheduled, no live report yet |
  | `scheduled_arrival_forecast_only` | Scheduled, forecast covers the arrival only |

- **Every live value says where it came from.** `data_source` and
  `platform_source` are one of:

  | Source | Meaning |
  | --- | --- |
  | `darwin forecast` | National Rail's prediction engine. The best source before a train departs — it knows about advance delays and the "delayed, no estimate" state. |
  | `live report` | A TRUST movement report. Reliable, but only exists once the train is running. |
  | `timetable` | Planned only. Nothing live is known. |

  Precedence is always Darwin > TRUST > timetable. `lateness_minutes` is
  the raw TRUST delay and stays that even when Darwin's forecast wins.

- **Platforms come as a triple:** `platform`, `platform_source` and
  `platform_withheld`. `withheld: true` means the publisher asked for the
  platform not to be shown on boards; it is reported, not obeyed, so you
  can decide. In journeys the same triple appears with a prefix
  (`origin_platform`, `interchange_arrival_platform`, …).
- `service_class` is `passenger`, `bus`, `freight`, `ship`, `trip`,
  `empty stock` or `unknown`.

## When it says no

A refusal is a JSON object with an `error` field under a status that says
whose fault it was. The body always parses, so branch on the status and
read `error`.

| Status | Why | `error` values you will see |
| --- | --- | --- |
| **400** | Your argument | `invalid_integer`, `invalid_time`, `invalid_date`, `invalid_boolean`, `missing_station`, `refused`, `station ambiguous`, `limit out of range` (and other `… out of range`), `origin and destination are the same` |
| **404** | Nothing there | `not_found` (no such endpoint), `station not resolved`, `train not found` |
| **405** | Not `GET` | `method_not_allowed` |
| **429** | You are over your per-minute allowance | `rate_limited` — see [Fair use](#fair-use) |
| **503** | The database is busy or did not answer | `database_busy` (no query slot came free; retry in a second), `database_unavailable`, `query_failed`, `station_lookup_failed` |
| **500** | Our bug: the query and the model disagree | `malformed_result` |

Malformed arguments carry a `message`:

```
GET /api/departures/PAD?limit=abc            → 400
{"error":"invalid_integer","message":"limit must be a whole number; got 'abc'"}

GET /api/departures/PAD?from_time=25:99      → 400
{"error":"invalid_time","message":"invalid from_time: '25:99' (use HH:MM or HHMM)"}

GET /api/departures/PAD?limit=500            → 400
{"error":"limit out of range","given":500,"min":1,"max":100}

GET /api/train                               → 400
{"error":"refused","message":"Give a headcode or a train_id."}
```

Near misses say what was missing rather than "not found":

```
GET /api/departures                          → 400
{"error":"missing_station","message":"Give a station: /api/departures/{station}, e.g. /api/departures/PAD"}
```

Station problems carry the query back and, where possible, somewhere to
go next:

```
GET /api/departures/bradford                 → 400
{"error":"station ambiguous","query":"bradford",
 "candidates":[{"crs":"BDI","name":"BRADFORD INTERCHANGE","calls_today":504},
               {"crs":"BDQ","name":"BRADFORD FORSTER SQUARE","calls_today":313},
               {"crs":"BOA","name":"BRADFORD-ON-AVON","calls_today":261}, …],
 "hint":"Repeat the call with one of these CRS codes."}

GET /api/departures/XYZ123                   → 404
{"error":"station not resolved","query":"XYZ123",
 "hint":"Give a CRS code or station name; find_station lists candidates. Group names like 'London' are accepted."}
```

A 404 for a station that came close to something also carries
`did_you_mean` with the same `{crs, name, calls_today}` shape as
`candidates`. On `/api/journey` the station errors name the end that
failed: `origin station ambiguous`, `destination station not resolved`.

```
GET /api/departures/Paddingtn                → 404
{"error":"station not resolved","query":"Paddingtn",
 "did_you_mean":[{"crs":"PAD","name":"PADDINGTON LONDON","calls_today":1804},
                 {"crs":"PDX","name":"PADDINGTON EL","calls_today":1752}],
 "hint":"Give a CRS code or station name; find_station lists candidates. Group names like 'London' are accepted."}
```

## Stations

Anywhere a station is accepted — path segments, `calling_at`, `origin`,
`destination` — you can give:

- a **CRS code**: `PAD`, `KGX`, `CDU`
- a **name**, in any word order: `London Paddington`, `paddington`,
  `Cam & Dursley` (percent-encode it in a path: `Cam%20%26%20Dursley`)
- a **group name**: `London` means the London terminals; `Birmingham`,
  `Manchester`, `Glasgow` and `Edinburgh` also exist

Resolution ranks exact CRS > exact name > prefix, then today's timetabled
call volume, so `Paddington` picks the mainline station over the
Elizabeth line platforms. When a name is genuinely ambiguous (`bradford`)
you get a 400 with `candidates` rather than a guess.

`resolved` tells you what happened. A single station:

```json
"resolved": { "station": { "name": "London Paddington", "crs": "PAD" } }
```

A group, with its members listed so you can see what "London" covered:

```json
"resolved": { "station": { "name": "London Terminals", "group": true,
  "stations": [ { "crs": "PAD", "name": "London Paddington" },
                { "crs": "KGX", "name": "London Kings Cross" }, … ] } }
```

Use [`/api/stations?q=`](#station-search) to look names up ahead of time
if you want to show a picker.

---

## Departures

```
GET /api/departures/{station}
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | 15 | 1–100 |
| `from_time` | now | Only departures at or after this UK time (`HH:MM`) |
| `to_time` | — | Only departures at or before this UK time |
| `calling_at` | — | Only services that stop at this station later on. Echoed in `resolved.calling_at` |

Late runners stay listed until their *expected* time passes, not their
timetabled one.

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
        { "station": { "name": "READING", "crs": "RDG" },
          "scheduled": "2026-08-17T04:24:00+01:00",
          "expected": "2026-08-17T04:24:00+01:00", "platform": "13" }
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

Fields worth knowing:

- `departs` / `arrives` — timetabled departure here and arrival at the
  destination. `arrives` is `null` when unknown.
- `expected_departs` — the best live estimate, or `null` for none.
- `is_activated` — TRUST has activated the train (it exists as a running
  service, not just a timetable row). `train_id` is `null` until then;
  once set, it is the exact key for [`/api/train`](#train).
- `not_for_display` — Darwin asked for this call to be suppressed from
  public boards. Reported, not obeyed.
- `formed_from` — the inbound working that becomes this train, when
  Darwin says so: `{ "headcode", "origin": {name, crs}, "expected_arrival" }`.
  Whether your train exists yet often depends on this.
- `formation_changes` — divides and joins on this run today, each
  `{ "kind": "divides" | "joins", "station": {name, crs}, "note": "…" }`.
- `late_reason` — Darwin's stated reason as a sentence, or `null`.
- `coaches` — formation length from Darwin, or `null`.
- `train_uid` — the timetable's own id for the service.

## Station search

```
GET /api/stations?q={query}
```

Words match in any order (`London Paddington` finds `PADDINGTON LONDON`).
Results are ordered by relevance then today's call volume, and include
non-station locations (depots, junctions) so you can see what a name
really covers. `resolved.resolves_to` is the station the same query would
pick if you used it in a path.

```sh
curl 'https://api.traini.ac/api/stations?q=paddington'
```

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

`type` is `station`, `depot` or `other`. `calls` is today's timetabled
calls there. `stanox` and `tiploc` are Network Rail's location codes, for
joining against other open data.

## Station activity

```
GET /api/stations/{station}/activity?limit=15
```

What actually happened there in the last three hours: TRUST reports of
arrivals and departures with planned vs actual, most recent first.

```sh
curl 'https://api.traini.ac/api/stations/PAD/activity?limit=2'
```

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

`event_type` is `ARRIVAL` or `DEPARTURE`; `variation_status` is TRUST's
own `EARLY`, `ON TIME`, `LATE` or `OFF ROUTE`.

## Journey

```
GET /api/journey/{from}/{to}
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | 10 | 1–100 itineraries |
| `max_changes` | 1 | 0–8. `0` is direct trains only |
| `min_interchange_min` | 5 | 1–60. Minimum time to allow for a change |
| `from_time` / `to_time` | now / — | Departure window, UK time |

Trains between two stations today. Both ends can be groups, as long as
the destination contains somewhere other than the origin. `resolved`
echoes `from` and `to`. Results are ordered by departure and each carries
`changes`; the shape depends on it.

**Direct** (`changes: 0`) is a departure-board row plus the arrival:

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

`arrival_station` is where *you* get off; `destination` is where the
train ends up. They differ when you alight early.

**One change** (`changes: 1`) names the interchange, the connection, and
both legs with `leg1_` / `leg2_` prefixes:

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
change time) or `unknown` (nothing live to judge by). `connection_minutes`
is the time you actually have, after any known delay.

**Two or more changes** (`changes: 2+`, only when `max_changes` ≥ 2) uses
arrays instead of prefixes: `interchanges` (the stations, in order) and
`legs`, one object per hop with `board`, `alight`, `departs`, `arrives`,
their expected times, `headcode`/`operator`/`status` and prefixed
`departure_`/`arrival_` platform triples. `connection_minutes` and
`connection_status` at the top level are the *tightest* change in the
itinerary — the one that decides whether to offer it. Per-hop connection
fields are on each leg too.

If both ends resolve to the same place you get a 400
(`origin and destination are the same`).

## Train

```
GET /api/train?headcode=1A23
GET /api/train?train_id=171A23MN16
```

| Parameter | Meaning |
| --- | --- |
| `headcode` | The four-character reporting number, e.g. `1A23`. One of `headcode` or `train_id` is required |
| `train_id` | The exact TRUST id from a departures or journey row. Never ambiguous |
| `operator`, `origin`, `destination` | Narrow a headcode lookup. Stations resolve as everywhere else |
| `date` | `YYYY-MM-DD`, for a past run. Defaults to today (falling back over the last 12 hours) |

Headcodes repeat nationally — several `1C01`s run on the same day. Given
only a headcode you get up to ten matches, most recently reported first; pass `train_id`
when you have it (departures and journey rows carry it once the train is
activated), or narrow with the filters.

A train that has moved comes back as a **position** report:

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

`reported_platform` is what TRUST saw; `advertised_platform` is what the
timetable/Darwin said; `platform_conflict` flags a real disagreement
(not just one side being unknown). `is_terminated` means the last event
was the arrival at its destination. `origin`, `destination` and
`operator` can be `null` for freight and other unadvertised workings.

When no train with that headcode has moved yet, you get **timetabled**
rows instead — one for every service in today's timetable with that
headcode (up to ten, earliest departure first), so you can see the choices
and narrow with `operator`, `origin` or `destination`. `resolved.note` says why there is no position, and the
fields are different, not fewer:

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
    { "train_id": null, "headcode": "1C01", "train_uid": "G26149",
      "run_date": "2026-08-17", "is_activated": false,
      "departs": "2026-08-17T05:15:00+01:00", "arrives": "2026-08-17T06:11:00+01:00",
      "origin": { "name": "HORSHAM", "crs": "HRH" },
      "destination": { "name": "VICTORIA LONDON", "crs": "VIC" },
      "operator": "Southern" },
    …
  ],
  "result_count": 4
}
```

Tell the two shapes apart by `last_location` (position) versus `departs`
(timetabled). Nothing matching at all — not in today's timetable, not in
the last 12 hours of reports — is a 404 with a hint.

## Delays

```
GET /api/delays?min_minutes=10&limit=15&passenger_only=true
```

The worst currently-running delays, most delayed first, with the last
place each train was reported. `passenger_only=false` includes freight,
empty stock and the rest.

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

## Cancellations

```
GET /api/cancellations?limit=15
```

Today's cancellations, most recent first, with the reason decoded.

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

`canx_type` is TRUST's `AT ORIGIN`, `ON CALL`, `EN ROUTE` or `OUT OF PLAN`.
`canx_reason_code` is the Delay Attribution code and `reason` its
meaning; `planned` is true for cancellations the operator planned in
advance (`reason_category` "Planned or excluded"), which you may want to
filter out of a "what went wrong today" view.

## Summary

```
GET /api/summary
```

One row of headline numbers for the current UK service day.

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

`running_now` counts trains reported in the last `running_window_min`
minutes. Read `on_time_definition` before quoting `on_time_pct`: it is
right-time to the minute, so it will look far worse than the official PPM
figure.

## Positions

```
GET /api/positions
```

The one endpoint that is not one of the tools, and the one without the
envelope: a bare JSON array of every train seen in the last 30 minutes
that we could put on a map. Built for a live map; handy for anything
map-shaped.

```json
[
  { "id": "181T041217", "headcode": "1T04", "crs": "DGT", "station": "DEANSGATE",
    "lat": 53.473961, "lon": -2.250061, "status": "LATE", "delay": 7,
    "seen": "2026-08-17T03:38:00", "eventType": "ARRIVAL",
    "nextLat": 0.0, "nextLon": 0.0, … },
  …
]
```

This is the older shape: camelCase, `seen` without an offset (UK local),
and empty strings / `0.0` for unknowns rather than `null`. `nextLat`/`nextLon`
are the next timing point when known, `0.0` when not.

---

## From code

Three tiny, runnable examples live in [`examples/`](examples/):

- [`next-train.sh`](examples/next-train.sh) — curl + jq: the next train from A to B
- [`departures.ts`](examples/departures.ts) — Bun/TypeScript: a departure board in the terminal
- [`journey.py`](examples/journey.py) — Python (stdlib only): plan a journey and warn about tight connections

The pattern is the same in every language:

```ts
const res = await fetch(`https://api.traini.ac/api/departures/${crs}?limit=10`);
const body = await res.json();
if (!res.ok) throw new Error(`${res.status}: ${body.error}`);
for (const d of body.results) console.log(d.headcode, d.status_text, d.destination.name);
```

Percent-encode station names in paths (`encodeURIComponent` /
`urllib.parse.quote`), branch on the HTTP status, and read `error` from
the body — it is always a JSON object.

## For models: MCP

The same tools are served as a [Model Context Protocol](https://modelcontextprotocol.io)
server at `https://api.traini.ac/mcp` (stateless Streamable HTTP, spec
revision 2026-07-28). Tool names map to endpoints one to one:
`departures`, `find_station`, `station_activity`, `journey`, `train`,
`delays`, `cancellations`, `live_summary`. A REST 200 body is the MCP
tool's text byte for byte, so anything you learn about one applies to the
other.

```sh
claude mcp add --transport http trainiac https://api.traini.ac/mcp
```

Anything that is not an MCP client should use the REST endpoints.

## Fair use

No keys, and generous limits, enforced the same way for everyone. Both
limits count **units of work**, not requests, because a journey is not
one of the same thing a station search is:

| Request | Units |
| --- | --- |
| `/api/journey` (with changes — the default) | 5 |
| `/api/journey?max_changes=0` | 2 |
| `/api/departures` | 3 |
| everything else | 1 |

- **120 units a minute per client address**, across `/api` and `/mcp`
  together, over a sliding window — 40 departure boards, or 24 journeys.
  Over it you get a **429** with a `Retry-After` header and this body, and
  the refused request still spends its units, so backing off is the only
  way through:

  ```json
  {"error":"rate_limited","message":"This address has spent its allowance of 120 request units a minute (a journey is 5, a departure board 3, most other calls 1). Try again in 42 seconds.","retry_after_seconds":42}
  ```

- **20 units of query running at once, across all clients** — four
  journeys, or twenty station searches. A request waits up to two seconds
  for its units; if they never come free it gets a **503** with
  `Retry-After: 1`:

  ```json
  {"error":"database_busy","message":"Too many queries are running right now. Try again in a moment.","retry_after_seconds":1}
  ```

  This one only applies to requests that query — `GET /api` and MCP
  `initialize`/`tools/list` never wait for it.

Honour `Retry-After`, cache what you can (a departure board does not
change faster than every 30 seconds or so), and identify your client with
a `User-Agent`. Requests are logged (endpoint, timing, status, forwarded
IP, user agent) to keep the usage dashboards honest; nothing else is
kept.

## Where the data comes from

Network Rail's open data feeds (TRUST movements, TD berth steps, VSTP,
TSR, the CIF timetable, CORPUS location names) and National Rail's Darwin
Push Port. Times reflect what those feeds said; the API does not smooth or
invent. Data is © Network Rail Infrastructure Limited and Rail Delivery
Group, used under their open data licences.

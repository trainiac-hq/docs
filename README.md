<p align="center">
  <img src=".github/banner.png" alt="Trainiac: docs for the Trainiac API and MCP server" width="100%">
</p>

Live UK train data, free, as typed JSON. Ask for a station's departures,
plan a journey, find where a train is right now, or see today's delays and
cancellations. It's all built from Network Rail's open feeds and National
Rail's Darwin forecasts.

No sign-up, no API keys. Everything is a `GET`, and it works straight from a
browser (CORS is open).

```sh
curl 'https://api.traini.ac/v1/departures/PAD?limit=5'   # next trains from Paddington
curl 'https://api.traini.ac/v1/journey/PAD/RDG'          # Paddington to Reading
curl 'https://api.traini.ac/v1/train?headcode=1A23'      # where is 1A23?
```

**Writing TypeScript?** Every answer has a published type. Copy
[`v1.d.ts`](v1.d.ts), or generate your own from
[`openapi.v1.json`](openapi.v1.json) (OpenAPI 3.1).

**Using it with an AI?** The same data is an [MCP server](#use-it-from-an-ai-mcp).
In Claude Code it's one line:
`claude mcp add --transport http trainiac https://api.traini.ac/mcp`

**Coming from `/api`?** It's [legacy](#legacy-api) and will go away.
[MIGRATING.md](MIGRATING.md) maps every field to its `/v1` home.

## What you can ask

Base URL: `https://api.traini.ac`. `GET /v1` lists everything as JSON.

| Ask for | Endpoint |
| --- | --- |
| The departure board at a station | [`/v1/departures/{station}`](#departures) |
| Trains from A to B, with changes | [`/v1/journey/{from}/{to}`](#journey) |
| Where one train is right now | [`/v1/train?headcode=…`](#train) |
| A station's code from its name | [`/v1/stations?q=…`](#station-search) |
| What actually ran at a station in the last 3 hours | [`/v1/stations/{station}/activity`](#station-activity) |
| The worst delays right now | [`/v1/delays`](#delays) |
| Today's cancellations, with reasons | [`/v1/cancellations`](#cancellations) |
| Today's headline numbers | [`/v1/summary`](#summary) |
| Whether the data is fresh right now | [`/v1/status`](#status) |

### Four things worth knowing

1. **Switch on `type`.** Every answer, and every value that can be one of
   several things, says which it is in a `type` field. TypeScript narrows
   on it.
2. **Every key is always there.** `null` means the thing doesn't exist (a
   train that hasn't been given an id yet), never "we don't know": not
   knowing is its own `type`, like `{"type": "no_information"}`.
3. **Stations can be written however you like:** a code (`PAD`), a name
   (`London Paddington`, percent-encoded in a path) or a group (`London`).
   Answers always use proper names: London Paddington, not PADDINGTON LONDON.
4. **Times are UK time, with the offset**, like `2026-10-05T14:26:00+01:00`.
   When you send a time, use `HH:MM`. Dates are `YYYY-MM-DD`. Delays are in
   minutes, and negative means early.

## Every answer looks the same

```ts
type Answer<Request, Data> =
  | { type: "ok"; request: Request; data: Data; generated_at: string } // HTTP 200
  | { type: "error"; error: ApiError };                                 // HTTP 4xx/5xx
```

`request` is what we took your arguments to mean, with defaults filled in.
Check it: a name becomes one specific station (or a group), and this is
where you see which.

```json
"request": {
  "station": { "query": "London", "resolution": { "type": "group", "name": "London Terminals",
    "stations": [ { "crs": "PAD", "name": "London Paddington" }, { "crs": "KGX", "name": "London Kings Cross" }, … ] } },
  "calling_at": null, "from_time": null, "to_time": null, "limit": 15
}
```

`data` can be an empty list. Empty means "no trains". A station we couldn't
work out is an error, never an empty list.

## The building blocks

These appear all over. The full set, with every endpoint's request and
data, is [`v1.d.ts`](v1.d.ts).

```ts
type Station = { crs: string; name: string };

/** Somewhere a train is or calls. Junctions and sidings have no code. */
type Place =
  | { type: "station"; crs: string; name: string }
  | { type: "location"; name: string };

type Operator = { code: string; name: string | null }; // { "code": "GW", "name": "Great Western Railway" }

type ServiceClass = "passenger" | "bus" | "freight" | "ship" | "trip" | "empty_stock" | "unknown";

/** A timetabled time and what is known about it. */
type Time = {
  scheduled: string;
  estimate: Estimate;
  delay_minutes: number | null; // when the estimate has a time; negative is early
};

type Estimate =
  | { type: "actual"; at: string }                                      // it has happened
  | { type: "forecast"; at: string; source: "darwin" | "live_report" }  // expected then
  | { type: "delayed_no_estimate" }                                     // late, nobody can say how late
  | { type: "no_information" }                                          // nothing live yet: not "on time"
  | { type: "cancelled" };                                              // won't happen

type Platform =
  | { type: "known"; number: string; source: "actual" | "forecast" | "timetable" } // "4A" is a platform
  | { type: "withheld" }                                                           // not to be shown yet
  | { type: "unknown" };

type Train = {
  id: string | null;      // TRUST id, e.g. 671L50MK02. null until the train is activated
  uid: string | null;     // timetable uid, e.g. GW001
  headcode: string;       // e.g. 1L50. These repeat across the country
  operator: Operator | null;
};
```

A `forecast` from `darwin` is National Rail's prediction, the best there is
before a train leaves. One from `live_report` is the delay the train last
reported, carried forward. A `timetable` platform is planned only, and
often wrong at big stations.

## Stations

Anywhere you give a station (in a path, or as `calling_at`) you can use:

- a **code**: `PAD`, `KGX`, `CDU`
- a **name**, in any word order: `London Paddington`, `paddington`,
  `Cam & Dursley` (in a path: `Cam%20%26%20Dursley`)
- a **group**: `London`, `Birmingham`, `Manchester`, `Glasgow`, `Edinburgh`

Exact codes win, then exact names, then the busiest match, so `Paddington`
means the main station rather than the Elizabeth line platforms. If a name
really is ambiguous (`bradford`), you get a `station_ambiguous` error with
candidates instead of a guess.

```ts
type StationArgument = { query: string; resolution: Resolution };
type Resolution =
  | { type: "station"; crs: string; name: string }
  | { type: "group"; name: string; stations: Station[] };
```

## Endpoints

### Departures

`GET /v1/departures/{station}`. The live departure board. 3 units.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | 15 | 1–100 |
| `from_time` | now | Only trains leaving at or after this time |
| `to_time` | — | Only trains leaving at or before this time |
| `calling_at` | — | Only trains that stop here later on |

Late trains stay on the board until their *expected* time passes.

```ts
type Departure = {
  train: Train;
  service_class: ServiceClass;
  origin: Place;
  destination: Place;
  departs: Time;                         // from the station you asked about
  platform: Platform;
  calling_points: { station: Place; time: Time; platform: Platform }[];
  destination_arrival: string | null;    // booked arrival at its destination
  coaches: number | null;                // from Darwin, when it says
  formation_changes: ({ type: "divides"; at: Place } | { type: "joins"; at: Place })[];
  formed_from: { headcode: string; origin: Place; expected_arrival: string | null } | null;
  delay_reason: string | null;
  advertised: boolean;                   // false: Darwin asks for this stop to be kept off boards
};
```

<details>
<summary><b>Example</b></summary>

<br>

```sh
curl 'https://api.traini.ac/v1/departures/Stroud?limit=1'
```

```json
{
  "type": "ok",
  "request": {
    "station": { "query": "Stroud", "resolution": { "type": "station", "crs": "STD", "name": "Stroud" } },
    "calling_at": null, "from_time": null, "to_time": null, "limit": 1
  },
  "data": [
    {
      "train": { "id": "671L50MK02", "uid": "GW001", "headcode": "1L50",
                 "operator": { "code": "GW", "name": "Great Western Railway" } },
      "service_class": "passenger",
      "origin": { "type": "station", "crs": "GCR", "name": "Gloucester" },
      "destination": { "type": "station", "crs": "PAD", "name": "London Paddington" },
      "departs": {
        "scheduled": "2026-10-05T13:00:00+01:00",
        "estimate": { "type": "forecast", "at": "2026-10-05T13:05:00+01:00", "source": "darwin" },
        "delay_minutes": 5
      },
      "platform": { "type": "known", "number": "1", "source": "forecast" },
      "calling_points": [
        { "station": { "type": "station", "crs": "KEM", "name": "Kemble" },
          "time": { "scheduled": "2026-10-05T13:13:00+01:00", "estimate": { "type": "no_information" }, "delay_minutes": null },
          "platform": { "type": "unknown" } },
        …
      ],
      "destination_arrival": "2026-10-05T14:26:00+01:00",
      "coaches": null,
      "formation_changes": [],
      "formed_from": null,
      "delay_reason": null,
      "advertised": true
    }
  ],
  "generated_at": "2026-10-05T12:00:00+01:00"
}
```

</details>

### Journey

`GET /v1/journey/{from}/{to}`. Today's trains between two stations,
including ones with changes, in departure order. Connections are checked
against live running. 5 units, or 2 with `max_changes=0`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | 10 | 1–100 options |
| `max_changes` | 1 | 0–8. `0` means direct trains only |
| `min_interchange_min` | 5 | 1–60. The least time to allow for a change |
| `from_time` / `to_time` | now / — | When to leave, UK time |

```ts
type Journey =
  | { type: "direct"; departs: Time; arrives: Time; duration_minutes: number; leg: Leg }
  | { type: "with_changes"; departs: Time; arrives: Time; duration_minutes: number;
      legs: Leg[]; connections: Connection[] }; // connections[i] joins legs[i] to legs[i + 1]

type Leg = {
  train: Train;
  service_class: ServiceClass;
  from: Place | null;    // null only when you asked from a group and we can't say which station
  departs: Time;
  departure_platform: Platform;
  to: Place;
  arrives: Time;
  arrival_platform: Platform;
  coaches: number | null;
};

type Connection = {
  at: Place;
  minutes: number;                          // timetabled time to change
  outlook: "safe" | "at_risk" | "unknown";  // at_risk: live running eats into the change
};
```

<details>
<summary><b>Example</b></summary>

<br>

```json
{
  "type": "direct",
  "departs": { "scheduled": "2026-10-05T13:00:00+01:00",
               "estimate": { "type": "forecast", "at": "2026-10-05T13:05:00+01:00", "source": "darwin" },
               "delay_minutes": 5 },
  "arrives": { "scheduled": "2026-10-05T14:26:00+01:00",
               "estimate": { "type": "forecast", "at": "2026-10-05T14:30:00+01:00", "source": "darwin" },
               "delay_minutes": 4 },
  "duration_minutes": 86,
  "leg": {
    "train": { "id": "671L50MK02", "uid": "GW001", "headcode": "1L50",
               "operator": { "code": "GW", "name": "Great Western Railway" } },
    "service_class": "passenger",
    "from": { "type": "station", "crs": "STD", "name": "Stroud" },
    "departs": { … },
    "departure_platform": { "type": "known", "number": "1", "source": "forecast" },
    "to": { "type": "station", "crs": "PAD", "name": "London Paddington" },
    "arrives": { … },
    "arrival_platform": { "type": "unknown" },
    "coaches": null
  }
}
```

A journey with changes has `legs` and `connections` instead of `leg`:

```json
"connections": [ { "at": { "type": "station", "crs": "SWI", "name": "Swindon" }, "minutes": 5, "outlook": "at_risk" } ]
```

</details>

### Train

`GET /v1/train?headcode=1A23` or `GET /v1/train?train_id=171A23MN16`.
Where one train is right now. 1 unit.

| Parameter | Meaning |
| --- | --- |
| `headcode` | The four-character train number, e.g. `1A23` |
| `train_id` | The exact id from a departure or journey. Never ambiguous |
| `operator`, `origin`, `destination` | Narrow a headcode down |
| `date` | `YYYY-MM-DD` for a past run. Defaults to the last 12 hours |

You need `headcode` or `train_id`. Headcodes repeat, so a headcode alone
can return up to ten trains, most recently seen first.

```ts
type TrainRun = {
  train: Train;
  run_date: string;
  origin: Place | null;        // null when no timetable matched (some freight)
  destination: Place | null;
  progress:
    | { type: "not_started"; activated: boolean; departs: string; arrives: string | null }
    | { type: "running"; last_report: Report }
    | { type: "finished"; last_report: Report };
};

type Report = {
  location: Place | null;
  at: string;
  event: "arrival" | "departure";   // a train passing through is reported as a departure
  delay_minutes: number;
  off_route: boolean;
  platform: Platform;
};
```

<details>
<summary><b>Example</b></summary>

<br>

```json
{
  "train": { "id": "671L50MK02", "uid": "GW001", "headcode": "1L50",
             "operator": { "code": "GW", "name": "Great Western Railway" } },
  "run_date": "2026-10-05",
  "origin": { "type": "station", "crs": "GCR", "name": "Gloucester" },
  "destination": { "type": "station", "crs": "PAD", "name": "London Paddington" },
  "progress": {
    "type": "running",
    "last_report": {
      "location": { "type": "station", "crs": "GCR", "name": "Gloucester" },
      "at": "2026-10-05T11:55:00+01:00", "event": "departure", "delay_minutes": 3,
      "off_route": false, "platform": { "type": "known", "number": "2", "source": "actual" }
    }
  }
}
```

Nothing at all (not in today's timetable, not seen in the last 12 hours)
is a `train_not_found` error.

</details>

### Station search

`GET /v1/stations?q=paddington`. Find a station's code. Words match in any
order, best match first. 1 unit.

```ts
type StationSearch = {
  resolves_to: Resolution | null;   // the group, alias or landmark your words name, if any
  matches: StationMatch[];
  near_misses: boolean;             // true: nothing matched as written; these are the closest
};
type StationMatch =
  | { type: "station"; crs: string; name: string; tiploc: string; stanox: string | null; calls_today: number }
  | { type: "location"; kind: "depot" | "infrastructure" | "other"; name: string; crs: string | null;
      tiploc: string; stanox: string | null; calls_today: number };
```

<details>
<summary><b>Example</b></summary>

<br>

```json
{
  "resolves_to": { "type": "station", "crs": "PAD", "name": "London Paddington" },
  "matches": [
    { "type": "station", "crs": "PAD", "name": "London Paddington", "tiploc": "PADTON", "stanox": "73000", "calls_today": 1804 },
    { "type": "location", "kind": "depot", "name": "Paddington New Yard", "crs": null, "tiploc": "PADTNNY", "stanox": "73104", "calls_today": 0 }
  ],
  "near_misses": false
}
```

`stanox` and `tiploc` are Network Rail's location codes, for joining with
other open data.

</details>

### Station activity

`GET /v1/stations/{station}/activity?limit=15`. What actually happened at a
station in the last three hours, newest first. 1 unit.

```ts
type Movement = {
  train: { id: string; headcode: string };
  location: Place;
  event: "arrival" | "departure";
  time: Time;            // estimate is always { type: "actual" }
  platform: Platform;
  off_route: boolean;
};
```

### Delays

`GET /v1/delays?min_minutes=10&limit=15&passenger_only=true`. The most
delayed trains running right now, worst first. 1 unit.

```ts
type DelayedTrain = {
  train: Train;
  service_class: ServiceClass;
  origin: Place | null;
  destination: Place | null;
  delay_minutes: number;
  off_route: boolean;
  last_seen: { location: Place | null; at: string };
};
```

### Cancellations

`GET /v1/cancellations?limit=15&passenger_only=false`. Today's
cancellations, newest first, with the reason in plain English. 1 unit.

```ts
type Cancellation = {
  train: Train;
  service_class: ServiceClass;
  origin: Place | null;          // null when it was cancelled before we knew its timetable
  destination: Place | null;
  cancelled:
    | { type: "before_departure"; at: Place }   // never left its origin
    | { type: "part_way"; at: Place }           // ran, then cancelled from here on
    | { type: "not_needed"; at: Place }         // an "on call" train that wasn't called on
    | { type: "off_booked_path"; at: Place };   // cancelled while off its booked route
  reason: { code: string; description: string; category: string; planned: boolean };
  reported_at: string;
  keyed_at: string;   // when it went into the system: hours earlier for a planned one
};
```

`reason.planned` is true for planned reductions (engineering work and the
like), which you may want to leave out of a "what went wrong today" view.

<details>
<summary><b>Example</b></summary>

<br>

```json
{
  "train": { "id": "671L60MK02", "uid": "GW007", "headcode": "1L60",
             "operator": { "code": "GW", "name": "Great Western Railway" } },
  "service_class": "passenger",
  "origin": { "type": "station", "crs": "STD", "name": "Stroud" },
  "destination": { "type": "station", "crs": "PAD", "name": "London Paddington" },
  "cancelled": { "type": "not_needed", "at": { "type": "station", "crs": "GCR", "name": "Gloucester" } },
  "reason": { "code": "YI", "description": "Late arrival of booked inward stock (…)", "category": "Reactionary", "planned": false },
  "reported_at": "2026-10-05T11:30:00+01:00",
  "keyed_at": "2026-10-05T10:30:00+01:00"
}
```

</details>

### Summary

`GET /v1/summary`. Today's headline numbers, as one object. 1 unit.

```json
{
  "service_date": "2026-10-05",
  "scheduled": 38444,
  "started": 1078,
  "running_now": { "count": 31, "window_minutes": 30 },
  "cancelled": { "total": 325, "planned": 186 },
  "punctuality": {
    "on_time_percent": 58.0,
    "definition": "share of public calls today whose actual was at or before the timetabled time, so to the minute, not the PPM 5/10 threshold",
    "average_lateness_minutes": 6.18
  },
  "movement_reports_today": 10131
}
```

`on_time_percent` counts to the minute, so it looks much worse than the
official figures, which allow 5 or 10 minutes.

### Status

`GET /v1/status`. Whether the API is answering, how fresh each feed is, and
how many trains are running. Answered from a snapshot at most 15 seconds
old: 1 unit, never waits for the database.

```ts
type Status = {
  health: "ok" | "degraded";   // ok only when every feed is fresh
  feeds: { trust: Feed; td: Feed; darwin: Feed };
  trains_running: { type: "counted"; count: number } | { type: "unknown" };
  measured_at: string;
};
type Feed = {
  stale_after_seconds: number;
  freshness:
    | { type: "fresh"; last_stored_seconds_ago: number }
    | { type: "stale"; last_stored_seconds_ago: number }
    | { type: "silent" }     // nothing for hours
    | { type: "unknown" };   // we couldn't check
};
```

## When something goes wrong

Errors are `{"type": "error", "error": {…}}`, and the HTTP status tells you
whose problem it is. Switch on `error.type`; `message` is for logs.

```ts
type ApiError = { message: string } & (
  | { type: "station_not_found"; parameter: string; query: string; did_you_mean: Station[] } // 404
  | { type: "station_ambiguous"; parameter: string; query: string; candidates: Station[] }  // 400
  | { type: "same_station" }                                                                // 400
  | { type: "parameter_out_of_range"; parameter: string; value: number; min: number; max: number } // 400
  | { type: "invalid_parameter"; parameter: string; value: string;
      expected: "integer" | "boolean" | "time" | "date" | "headcode" }                      // 400
  | { type: "missing_parameter"; parameters: string[] }  // 400: give at least one of these
  | { type: "train_not_found" }                          // 404
  | { type: "not_found" }                                // 404: no such endpoint
  | { type: "method_not_allowed" }                       // 405
  | { type: "rate_limited"; retry_after_seconds: number } // 429
  | { type: "database_busy"; retry_after_seconds: number } // 503
  | { type: "database_unavailable" }                     // 503
  | { type: "query_failed" }                             // 503
  | { type: "status_unavailable"; retry_after_seconds: number } // 503
  | { type: "internal_error" }                           // 500: our bug
);
```

`parameter` is the name you used: `station`, `from`, `to` or `calling_at`
for stations.

```
GET /v1/departures/bradford                  → 400
{"type":"error","error":{"type":"station_ambiguous","parameter":"station","query":"bradford",
 "candidates":[{"crs":"BDI","name":"Bradford Interchange"},{"crs":"BDQ","name":"Bradford Forster Square"}, …],
 "message":"'bradford' (station) matches more than one station. Ask again with one of the candidates' CRS codes."}}

GET /v1/departures/PAD?from_time=25:99       → 400
{"type":"error","error":{"type":"invalid_parameter","parameter":"from_time","value":"25:99","expected":"time",
 "message":"from_time must be a time, HH:MM or HHMM; got '25:99'."}}
```

## Use it from code

```ts
import type { Answer } from "./v1"; // v1.d.ts from this repo

const res = await fetch(`https://api.traini.ac/v1/departures/${crs}?limit=10`);
const body = (await res.json()) as Answer<"/v1/departures/{station}">;
if (body.type === "error") throw new Error(`${body.error.type}: ${body.error.message}`);

for (const d of body.data) {
  const when =
    d.departs.estimate.type === "forecast" ? `exp ${d.departs.estimate.at.slice(11, 16)}`
    : d.departs.estimate.type === "cancelled" ? "cancelled"
    : d.departs.estimate.type === "delayed_no_estimate" ? "delayed"
    : "";
  console.log(d.departs.scheduled.slice(11, 16), d.destination.name, when);
}
```

Percent-encode station names in paths (`encodeURIComponent`,
`urllib.parse.quote`). Three small examples you can run are in
[`examples/`](examples/):

- [`next-train.sh`](examples/next-train.sh): curl and jq, the next train from A to B
- [`departures.ts`](examples/departures.ts): a departure board in your terminal (Bun), typed with `v1.d.ts`
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

## Fair use

It's free, and the limits are the same for everyone. They count **units of
work**, not requests, across `/v1`, `/api` and `/mcp` together:

| Request | Units |
| --- | --- |
| [Journey](#journey) | 5 |
| [Journey](#journey) with `max_changes=0` (direct trains only) | 2 |
| [Departures](#departures) | 3 |
| Everything else | 1 |

- **120 units a minute per address** (about 40 departure boards). Go over
  and you get a **429** `rate_limited` with `Retry-After`.
- **20 units running at once across everyone.** If the database is busy, a
  request waits up to two seconds, then gets a **503** `database_busy` with
  `Retry-After: 1`.

Every answer tells you where you stand, in headers a browser can read too:
`X-Request-Units` (what this cost), `RateLimit-Limit`, `RateLimit-Remaining`,
`RateLimit-Reset` and `RateLimit-Policy` (`120;w=60`).

Please honour `Retry-After`, cache what you can (a departure board doesn't
change faster than every 30 seconds or so), and send a `User-Agent` that
says who you are. Requests are logged (endpoint, timing, status, forwarded
IP, user agent) to keep the usage dashboards honest. Nothing else is kept.

## Legacy: `/api`

The same endpoints were first served under `/api`, in the MCP tools' own
JSON (`{generated_at, resolved, results, result_count}`). That is legacy:
it still works, unchanged, but it will be removed once its last users have
moved to `/v1`. Don't build anything new on it. [MIGRATING.md](MIGRATING.md)
maps every old field to its `/v1` home.

## Where the data comes from

Network Rail's open data feeds (TRUST movements, TD berth steps, VSTP,
TSR, the CIF timetable and CORPUS location names) and National Rail's
Darwin Push Port; station names from
[uk-railway-stations](https://github.com/davwheat/uk-railway-stations).
Times are what those feeds said: nothing is smoothed or made up. Data ©
Network Rail Infrastructure Limited and Rail Delivery Group, used under
their open data licences.

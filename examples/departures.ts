// A departure board in the terminal.
//
//   bun examples/departures.ts PAD
//   bun examples/departures.ts "London Paddington" --calling-at RDG

import type { Answer, Departure, Time } from "../v1";

const API = "https://api.traini.ac/v1";

async function departures(station: string, callingAt?: string) {
  const query = new URLSearchParams({ limit: "10" });
  if (callingAt) query.set("calling_at", callingAt);
  const url = `${API}/departures/${encodeURIComponent(station)}?${query}`;
  const res = await fetch(url, { headers: { "User-Agent": "trainiac-docs-example" } });
  return (await res.json()) as Answer<"/v1/departures/{station}">;
}

const clock = (iso: string) => iso.slice(11, 16);

// Every state is its own `type`, so the board reads straight off it.
function status(time: Time): string {
  const e = time.estimate;
  switch (e.type) {
    case "actual":
      return `Departed ${clock(e.at)}`;
    case "forecast":
      return time.delay_minutes && time.delay_minutes > 0 ? `Expected ${clock(e.at)}` : "On time";
    case "delayed_no_estimate":
      return "Delayed";
    case "cancelled":
      return "Cancelled";
    case "no_information":
      return "Scheduled";
  }
}

function platform(d: Departure): string {
  switch (d.platform.type) {
    case "known":
      return `plat ${d.platform.number}`;
    case "withheld":
    case "unknown":
      return "plat —";
  }
}

const [station, ...rest] = Bun.argv.slice(2);
if (!station) {
  console.error("usage: bun examples/departures.ts <station> [--calling-at <station>]");
  process.exit(2);
}
const callingAt = rest[0] === "--calling-at" ? rest[1] : undefined;

const board = await departures(station, callingAt);
if (board.type === "error") {
  const e = board.error;
  const choices = e.type === "station_ambiguous" ? e.candidates : e.type === "station_not_found" ? e.did_you_mean : [];
  console.error(`${e.type}: ${e.message}`);
  for (const c of choices) console.error(`  ${c.crs}  ${c.name}`);
  process.exit(1);
}

const asked = board.request.station.resolution;
console.log(`${asked.name} — ${board.data.length} departures at ${clock(board.generated_at)}\n`);
for (const d of board.data) {
  const operator = d.train.operator?.name ?? d.train.operator?.code ?? "";
  console.log(
    `${clock(d.departs.scheduled)}  ${d.destination.name.padEnd(28)} ${platform(d).padEnd(8)} ${status(d.departs).padEnd(16)} [${d.train.headcode} ${operator}]`,
  );
}

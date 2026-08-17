// A departure board in the terminal.
//
//   bun examples/departures.ts PAD
//   bun examples/departures.ts "London Paddington" --calling-at RDG

const API = "https://api.traini.ac/api";

type Place = { name: string; crs: string | null };
type Departure = {
  departs: string;
  expected_departs: string | null;
  headcode: string;
  operator: string;
  destination: Place;
  status: string;
  status_text: string;
  platform: string | null;
  platform_source: string | null;
  data_source: string;
};
type Envelope<T> = {
  generated_at: string;
  resolved: { station: Place & { group?: boolean } };
  results: T[];
  result_count: number;
};
type Refusal = { error: string; message?: string; hint?: string };

async function departures(station: string, callingAt?: string) {
  const query = new URLSearchParams({ limit: "10" });
  if (callingAt) query.set("calling_at", callingAt);
  const url = `${API}/departures/${encodeURIComponent(station)}?${query}`;

  const res = await fetch(url, { headers: { "User-Agent": "trainiac-docs-example" } });
  const body = await res.json();
  if (!res.ok) {
    const why = body as Refusal;
    throw new Error(`${res.status} ${why.error}${why.message ? `: ${why.message}` : ""}${why.hint ? ` — ${why.hint}` : ""}`);
  }
  return body as Envelope<Departure>;
}

const clock = (iso: string) => iso.slice(11, 16);

const [station, ...rest] = Bun.argv.slice(2);
if (!station) {
  console.error("usage: bun examples/departures.ts <station> [--calling-at <station>]");
  process.exit(2);
}
const callingAt = rest[0] === "--calling-at" ? rest[1] : undefined;

let board: Envelope<Departure>;
try {
  board = await departures(station, callingAt);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
console.log(`${board.resolved.station.name} — ${board.result_count} departures at ${clock(board.generated_at)}\n`);
for (const d of board.results) {
  const expected = d.expected_departs && d.expected_departs !== d.departs ? ` (exp ${clock(d.expected_departs)})` : "";
  const platform = d.platform ? `plat ${d.platform}` : "plat —";
  console.log(
    `${clock(d.departs)}${expected.padEnd(12)} ${d.destination.name.padEnd(28)} ${platform.padEnd(8)} ${d.status_text}  [${d.headcode} ${d.operator}]`,
  );
}

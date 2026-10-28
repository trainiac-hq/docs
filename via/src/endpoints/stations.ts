import type { StationsRequest, StationSearch, StationMatch, Resolution } from "../v1.d.ts";
import type { Ctx } from "../context.ts";

/**
 * Find a station's code from a query. VIA has no TIPLOC/STANOX, so the contract's
 * `tiploc` carries VIA's own four-letter code and `stanox` the GTFS stop id,
 * which are the keys for joining with VIA's other open data.
 */
export function stations(ctx: Ctx, q: string): { request: StationsRequest; data: StationSearch } {
	const matches = ctx.reg.search(q);

	let resolves_to: Resolution | null = null;
	const group = ctx.reg.group(q);
	if (group) {
		resolves_to = { type: "group", name: group.name, stations: group.stations.map(ctx.reg.toStation) };
	} else {
		const r = ctx.reg.resolve(q, ctx.callsByCode);
		if (r.kind === "ok") resolves_to = r.resolution;
	}

	let list = matches;
	let near_misses = false;
	if (list.length === 0) {
		near_misses = true;
		list = ctx.reg.closest(q, 5).map((station) => ({ station, score: 0 }));
	}

	const data: StationSearch = {
		resolves_to,
		matches: list.slice(0, 20).map(({ station }): StationMatch => ({
			type: "station",
			crs: station.code,
			name: station.name,
			tiploc: station.code,
			stanox: null,
			calls_today: ctx.callsByCode.get(station.code) ?? 0,
		})),
		near_misses,
	};
	return { request: { q }, data };
}

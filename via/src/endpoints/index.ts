import type { Index } from "../v1.d.ts";

/** The self-describing root: what this coverage area answers. */
export function index(): Index {
	return {
		name: "Trainiac — VIA Rail (Canada)",
		description:
			"Live Canadian passenger rail from VIA Rail's open feeds (the live tracker and the GTFS timetable), in the Trainiac /v1 shape.",
		openapi: "/openapi.v1.json",
		docs: "https://github.com/trainiac-hq/docs",
		mcp: "/mcp",
		terms: "Personal, non-commercial use. Data © VIA Rail Canada, under the Open Government Licence – Canada 2.0.",
		endpoints: [
			{ path: "/v1/departures/{station}", query: ["limit", "from_time", "to_time", "calling_at"], description: "Live departure board." },
			{ path: "/v1/journey/{from}/{to}", query: ["limit", "max_changes", "min_interchange_min", "from_time", "to_time"], description: "Trains from A to B, with changes." },
			{ path: "/v1/train", query: ["headcode", "train_id", "operator", "origin", "destination", "date"], description: "Where a train is." },
			{ path: "/v1/stations", query: ["q"], description: "Find a station's code." },
			{ path: "/v1/stations/{station}/activity", query: ["limit"], description: "Movements at a station in the last 3 hours." },
			{ path: "/v1/delays", query: ["min_minutes", "limit", "passenger_only"], description: "The worst-delayed trains running now." },
			{ path: "/v1/cancellations", query: ["limit", "passenger_only"], description: "Today's cancellations." },
			{ path: "/v1/summary", query: [], description: "Today's headline numbers." },
			{ path: "/v1/status", query: [], description: "Feed freshness and trains running." },
		],
	};
}

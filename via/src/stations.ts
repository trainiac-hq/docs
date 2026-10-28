// Resolving a station the way the contract promises: a code, a name in any
// word order, or a group of stations that share a city. Exact code wins, then
// exact name, then a group, then the busiest word-match; a genuinely ambiguous
// name returns candidates rather than a guess.

import type { Resolution, Station } from "./v1.d.ts";
import type { StationRef } from "./model.ts";

export type Resolved =
	| { kind: "ok"; resolution: Resolution; stations: StationRef[] }
	| { kind: "ambiguous"; candidates: Station[] }
	| { kind: "not_found"; didYouMean: Station[] };

function normalize(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "") // strip accents
		.toLowerCase()
		.replace(/[().,'&/-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function baseName(name: string): string {
	return name.split(" (")[0].trim();
}

export type Group = { name: string; stations: StationRef[] };

export class Registry {
	readonly stations: StationRef[];
	private readonly byCode = new Map<string, StationRef>();
	private readonly groupsByNorm = new Map<string, Group>();

	constructor(stations: StationRef[]) {
		this.stations = stations;
		for (const s of stations) this.byCode.set(s.code.toUpperCase(), s);

		// Data-driven groups: a base city name shared by two or more stations
		// (e.g. "Sudbury" + "Sudbury (Jct.)") becomes a group.
		const byBase = new Map<string, StationRef[]>();
		for (const s of stations) {
			const base = baseName(s.name);
			const arr = byBase.get(base) ?? [];
			arr.push(s);
			byBase.set(base, arr);
		}
		for (const [base, group] of byBase) {
			if (group.length >= 2) this.groupsByNorm.set(normalize(base), { name: base, stations: group });
		}
	}

	station(code: string): StationRef | undefined {
		return this.byCode.get(code.toUpperCase());
	}

	toStation = (s: StationRef): Station => ({ crs: s.code, name: s.name });

	/**
	 * Resolve a free-form query. `callsByCode` ranks ties by how busy a station
	 * is today, so "the main one" wins over a quiet namesake.
	 */
	resolve(query: string, callsByCode: Map<string, number>): Resolved {
		const q = query.trim();
		if (!q) return { kind: "not_found", didYouMean: [] };

		// 1. Exact code.
		const byCode = this.byCode.get(q.toUpperCase());
		if (byCode) return this.okStation(byCode);

		const nq = normalize(q);

		// 2. Exact name.
		const exact = this.stations.filter((s) => normalize(s.name) === nq);
		if (exact.length === 1) return this.okStation(exact[0]);
		if (exact.length > 1) return this.pickBusiest(exact, callsByCode);

		// 3. Group (a shared city name).
		const group = this.groupsByNorm.get(nq);
		if (group) {
			return {
				kind: "ok",
				resolution: { type: "group", name: group.name, stations: group.stations.map(this.toStation) },
				stations: group.stations,
			};
		}

		// 4. All query words appear in the name, in any order.
		const tokens = nq.split(" ").filter(Boolean);
		const word = this.stations.filter((s) => {
			const n = normalize(s.name);
			return tokens.every((t) => n.includes(t));
		});
		if (word.length === 1) return this.okStation(word[0]);
		if (word.length > 1) return this.pickBusiest(word, callsByCode);

		// 5. Nothing matched: offer the closest names.
		return { kind: "not_found", didYouMean: this.closest(nq).map(this.toStation) };
	}

	private okStation(s: StationRef): Resolved {
		return { kind: "ok", resolution: { type: "station", crs: s.code, name: s.name }, stations: [s] };
	}

	private pickBusiest(matches: StationRef[], callsByCode: Map<string, number>): Resolved {
		const ranked = [...matches].sort((a, b) => (callsByCode.get(b.code) ?? 0) - (callsByCode.get(a.code) ?? 0));
		const top = callsByCode.get(ranked[0].code) ?? 0;
		const second = callsByCode.get(ranked[1].code) ?? 0;
		if (top > second) return this.okStation(ranked[0]);
		return { kind: "ambiguous", candidates: ranked.slice(0, 10).map(this.toStation) };
	}

	/** Fuzzy: rank by shared words, then substring, then a cheap distance. */
	closest(nq: string, limit = 5): StationRef[] {
		const tokens = nq.split(" ").filter(Boolean);
		const scored = this.stations
			.map((s) => {
				const n = normalize(s.name);
				let score = 0;
				for (const t of tokens) if (n.includes(t)) score += t.length;
				if (n.includes(nq)) score += 2;
				score -= distance(nq, n) * 0.1;
				return { s, score };
			})
			.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit).map((x) => x.s);
	}

	/** Search for the stations endpoint: ranked matches with word-order tolerance. */
	search(query: string): { station: StationRef; score: number }[] {
		const nq = normalize(query);
		const tokens = nq.split(" ").filter(Boolean);
		return this.stations
			.map((s) => {
				const n = normalize(s.name);
				const code = s.code.toLowerCase();
				let score = 0;
				if (code === nq) score += 100;
				if (n === nq) score += 90;
				if (n.startsWith(nq)) score += 30;
				for (const t of tokens) if (n.includes(t)) score += 10;
				if (n.includes(nq)) score += 5;
				return { station: s, score };
			})
			.filter((x) => x.score > 0)
			.sort((a, b) => b.score - a.score);
	}

	group(nq: string): Group | undefined {
		return this.groupsByNorm.get(normalize(nq));
	}
}

/** Bounded Levenshtein, enough for "did you mean". */
function distance(a: string, b: string): number {
	if (Math.abs(a.length - b.length) > 8) return 9;
	const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
	for (let j = 1; j <= b.length; j++) {
		let prev = dp[0];
		dp[0] = j;
		for (let i = 1; i <= a.length; i++) {
			const tmp = dp[i];
			dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = tmp;
		}
	}
	return dp[a.length];
}

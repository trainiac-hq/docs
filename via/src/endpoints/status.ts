import type { Status, Feed, Freshness } from "../v1.d.ts";
import type { Ctx } from "../context.ts";

// The contract fixes `feeds` to { trust, td, darwin } — Network Rail / National
// Rail feed names with no VIA equivalent. To stay type-compatible we map the
// VIA live tracker onto `trust` (it is the movement feed) and report `td` and
// `darwin` as unknown. This is the one place the contract itself is UK-shaped;
// a VIA-native deployment would rename these keys. See README "Known divergences".

const LIVE_STALE_AFTER = 300; // the tracker leans on cellular; 5 min is a fair bar

export function status(ctx: Ctx): Status {
	const age = ctx.snap.liveAgeSeconds;
	const trackerFreshness: Freshness =
		age === null
			? { type: "silent" }
			: age <= LIVE_STALE_AFTER
				? { type: "fresh", last_stored_seconds_ago: age }
				: { type: "stale", last_stored_seconds_ago: age };

	const trust: Feed = { stale_after_seconds: LIVE_STALE_AFTER, freshness: trackerFreshness };
	const notApplicable: Feed = { stale_after_seconds: LIVE_STALE_AFTER, freshness: { type: "unknown" } };

	const running = ctx.snap.runs.filter((r) => r.live?.departed && !r.live.arrived).length;
	const healthy = trackerFreshness.type === "fresh";

	return {
		health: healthy ? "ok" : "degraded",
		feeds: { trust, td: notApplicable, darwin: notApplicable },
		trains_running: { type: "counted", count: running },
		measured_at: ctx.now.toISOString(),
	};
}

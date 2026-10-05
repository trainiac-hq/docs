#!/usr/bin/env python3
"""Plan a journey and flag connections that live running has put at risk.

    python3 examples/journey.py PAD "Cam & Dursley"
    python3 examples/journey.py KGX CBG --from 17:00 --max-changes 0

Standard library only.
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.traini.ac/v1"


def clock(time):
    """A Time: the scheduled clock, and what is expected of it."""
    at = time["scheduled"][11:16]
    estimate = time["estimate"]
    if estimate["type"] in ("actual", "forecast") and time["delay_minutes"]:
        return f"{at} (exp {estimate['at'][11:16]})"
    if estimate["type"] == "cancelled":
        return f"{at} (cancelled)"
    if estimate["type"] == "delayed_no_estimate":
        return f"{at} (delayed)"
    return at


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("origin")
    ap.add_argument("destination")
    ap.add_argument("--from", dest="from_time", help="HH:MM, UK time")
    ap.add_argument("--max-changes", type=int, default=1)
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()

    url = f"{API}/journey/{urllib.parse.quote(args.origin)}/{urllib.parse.quote(args.destination)}"
    query = {"limit": args.limit, "max_changes": args.max_changes, "from_time": args.from_time}
    url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
    req = urllib.request.Request(url, headers={"User-Agent": "trainiac-docs-example"})
    try:
        with urllib.request.urlopen(req) as res:
            body = json.load(res)
    except urllib.error.HTTPError as e:
        # Every refusal is {"type": "error", "error": {"type": ..., "message": ...}}.
        error = json.load(e)["error"]
        detail = error["message"]
        candidates = error.get("candidates") or error.get("did_you_mean")
        if candidates:
            detail += " Try: " + ", ".join(f"{c['crs']} ({c['name']})" for c in candidates[:5])
        sys.exit(f"HTTP {e.code} {error['type']}. {detail}")

    asked = body["request"]
    print(f"{asked['from']['resolution']['name']} → {asked['to']['resolution']['name']}  "
          f"({len(body['data'])} options)\n")

    for journey in body["data"]:
        line = f"{clock(journey['departs'])} → {clock(journey['arrives'])}  {journey['duration_minutes']:>3} min  "
        if journey["type"] == "direct":
            train = journey["leg"]["train"]
            operator = (train["operator"] or {}).get("name") or ""
            line += f"direct  {train['headcode']} {operator}"
        else:
            changes = journey["connections"]
            via = ", ".join(f"{c['at']['name']} ({c['minutes']} min)" for c in changes)
            line += f"{len(changes)} change{'s' if len(changes) > 1 else ''} at {via}"
            if any(c["outlook"] == "at_risk" for c in changes):
                line += "  ⚠ connection at risk"
        print(line)


if __name__ == "__main__":
    main()

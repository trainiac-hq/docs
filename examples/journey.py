#!/usr/bin/env python3
"""Plan a journey and flag connections that live delays have put at risk.

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

API = "https://api.traini.ac/api"


def get(path, **query):
    query = {k: v for k, v in query.items() if v is not None}
    url = f"{API}{path}?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "trainiac-docs-example"})
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        # Every refusal is a JSON object with `error`; read it rather than the status alone.
        why = json.load(e)
        detail = why.get("message") or why.get("hint") or ""
        candidates = why.get("candidates") or why.get("did_you_mean")
        if candidates:
            detail += " Try: " + ", ".join(f"{c['crs']} ({c['name']})" for c in candidates[:5])
        sys.exit(f"HTTP {e.code} {why['error']}. {detail}".strip())


def clock(iso):
    return iso[11:16] if iso else "--:--"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("origin")
    ap.add_argument("destination")
    ap.add_argument("--from", dest="from_time", help="HH:MM, UK time")
    ap.add_argument("--max-changes", type=int, default=1)
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()

    body = get(
        f"/journey/{urllib.parse.quote(args.origin)}/{urllib.parse.quote(args.destination)}",
        limit=args.limit,
        max_changes=args.max_changes,
        from_time=args.from_time,
    )
    r = body["resolved"]
    print(f"{r['from']['name']} → {r['to']['name']}  ({body['result_count']} options)\n")

    for it in body["results"]:
        line = f"{clock(it['departs'])} → {clock(it['arrives'])}  {it['duration_minutes']:>3} min  "
        if it["changes"] == 0:
            line += f"direct  {it['headcode']} {it['operator']}, {it['status_text']}"
        elif it["changes"] == 1:
            line += f"change at {it['interchange']['name']} ({it['connection_minutes']} min)"
        else:
            via = ", ".join(p["name"] for p in it["interchanges"])
            line += f"{it['changes']} changes via {via} (tightest {it['connection_minutes']} min)"
        if it.get("connection_status") == "at risk":
            line += "  ⚠ connection at risk"
        print(line)


if __name__ == "__main__":
    main()

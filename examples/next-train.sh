#!/usr/bin/env bash
# The next train from A to B, with its platform and status.
#
#   ./next-train.sh PAD RDG
#   ./next-train.sh "London Paddington" "Cam & Dursley"
#
# Needs curl and jq.
set -euo pipefail

from=${1:?usage: next-train.sh FROM TO}
to=${2:?usage: next-train.sh FROM TO}

enc() { jq -rn --arg s "$1" '$s | @uri'; }

json=$(curl -s "https://api.traini.ac/v1/journey/$(enc "$from")/$(enc "$to")?limit=1")

# Every answer says what it is: {"type": "ok", ...} or {"type": "error", ...}.
if [ "$(jq -r '.type' <<<"$json")" = error ]; then
  jq -r '"\(.error.type): \(.error.message)"' <<<"$json" >&2
  exit 1
fi

jq -r '
  def clock: .[11:16];
  def when: .scheduled | clock;
  def expected:
    if .estimate.type == "forecast" and (.delay_minutes // 0) > 0 then " (expected \(.estimate.at | clock))"
    elif .estimate.type == "cancelled" then " (cancelled)"
    elif .estimate.type == "delayed_no_estimate" then " (delayed)"
    else "" end;
  def platform:
    if .type == "known" then .number else "?" end;
  (.request.from.resolution.name) as $from
  | (.request.to.resolution.name) as $to
  | if (.data | length) == 0 then
      "No trains from \($from) to \($to) today."
    else
      .data[0]
      | "\($from) → \($to)",
        "  departs \(.departs | when)\(.departs | expected), arrives \(.arrives | when) — \(.duration_minutes) min",
        (if .type == "direct" then
           "  \(.leg.train.headcode) \(.leg.train.operator.name // ""), platform \(.leg.departure_platform | platform)"
         else
           (.connections[] | "  change at \(.at.name) (\(.minutes) min, \(.outlook))")
         end)
    end
' <<<"$json"

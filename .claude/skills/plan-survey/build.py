"""Assemble the plan-survey page from the four agents' JSON.

    python3 -I build.py <survey-dir> <out.html> [--previous <data.json | page.html>]
    python3 -I build.py --extract <page.html> <previous-deferred.json>

--extract pulls the deferred list out of a published page (as the Artifact
tool's read saved it), for the deferred agent's stable-id step.

<survey-dir> holds initial-plan.json, deferred.json, design.json,
journey.json and narrative.json (shapes in agents.md and SKILL.md).
Writes <out.html> and, beside it, <out>.data.json: the exact data the page
embeds, which the next run passes back as --previous.
"""

import json
import pathlib
import sys
from datetime import date


def read_previous(path):
    text = pathlib.Path(path).read_text()
    if text.lstrip().startswith("{"):
        return json.loads(text)
    # The published page itself: the data is the literal after `const D = `.
    start = text.index("const D = ") + len("const D = ")
    data, _ = json.JSONDecoder().raw_decode(text[start:].replace("<\\/", "</"))
    return data


args = sys.argv[1:]
if args[0] == "--extract":
    prev = read_previous(args[1])
    pathlib.Path(args[2]).write_text(json.dumps(prev["deferred"], ensure_ascii=False))
    print(f"extracted {len(prev['deferred'])} items from the {prev.get('as_of', 'earlier')} survey")
    sys.exit(0)
previous = None
if "--previous" in args:
    i = args.index("--previous")
    previous = read_previous(args[i + 1])
    del args[i : i + 2]
survey, out = pathlib.Path(args[0]), pathlib.Path(args[1])


def load(name):
    return json.loads((survey / name).read_text())


plan = load("initial-plan.json")
design = load("design.json")
journey = load("journey.json")
narrative = load("narrative.json")

deferred = load("deferred.json")["items"] + narrative.get("extra_deferred", [])
verified = set(narrative.get("verified", []))
for d in deferred:
    d["verified"] = d["id"] in verified

seen = {}
for d in deferred:
    seen[d["id"]] = seen.get(d["id"], 0) + 1
dupes = [k for k, n in seen.items() if n > 1]
if dupes:
    sys.exit(f"duplicate deferred ids (the delta matches on id): {dupes}")

as_of = narrative["as_of"]
narrative["days"] = str((date.fromisoformat(as_of) - date(2026, 8, 30)).days)

data = {
    "as_of": as_of,
    "narrative": narrative,
    "lanes": plan["lanes"],
    "techPivots": plan["tech_plan_pivots"],
    "deferred": deferred,
    "screens": design["screens"],
    "deltaThemes": design["delta_themes"],
    "deltaFollowups": design["delta_followups_open"],
    "phases": journey["phases"],
    "pivots": journey["pivots"],
    "launch": journey["launch_items"],
    "epics": journey["post_mvp_epics"],
    "stats": journey["stats"],
}
# Only what the delta needs, so the page does not grow with every run.
if previous:
    data["previous"] = {"as_of": previous.get("as_of", "an earlier date"), "deferred": previous["deferred"]}

blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
template = (pathlib.Path(__file__).parent / "template.html").read_text()
out.write_text(template.replace("__DATA__", blob))
saved = {k: v for k, v in data.items() if k != "previous"}
out.with_suffix(".data.json").write_text(json.dumps(saved, ensure_ascii=False))

classes = {}
for d in deferred:
    classes[d["class"]] = classes.get(d["class"], 0) + 1
print(f"wrote {out} ({len(deferred)} deferred items: {classes})")

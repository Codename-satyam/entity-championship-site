from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
required = [
    "index.html", "vercel.json", "pages/index.html", "pages/live.html",
    "pages/toss.html", "pages/bracket.html", "shared/shared.css",
    "shared/shared.js", "shared/live-page.js", "shared/toss-page.js",
    "shared/bracket-page.js", "shared/scoring-engine.js", "data/teams.json", "data/matches.json", "data/maps.json", "data/killers.json",
]
missing = [name for name in required if not (ROOT / name).is_file()]
if missing:
    raise SystemExit("Missing required files: " + ", ".join(missing))
for name in ["vercel.json", "data/teams.json", "data/matches.json", "data/maps.json", "data/killers.json"]:
    with (ROOT / name).open(encoding="utf-8") as file:
        payload = json.load(file)
    if name in {"data/maps.json", "data/killers.json"}:
        if not isinstance(payload, list) or len({str(item).strip() for item in payload if isinstance(item, str) and item.strip()}) < 5:
            raise SystemExit(f"{name} must contain at least five unique non-empty names.")
print("Project structure, JSON files, and configurable pools look valid.")

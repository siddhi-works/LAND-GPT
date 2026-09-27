from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
parcels = json.loads((ROOT / "seed" / "parcels.json").read_text(encoding="utf-8"))

for p in parcels:
    ring = p["geometry"]["coordinates"][0]
    assert p["geometry"]["type"] == "Polygon"
    assert ring[0] == ring[-1]
    assert len(ring) - 1 >= 7
    assert len(p["ulpin"]) == 14 and p["ulpin"].isdigit()

print(f"SPATIAL VALIDATION PASS: {len(parcels)} polygons")

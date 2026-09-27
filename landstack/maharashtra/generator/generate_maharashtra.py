"""
Generate and validate the Maharashtra Land Stack synthetic DB seed.

Usage:
    python generator/generate_maharashtra.py
"""
from pathlib import Path
import json, sys

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "seed"

def load(name):
    with open(SEED / name, encoding="utf-8") as f:
        return json.load(f)

def validate():
    parcels = load("parcels.json")
    land = load("land_records.json")
    muts = load("mutations.json")
    regs = load("registrations.json")
    cards = load("property_cards.json")
    planning = load("planning.json")
    building = load("building_permissions.json")
    enc = load("encumbrances.json")
    tax = load("property_tax.json")
    util = load("utilities.json")
    env = load("environment.json")

    errors = []
    ulpins = [p["ulpin"] for p in parcels]
    known = set(ulpins)

    if len(parcels) != 15: errors.append("Expected 15 parcels")
    if len(set(ulpins)) != 15: errors.append("ULPINs are not unique")
    if sum(p["quality_class"]=="clean" for p in parcels) != 10: errors.append("Expected 10 clean")
    if sum(p["quality_class"]=="messy" for p in parcels) != 5: errors.append("Expected 5 messy")

    for p in parcels:
        if len(p["ulpin"]) != 14 or not p["ulpin"].isdigit():
            errors.append(f"{p['prototype_ref']}: invalid synthetic 14-digit ULPIN")

    def check_refs(rows, label):
        for r in rows:
            if r["ulpin"] not in known:
                errors.append(f"{label}: unknown ULPIN {r['ulpin']}")

    for rows,label in [
        (land["record_712"],"7/12"),(land["record_8a"],"8A"),(muts,"Ferfar"),
        (regs,"Registration"),(cards,"Property Card"),(planning,"Planning"),
        (building,"Building"),(enc,"Encumbrance"),(tax,"Tax"),(util,"Utilities"),(env,"Environment")
    ]: check_refs(rows,label)

    # Clean consistency checks.
    t712 = {r["ulpin"]: r for r in land["record_712"]}
    t8a = {r["ulpin"]: r for r in land["record_8a"]}
    treg = {r["ulpin"]: r for r in regs}
    tmut = {}
    for r in muts:
        tmut.setdefault(r["ulpin"], []).append(r)

    for p in parcels:
        if p["quality_class"] != "clean":
            continue
        u = p["ulpin"]
        if u in t712 and u in t8a:
            if t712[u]["khatedar_name_en"] != t8a[u]["khatedar_name_en"]:
                errors.append(f"{p['prototype_ref']}: clean 7/12↔8A owner mismatch")
            if abs(float(t712[u]["total_area"]) - float(t8a[u]["total_area"])) > 1e-9:
                errors.append(f"{p['prototype_ref']}: clean 7/12↔8A area mismatch")
        if u in t712 and u in treg:
            if treg[u]["buyer_name_en"] != t712[u]["khatedar_name_en"]:
                errors.append(f"{p['prototype_ref']}: clean registration↔owner mismatch")
        if u in tmut and any(m["status_en"].lower() != "disposed" for m in tmut[u]):
            errors.append(f"{p['prototype_ref']}: clean parcel has non-disposed Ferfar")

    # Intentional cases.
    p11 = next(p for p in parcels if p["prototype_ref"]=="P011")
    if treg[p11["ulpin"]]["buyer_name_en"] == t712[p11["ulpin"]]["khatedar_name_en"]:
        errors.append("P011 owner mismatch not present")

    p12 = next(p for p in parcels if p["prototype_ref"]=="P012")
    if abs(float(t712[p12["ulpin"]]["total_area"]) - float(t8a[p12["ulpin"]]["total_area"])) < 1e-9:
        errors.append("P012 area mismatch not present")

    p13 = next(p for p in parcels if p["prototype_ref"]=="P013")
    if not any(m["ulpin"]==p13["ulpin"] and m["status_en"].lower()=="pending" for m in muts):
        errors.append("P013 pending mutation not present")

    p14 = next(p for p in parcels if p["prototype_ref"]=="P014")
    if not any(e["ulpin"]==p14["ulpin"] and e["status"]=="active" and e["litigation_flag"] for e in enc):
        errors.append("P014 encumbrance/litigation not present")

    p15 = next(p for p in parcels if p["prototype_ref"]=="P015")
    if abs(float(p15["geometry_area_hectare"]) - float(p15["land_record_area_hectare"])) < 0.01:
        errors.append("P015 GIS area mismatch not present")

    if errors:
        print("VALIDATION FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    print("VALIDATION PASS")
    print("15 parcels | 10 clean | 5 messy")
    print("P011 owner mismatch")
    print("P012 area mismatch")
    print("P013 pending mutation")
    print("P014 active encumbrance + litigation")
    print("P015 GIS area mismatch")

if __name__ == "__main__":
    validate()

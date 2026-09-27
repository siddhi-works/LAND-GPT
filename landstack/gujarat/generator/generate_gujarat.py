from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
SEED=ROOT/"seed"

def load(name):
    return json.loads((SEED/name).read_text(encoding="utf-8"))

def validate():
    parcels=load("parcels.json")
    land=load("land_records.json")
    mutations=load("mutations.json")
    registrations=load("registrations.json")
    cards=load("property_cards.json")
    plans=load("planning.json")
    building=load("building_permissions.json")
    enc=load("encumbrances.json")

    assert len(parcels)==15
    assert len({x["ulpin"] for x in parcels})==15
    assert all(len(x["ulpin"])==14 and x["ulpin"].isdigit() for x in parcels)
    assert sum(x["quality_class"]=="clean" for x in parcels)==10
    assert sum(x["quality_class"]=="messy" for x in parcels)==5

    known={x["ulpin"] for x in parcels}
    for rows,label in [
        (land["vf7_12"],"VF7/12"),(land["vf8a"],"VF8A"),
        (mutations,"VF6"),(registrations,"Registration"),
        (cards,"Property Card"),(plans,"Planning"),
        (building,"Building"),(enc,"Encumbrance")
    ]:
        for row in rows:
            assert row["ulpin"] in known, f"{label}: unknown ULPIN"

    vf7={x["ulpin"]:x for x in land["vf7_12"]}
    vf8={x["ulpin"]:x for x in land["vf8a"]}
    reg={x["ulpin"]:x for x in registrations}
    muts={}
    for x in mutations: muts.setdefault(x["ulpin"],[]).append(x)

    # Clean records are internally consistent.
    for p in parcels:
        if p["quality_class"]!="clean": continue
        u=p["ulpin"]
        if u in vf7 and u in vf8:
            assert vf7[u]["khatedar_name_en"]==vf8[u]["holder_name_en"]
            assert abs(float(vf7[u]["area_value"])-float(vf8[u]["total_holding_area"])) < 1e-9
        if u in vf7:
            assert reg[u]["buyer_name_en"]==vf7[u]["khatedar_name_en"]
        assert all(m["status_en"]=="Certified" for m in muts[u])

    # Intentional messy cases.
    assert reg["86423051794816"]["buyer_name_en"] != vf7["86423051794816"]["khatedar_name_en"]
    assert vf7["27351480692137"]["area_value"] != vf8["27351480692137"]["total_holding_area"]
    assert any(m["ulpin"]=="71860543912796" and m["status_en"]=="Pending" for m in mutations)
    assert any(e["ulpin"]=="45293178064528" and e["status"]=="active" and e["litigation_flag"] for e in enc)
    p15=next(p for p in parcels if p["prototype_ref"]=="P015")
    assert abs(float(p15["geometry_area_hectare"])-float(p15["land_record_area_hectare"]))>=0.20

    # Language sanity.
    assert all(x["khatedar_name_gu"] and x["khatedar_name_en"] for x in land["vf7_12"])
    assert all(x["buyer_name_gu"] and x["buyer_name_en"] for x in registrations)

    print("VALIDATION PASS")
    print("15 parcels | 10 clean | 5 messy")
    print("P011 owner mismatch")
    print("P012 7/12 ↔ 8A area mismatch")
    print("P013 pending VF-6")
    print("P014 active encumbrance + litigation")
    print("P015 GIS/land-record area mismatch")

if __name__=="__main__":
    validate()

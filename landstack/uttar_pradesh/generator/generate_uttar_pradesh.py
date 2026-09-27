from pathlib import Path
import json, sys

ROOT=Path(__file__).resolve().parents[1]
SEED=ROOT/"seed"

def load(n):
    with open(SEED/n,encoding="utf-8") as f: return json.load(f)

def validate():
    p=load("parcels.json")
    l=load("land_records.json")
    m=load("mutations.json")
    r=load("registrations.json")
    b=load("bhu_naksha.json")
    pc=load("property_cards.json") if (SEED/"property_cards.json").exists() else {"records":[]}

    assert len(p)==15 and len({x["ulpin"] for x in p})==15
    assert sum(x["quality_class"]=="clean" for x in p)==10
    assert sum(x["quality_class"]=="messy" for x in p)==5
    assert not (SEED/"property_cards.json").exists(), "UP must not have a fabricated Property Card dataset"

    known={x["ulpin"] for x in p}
    for rows,label in [
        (l["khatauni"],"Khatauni"),(l["khasra"],"Khasra"),(m,"Mutation"),
        (r,"IGRSUP"),(b,"BhuNaksha")
    ]:
        for row in rows:
            assert row["ulpin"] in known, f"{label}: unknown ULPIN"

    kt={x["ulpin"]:x for x in l["khatauni"]}
    rg={x["ulpin"]:x for x in r}
    bn={x["ulpin"]:x for x in b}
    mm={}
    for x in m: mm.setdefault(x["ulpin"],[]).append(x)

    for x in p:
        if x["quality_class"]!="clean": continue
        u=x["ulpin"]
        assert kt[u]["khatedar_name_en"]==rg[u]["buyer_name_en"], x["prototype_ref"]
        assert abs(float(kt[u]["area_value"])-float(bn[u]["map_area"]))<1e-9, x["prototype_ref"]
        assert all(y["status_en"]=="Disposed" for y in mm[u]), x["prototype_ref"]

    assert kt["84650723190428"]["khatedar_name_en"] != rg["84650723190428"]["buyer_name_en"]
    assert kt["27541896372051"]["area_value"] != bn["27541896372051"]["map_area"]
    assert any(x["ulpin"]=="71960432851792" and x["status_en"]=="Pending" for x in m)

    enc_path=SEED/"encumbrances.json"
    enc=load("encumbrances.json")
    assert any(x["ulpin"]=="45039182764025" and x["status"]=="active" and x["litigation_flag"] for x in enc)

    p15=next(x for x in p if x["prototype_ref"]=="P015")
    assert abs(float(p15["geometry_area_hectare"])-float(p15["land_record_area_hectare"]))>=0.20

    report={
      "status":"PASS","records":15,"clean":10,"messy":5,
      "messy_cases":[
        {"P011":"owner mismatch"},
        {"P012":"Khatauni vs BhuNaksha area mismatch"},
        {"P013":"registration completed; Namantaran pending"},
        {"P014":"active encumbrance + litigation"},
        {"P015":"GIS/geometry area differs from land record"}
      ]
    }
    (ROOT/"validation"/"validation_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print("VALIDATION PASS")
    print("15 parcels | 10 clean | 5 messy")

if __name__=="__main__":
    validate()

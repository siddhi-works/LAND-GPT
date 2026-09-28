"""Read models for the portal UI, derived entirely from the registry, canonical bundles and
validation reports. Nothing here stores data; every value is recomputed from the sources."""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from .canonical.model import ParcelBundle
from .normalize import norm_code, norm_term, normalize_ulpin
from .service import LandStackService
from .validation.model import SEVERITY_RANK

SCHEME_LABEL = {
    "GAT_NO": "Gat No.", "KHASRA_NO": "Khasra No.", "CTS_NO": "CTS No.", "GATA_KHASRA_NO": "Gata/Khasra No.",
    "SURVEY_NO": "Survey No.", "CITY_SURVEY_NO": "City Survey No.", "KHATA_NO": "Khata No.", "ROR_NO": "Record of Rights No.",
}


def native_label(b: ParcelBundle) -> str:
    i = b.identity.primary_identifier
    return f"{SCHEME_LABEL.get(i.scheme, i.scheme)} {i.value}" + (f"/{i.part}" if i.part else "")


def _bbox(coords: list) -> list[float]:
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return [min(xs), min(ys), max(xs), max(ys)]


def _merge(a: list[float] | None, b: list[float]) -> list[float]:
    if a is None:
        return list(b)
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def _primary_ror(b: ParcelBundle):
    for cls in ("record_of_rights", "urban_property_record", "holding_account"):
        for lr in b.land_records:
            if lr.record_class == cls:
                return lr
    return None


def parcel_summary(svc: LandStackService, b: ParcelBundle) -> dict[str, Any]:
    rep = svc.verification(b.identity.ulpin)
    i = b.identity
    ror = _primary_ror(b)
    g = b.geometry[0] if b.geometry else None
    return {
        "ulpin": i.ulpin,
        "state_code": i.state_code,
        "state_name": i.state_name,
        "district": i.jurisdiction.district,
        "sub_district": i.jurisdiction.sub_district,
        "sub_district_type": i.jurisdiction.sub_district_type,
        "village": i.jurisdiction.village,
        "context": i.context,
        "native_id": i.primary_identifier.model_dump(),
        "native_label": native_label(b),
        "record_area_ha": ror.area.value_ha if ror and ror.area else (i.land_record_area.value_ha if i.land_record_area else None),
        "record_area_source": ror.native_record_type if ror else "Parcel registry",
        "gis_area_ha": g.computed_area.value_ha if g and g.computed_area else None,
        "land_use": ror.land_use if ror else None,
        "land_use_label": ror.land_use_label.model_dump() if ror and ror.land_use_label else None,
        "holders": [h.model_dump() for h in (ror.holders if ror else [])],
        "risk_level": rep.risk_level,
        "findings": len(rep.findings),
        "open_findings": rep.summary["open"],
        "pending_mutations": sum(1 for m in b.mutations if m.status == "pending"),
        "active_encumbrance": any(e.status == "active" for e in b.encumbrances),
        "litigation": bool(b.litigation),
        "environmental_restriction": any(e.is_restrictive for e in b.environmental_restrictions),
        "records": sum(s.record_count for s in b.sources if s.source_table not in ("core.parcel_registry",)),
    }


# -- GIS -------------------------------------------------------------------------------------
def feature_collection(svc: LandStackService, state: str | None = None) -> dict[str, Any]:
    features = []
    for b in svc.bundles(state):
        if not b.geometry:
            continue
        g = b.geometry[0]
        features.append({
            "type": "Feature",
            "id": b.identity.ulpin,
            "geometry": g.geometry,
            "properties": {**parcel_summary(svc, b), "source_locator": g.provenance.locator},
        })
    return {"type": "FeatureCollection", "features": features}


def hierarchy(svc: LandStackService) -> dict[str, Any]:
    tree: dict[str, Any] = {}
    for b in svc.bundles():
        i, j = b.identity, b.identity.jurisdiction
        if not b.geometry:
            continue
        box = _bbox(b.geometry[0].geometry["coordinates"][0])
        st = tree.setdefault(i.state_code, {"code": i.state_code, "name": i.state_name, "bbox": None,
                                            "sub_district_type": j.sub_district_type, "districts": {}})
        st["bbox"] = _merge(st["bbox"], box)
        d = st["districts"].setdefault(j.district, {"name": j.district, "bbox": None, "sub_districts": {}})
        d["bbox"] = _merge(d["bbox"], box)
        t = d["sub_districts"].setdefault(j.sub_district, {"name": j.sub_district, "bbox": None, "villages": {}})
        t["bbox"] = _merge(t["bbox"], box)
        v = t["villages"].setdefault(j.village, {"name": j.village, "bbox": None, "ulpins": []})
        v["bbox"] = _merge(v["bbox"], box)
        v["ulpins"].append(i.ulpin)

    def listify(node: dict, key: str, child: str | None):
        items = sorted(node[key].values(), key=lambda x: x["name"])
        if child:
            for it in items:
                listify(it, child, {"districts": "sub_districts", "sub_districts": "villages"}.get(child))
        node[key] = items

    states = []
    for code in sorted(tree):
        st = tree[code]
        listify(st, "districts", "sub_districts")
        states.append(st)
    return {"states": states}


def search(svc: LandStackService, q: str, state: str | None = None, limit: int = 12) -> list[dict[str, Any]]:
    raw = (q or "").strip()
    if not raw:
        return []
    digits = normalize_ulpin(raw)
    code = norm_code(raw.replace(" ", ""))
    text = norm_term(raw)
    hits: list[tuple[int, str, ParcelBundle]] = []
    for b in svc.bundles(state):
        i = b.identity
        pid = i.primary_identifier
        full = norm_code(f"{pid.value}/{pid.part}" if pid.part else pid.value)
        ids = {full, norm_code(pid.value)} | {norm_code(a.value) for a in i.account_identifiers}
        # identifiers stated by the linked source records (e.g. CTS no. on a Property Card)
        for lr in b.land_records:
            for x in lr.parcel_identifiers:
                ids.add(norm_code(f"{x.value}/{x.part}" if x.part else x.value))
        if digits.isdigit() and len(digits) >= 4 and i.ulpin.startswith(digits):
            hits.append((0, "ULPIN", b))
        elif code in ids:
            hits.append((1, "Native identifier", b))
        elif text and any(text in (norm_term(v) or "") for v in (i.jurisdiction.village, i.jurisdiction.sub_district, i.jurisdiction.district)):
            hits.append((2, "Location", b))
    hits.sort(key=lambda h: (h[0], h[2].identity.state_code, h[2].identity.ulpin))
    return [{"match": m, **parcel_summary(svc, b)} for _, m, b in hits[:limit]]


# -- validation read models ---------------------------------------------------------------------
def findings(svc: LandStackService, state: str | None = None, district: str | None = None) -> list[dict[str, Any]]:
    out = []
    for b in svc.bundles(state):
        if district and b.identity.jurisdiction.district != district:
            continue
        rep = svc.verification(b.identity.ulpin)
        for f in rep.findings:
            out.append({**f.model_dump(mode="json"), "district": b.identity.jurisdiction.district,
                        "sub_district": b.identity.jurisdiction.sub_district, "village": b.identity.jurisdiction.village,
                        "native_label": native_label(b)})
    out.sort(key=lambda f: (-SEVERITY_RANK[f["severity"]], f["rule_id"], f["ulpin"]))
    return out


_DISCREPANCY_GROUPS = {
    "ownership": {"OWN-001", "OWN-002"},
    "registration_mutation_lag": {"MUT-001", "MUT-002", "LNK-002"},
    "area_gis": {"AREA-001", "AREA-002", "GIS-001", "GIS-002"},
    "spatial": {"GIS-003", "GIS-004", "GIS-005", "GIS-006"},
    "missing_links": {"LNK-001", "LNK-002", "COV-002", "ENC-004"},
    "encumbrance_litigation": {"ENC-001", "ENC-002", "ENC-003", "LIT-001"},
    "planning_environment": {"PLN-001", "PLN-002", "PLN-003", "PLN-004", "ENV-001", "ENV-002"},
    "identity": {"ID-001", "ID-002", "ID-003"},
    "data_quality": {"COV-001", "DQ-001", "DQ-002", "TAX-002", "GIS-002"},
}


def reports(svc: LandStackService, state: str | None = None, district: str | None = None) -> dict[str, Any]:
    bundles = [b for b in svc.bundles(state) if not district or b.identity.jurisdiction.district == district]
    reps = [svc.verification(b.identity.ulpin) for b in bundles]

    mut_by_status: Counter = Counter()
    mut_by_unit: dict[tuple, Counter] = defaultdict(Counter)
    for b in bundles:
        for m in b.mutations:
            mut_by_status[m.status or "unmapped"] += 1
            mut_by_unit[(b.identity.state_code, b.identity.jurisdiction.district, b.identity.jurisdiction.sub_district)][m.status or "unmapped"] += 1

    fs = [f for r in reps for f in r.findings]
    groups = {g: sum(1 for f in fs if f.rule_id in rules) for g, rules in _DISCREPANCY_GROUPS.items()}
    parcels_by_group = {g: len({f.ulpin for f in fs if f.rule_id in rules}) for g, rules in _DISCREPANCY_GROUPS.items()}

    units = []
    by_unit: dict[tuple, list] = defaultdict(list)
    for b, r in zip(bundles, reps):
        by_unit[(b.identity.state_code, b.identity.jurisdiction.district, b.identity.jurisdiction.sub_district)].append((b, r))
    for key in sorted(by_unit):
        rows = by_unit[key]
        units.append({
            "state_code": key[0], "district": key[1], "sub_district": key[2],
            "sub_district_type": rows[0][0].identity.jurisdiction.sub_district_type,
            "parcels": len(rows),
            "parcels_with_findings": sum(1 for _, r in rows if r.findings),
            "high": sum(1 for _, r in rows for f in r.findings if f.severity in ("high", "critical")),
            "mutations_pending": mut_by_unit[key]["pending"],
            "mutations_finalized": mut_by_unit[key]["finalized"],
        })

    # record-linkage coverage: share of ULPINs with >=1 record in each source table
    coverage = []
    if bundles:
        tables: dict[str, dict] = {}
        for b in bundles:
            for s in b.sources:
                t = tables.setdefault(f"{b.identity.state_code}:{s.source_table}", {
                    "state_code": b.identity.state_code, "source_table": s.source_table,
                    "native_record_type": s.native_record_type, "concepts": s.concepts, "linked": 0, "parcels": 0})
                t["parcels"] += 1
                t["linked"] += 1 if s.record_count else 0
        coverage = sorted(tables.values(), key=lambda t: (t["state_code"], t["source_table"]))

    checks = Counter()
    for r in reps:
        for c in r.checks:
            checks[c.outcome] += 1

    return {
        "scope": {"state": state, "district": district},
        "as_of": str(svc.settings.as_of),
        "parcels": len(bundles),
        "parcels_with_findings": sum(1 for r in reps if r.findings),
        "risk_levels": dict(Counter(r.risk_level for r in reps)),
        "findings_by_severity": {s: sum(1 for f in fs if f.severity == s) for s in SEVERITY_RANK},
        "findings_by_rule": dict(Counter(f.rule_id for f in fs).most_common()),
        "discrepancies": groups,
        "parcels_by_discrepancy": parcels_by_group,
        "discrepancy_rules": {g: sorted(rules) for g, rules in _DISCREPANCY_GROUPS.items()},
        "mutations": dict(mut_by_status),
        "checks": dict(checks),
        "units": units,
        "coverage": coverage,
    }

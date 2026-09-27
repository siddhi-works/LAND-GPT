"""Cross-state data-quality analytics derived from verification reports and source coverage."""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from .adapters.base import REGISTRY_TABLE
from .config import API_VERSION, ENGINE_VERSION
from .service import LandStackService
from .validation import rule_specs
from .validation.model import SEVERITY_RANK

# Evaluation metadata: which rules are expected to detect each synthetic-dataset issue label.
# Labels are test fixtures shipped with the dataset, not state information.
LABEL_EXPECTATIONS: dict[str, list[str]] = {
    "OWNER_MISMATCH": ["OWN-002"],
    "AREA_MISMATCH": ["AREA-001", "AREA-002"],
    "PENDING_MUTATION": ["MUT-001"],
    "PENDING_NAMANTARAN": ["MUT-001"],
    "PENDING_VF6": ["MUT-001"],
    "ENCUMBRANCE_LITIGATION": ["ENC-001", "LIT-001"],
    "GIS_AREA_MISMATCH": ["GIS-001"],
}
_ALL_REQUIRED = {"ENCUMBRANCE_LITIGATION"}  # every listed rule must fire; otherwise any one suffices


def data_quality(svc: LandStackService) -> dict[str, Any]:
    reports = svc.verifications()
    findings = [f for r in reports for f in r.findings]
    specs = {s.rule_id: s for s in rule_specs()}

    by_state: dict[str, dict[str, Any]] = {}
    for code in sorted(svc.adapters):
        rs = [r for r in reports if r.state_code == code]
        fs = [f for r in rs for f in r.findings]
        by_state[code] = {
            "state_name": svc.adapters[code].state_name,
            "parcels": len(rs),
            "parcels_with_findings": sum(1 for r in rs if r.findings),
            "findings": len(fs),
            "by_severity": {s: sum(1 for f in fs if f.severity == s) for s in SEVERITY_RANK},
            "risk_levels": dict(Counter(r.risk_level for r in rs)),
        }

    rule_rows = []
    per_rule_state: dict[str, Counter] = defaultdict(Counter)
    for f in findings:
        per_rule_state[f.rule_id][f.state_code] += 1
    checks_by_rule: dict[str, Counter] = defaultdict(Counter)
    for r in reports:
        for c in r.checks:
            checks_by_rule[c.rule_id][c.outcome] += 1
    for rid, spec in specs.items():
        rule_rows.append({
            "rule_id": rid, "name": spec.name, "category": spec.category, "kind": spec.kind,
            "findings": sum(per_rule_state[rid].values()), "by_state": dict(sorted(per_rule_state[rid].items())),
            "check_outcomes": dict(checks_by_rule[rid]),
        })

    # source coverage and orphan rows (native rows whose ULPIN is not in the state registry)
    coverage: dict[str, list[dict]] = {}
    orphans: list[dict] = []
    for code, adapter in sorted(svc.adapters.items()):
        known = {i.ulpin for i in svc.registry.identities(code)}
        rows_out = []
        for spec in adapter.specs:
            if spec.table not in svc.store.tables(code):
                continue
            rows = adapter.rows(spec.table)
            linked = {str(r.data.get("ulpin")) for r in rows if r.data.get("ulpin") is not None}
            for r in rows:
                if spec.table != REGISTRY_TABLE and str(r.data.get("ulpin")) not in known:
                    orphans.append({"state_code": code, "source_table": spec.table, "locator": r.locator,
                                    "ulpin": r.data.get("ulpin")})
            rows_out.append({"source_table": spec.table, "native_record_type": spec.native_record_type,
                             "concepts": list(spec.concepts), "rows": len(rows),
                             "parcels_linked": len(linked & known)})
        coverage[code] = rows_out

    # glossary resolution across every canonical record
    term_stats: Counter = Counter()
    for b in svc.bundles():
        for m in b.identity.term_mappings:
            term_stats[m.matched_on] += 1
        for rec in b.all_records():
            if "#" in rec.record_id and rec.concept in ("ownership", "land_use", "litigation"):
                continue  # derived views re-use their basis record's mappings
            for m in rec.term_mappings:
                term_stats[m.matched_on] += 1

    # labelled-issue detection (synthetic dataset evaluation)
    detection = []
    for r in reports:
        label = svc.bundle(r.ulpin).identity.dataset_label
        if not label.issue:
            continue
        expected = LABEL_EXPECTATIONS.get(label.issue, [])
        fired = sorted({f.rule_id for f in r.findings} & set(expected))
        ok = set(fired) == set(expected) if label.issue in _ALL_REQUIRED else bool(fired)
        detection.append({"state_code": r.state_code, "ulpin": r.ulpin, "prototype_ref": label.prototype_ref,
                          "label": label.issue, "expected_rules": expected, "detected_by": fired, "detected": ok})
    clean_with_findings = [
        {"state_code": r.state_code, "ulpin": r.ulpin, "prototype_ref": svc.bundle(r.ulpin).identity.dataset_label.prototype_ref,
         "rules": sorted({f.rule_id for f in r.findings}), "risk_level": r.risk_level}
        for r in reports
        if svc.bundle(r.ulpin).identity.dataset_label.quality_class == "clean" and r.findings
    ]

    return {
        "api_version": API_VERSION,
        "engine_version": ENGINE_VERSION,
        "glossary_version": svc.glossary.version,
        "as_of": str(svc.settings.as_of),
        "totals": {
            "parcels": len(reports),
            "parcels_with_findings": sum(1 for r in reports if r.findings),
            "findings": len(findings),
            "open": sum(1 for f in findings if f.status == "open"),
            "explained": sum(1 for f in findings if f.status == "explained"),
            "by_severity": {s: sum(1 for f in findings if f.severity == s) for s in SEVERITY_RANK},
            "by_kind": dict(Counter(f.kind for f in findings)),
        },
        "by_state": by_state,
        "by_rule": sorted(rule_rows, key=lambda x: (-x["findings"], x["rule_id"])),
        "registry": {"ulpins": len(svc.registry), "issues": svc.registry.issues},
        "source_coverage": coverage,
        "orphan_rows": orphans,
        "glossary_resolution": dict(term_stats),
        "labelled_issue_detection": {
            "labelled_parcels": len(detection),
            "detected": sum(1 for d in detection if d["detected"]),
            "details": detection,
        },
        "findings_on_parcels_labelled_clean": clean_with_findings,
        "parcels": [
            {"ulpin": r.ulpin, "state_code": r.state_code, "risk_level": r.risk_level,
             "findings": len(r.findings), "rules": sorted({f.rule_id for f in r.findings})}
            for r in sorted(reports, key=lambda r: (r.state_code, r.ulpin))
        ],
    }

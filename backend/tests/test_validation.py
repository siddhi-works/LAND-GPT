"""Validation engine: runs after normalization; findings keep rule, sources, values, severity/status, provenance."""
import pytest

from interop.validation import rule_specs

from .conftest import P

STATES = ["MH", "UP", "GJ"]


def rules_of(service, key):
    return {f.rule_id for f in service.verification(P[key]).findings}


def finding(service, key, rule_id):
    fs = [f for f in service.verification(P[key]).findings if f.rule_id == rule_id]
    assert fs, f"{rule_id} expected for {key}"
    return fs[0]


# -- the dataset's intentionally inconsistent parcels ---------------------------------------
@pytest.mark.parametrize("state", STATES)
def test_owner_mismatch_p011(service, state):
    f = finding(service, (state, "P011"), "OWN-002")
    assert f.status == "open" and f.severity == "high"
    assert "already finalized" in f.message, "linked mutation finalized yet record not updated"
    tables = {o.source_table for o in f.observations}
    assert any("registration" in t or "deed" in t or "document" in t for t in tables)
    assert len(tables) >= 2


def test_area_mismatch_p012(service):
    mh = finding(service, ("MH", "P012"), "AREA-001")
    assert mh.metrics["values_ha"] == {"7/12": 0.62, "8A": 0.66, "Parcel registry": 0.62}
    gj = finding(service, ("GJ", "P012"), "AREA-001")
    assert gj.metrics["values_ha"]["VF 8A"] == 0.48 and gj.metrics["values_ha"]["VF 7/12"] == 0.41
    up = finding(service, ("UP", "P012"), "AREA-002")
    assert up.metrics["map_area_ha"] == 0.47


@pytest.mark.parametrize("state", STATES)
def test_registration_mutation_lag_p013_explains_owner_mismatch(service, state):
    lag = finding(service, (state, "P013"), "MUT-001")
    assert lag.severity == "high" and lag.metrics["days_since_registration"] > 90
    own = finding(service, (state, "P013"), "OWN-002")
    assert own.status == "explained" and own.explained_by == [lag.finding_id]
    assert "pending" in own.message


@pytest.mark.parametrize("state", STATES)
def test_encumbrance_and_litigation_p014(service, state):
    r = rules_of(service, (state, "P014"))
    assert {"ENC-001", "LIT-001"} <= r


def test_state_specific_encumbrance_contradictions(service):
    # MH: e-Ferfar says the charge was released, the encumbrance register says it is active.
    assert "ENC-002" in rules_of(service, ("MH", "P014"))
    # GJ: VF 7/12 other-rights note is empty although a mortgage is active.
    assert "ENC-003" in rules_of(service, ("GJ", "P014"))
    # UP Khatauni has no annotation field -> not applicable (nothing assumed).
    checks = {c.rule_id: c.outcome for c in service.verification(P[("UP", "P014")]).checks}
    assert checks["ENC-003"] == "not_applicable"


def test_additional_dataset_signals(service):
    # Ferfar applied for before its sale deed was registered.
    f = finding(service, ("MH", "P001"), "MUT-002")
    assert f.metrics["days_before_registration"] == 117
    # Gujarat urban consideration values ~400x the tax-assessed value.
    assert finding(service, ("GJ", "P009"), "VAL-001").metrics["ratio"] > 100
    # Residential building approved on agricultural zone / agricultural 7/12.
    assert {"PLN-001", "PLN-003"} <= rules_of(service, ("MH", "P013"))
    # Registry village name in Devanagari where the rest of UP is romanized.
    assert "DQ-001" in rules_of(service, ("UP", "P003"))


# -- clean parcels -------------------------------------------------------------------------
CORE_INCONSISTENCIES = {"OWN-001", "OWN-002", "MUT-001", "AREA-001", "AREA-002", "GIS-001", "GIS-003",
                        "GIS-005", "ID-001", "ID-002", "ID-003", "LNK-001", "ENC-001", "LIT-001"}


def test_clean_parcels_have_no_core_inconsistencies(service):
    for b in service.bundles():
        if b.identity.dataset_label.quality_class == "clean":
            hit = {f.rule_id for f in service.verification(b.identity.ulpin).findings}
            assert not (hit & CORE_INCONSISTENCIES), (b.identity.ulpin, hit)


@pytest.mark.parametrize("key", [("UP", "P001"), ("GJ", "P001")])
def test_fully_consistent_parcels(service, key):
    rep = service.verification(P[key])
    assert rep.findings == [] and rep.risk_level == "none"
    assert rep.summary["checks"]["fail"] == 0


# -- finding structure ----------------------------------------------------------------------
def test_findings_are_explainable_and_carry_provenance(service):
    for rep in service.verifications():
        for f in rep.findings:
            assert f.rule_id and f.rule_name and f.severity and f.status in ("open", "explained")
            assert f.message and f.expectation and f.observations
            for o in f.observations:
                assert o.source_table and o.locator and o.source_system and o.state_code == rep.state_code


def test_every_rule_reports_an_outcome_for_every_parcel(service):
    n = len(rule_specs())
    for rep in service.verifications():
        assert len(rep.checks) == n
        assert all(c.outcome in ("pass", "fail", "not_applicable") and c.detail for c in rep.checks)


def test_finding_ids_are_deterministic(service, store, settings):
    from interop.service import LandStackService
    other = LandStackService(store, settings=settings)
    for u in P.values():
        assert [f.finding_id for f in service.verification(u).findings] == \
               [f.finding_id for f in other.verification(u).findings]


# -- rules exercised through controlled in-memory variants -------------------------------------
def test_parcel_overlap_detected(memory_service_factory):
    moved = {}

    def mutate(t):
        a, b = t["spatial.cadastral_parcels"][0], t["spatial.cadastral_parcels"][1]
        b["geometry"] = a["geometry"]
        moved.update(a=a["ulpin"], b=b["ulpin"])
    svc = memory_service_factory("GJ", mutate)
    f = [f for f in svc.verification(moved["b"]).findings if f.rule_id == "GIS-005"]
    assert f and f[0].metrics["overlapping_ulpin"] == moved["a"] == P[("GJ", "P001")]


def test_identifier_and_link_breaks_detected(memory_service_factory):
    def mutate(t):
        t["e_dhara.vf8a"][0]["land_measurement_numbers"] = [{"survey_no": "999", "sub_division": "2"}]
        t["e_dhara.vf6_mutation"][0]["linked_document_no"] = "GUJ-REG-9999"
    svc = memory_service_factory("GJ", mutate)
    r = {f.rule_id for f in svc.verification(P[("GJ", "P001")]).findings}
    assert {"ID-001", "LNK-001"} <= r


def test_missing_geometry_and_missing_record_of_rights(memory_service_factory):
    u = P[("UP", "P001")]
    def mutate(t):
        t["spatial.cadastral_parcels"] = [r for r in t["spatial.cadastral_parcels"] if r["ulpin"] != u]
        t["revenue_land_records.khatauni"] = [r for r in t["revenue_land_records.khatauni"] if r["ulpin"] != u]
    svc = memory_service_factory("UP", mutate)
    r = {f.rule_id for f in svc.verification(u).findings}
    assert {"GIS-006", "COV-002"} <= r


def test_unmapped_native_term_is_reported_not_guessed(memory_service_factory):
    def mutate(t):
        t["e_dhara.vf6_mutation"][0]["status_en"] = "Stayed"
        t["e_dhara.vf6_mutation"][0]["status_gu"] = "સ્થગિત"
    svc = memory_service_factory("GJ", mutate)
    b = svc.bundle(P[("GJ", "P001")])
    assert b.mutations[0].status is None
    assert "DQ-002" in {f.rule_id for f in svc.verification(P[("GJ", "P001")]).findings}


def test_as_of_controls_lag_severity(store):
    from datetime import date

    from interop.config import Settings
    from interop.service import LandStackService
    svc = LandStackService(store, settings=Settings(as_of=date(2025, 10, 1)))
    f = [f for f in svc.verification(P[("GJ", "P013")]).findings if f.rule_id == "MUT-001"][0]
    assert f.severity == "medium" and f.metrics["days_since_registration"] == 54


def test_each_state_exposes_p001_to_p100(service):
    for code in ("MH", "UP", "GJ"):
        refs = sorted(i.dataset_label.prototype_ref for i in service.registry.identities(code))
        assert refs == [f"P{n:03d}" for n in range(1, 101)], code


def test_generated_parcels_consistent_or_detected(service):
    """P016–P100: parcels generated consistent carry no findings; every seeded issue is detected by the
    engine (labels are dataset fixtures; the engine never reads them)."""
    from interop.analytics import _label_detected

    for rep in service.verifications():
        label = service.bundle(rep.ulpin).identity.dataset_label
        if int(label.prototype_ref[1:]) <= 15:
            continue
        fired = {f.rule_id for f in rep.findings}
        if label.quality_class == "clean":
            assert not rep.findings, (label.prototype_ref, rep.state_code, sorted(fired))
        else:
            assert _label_detected(label.issue, fired)[2], (label.prototype_ref, label.issue, sorted(fired))

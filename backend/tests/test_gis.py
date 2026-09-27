"""GIS: ULPIN <-> geometry linkage, recorded-area vs GIS-area validation, geometry primitives."""
import pytest

from interop.geo import polygon_area_ha, ring_problems, rings_overlap

from .conftest import P


def test_every_ulpin_links_to_exactly_one_polygon(service):
    for b in service.bundles():
        assert len(b.geometry) == 1, b.identity.ulpin
        g = b.geometry[0]
        assert g.provenance.source_table == "spatial.cadastral_parcels"
        assert g.native["ulpin"] == b.identity.ulpin
        assert g.geometry == b.identity.registry_geometry


def test_computed_area_close_to_declared_area_for_all_parcels(service):
    for b in service.bundles():
        computed = b.geometry[0].computed_area.value_ha
        declared = b.identity.declared_gis_area.value_ha
        assert abs(computed - declared) / declared < 0.02, b.identity.ulpin


@pytest.mark.parametrize("state", ["MH", "UP", "GJ"])
def test_p015_gis_area_mismatch_detected(service, state):
    rep = service.verification(P[(state, "P015")])
    (f,) = [f for f in rep.findings if f.rule_id == "GIS-001"]
    assert f.metrics["record_area_ha"] == 2.2
    assert 2.47 < f.metrics["gis_area_ha"] < 2.50
    assert 0.12 < f.metrics["relative_difference"] < 0.14
    assert {o.source_table for o in f.observations} >= {"spatial.cadastral_parcels"}


def test_up_bhunaksha_map_area_vs_khatauni(service):
    rep = service.verification(P[("UP", "P012")])
    (f,) = [f for f in rep.findings if f.rule_id == "AREA-002"]
    assert f.metrics["map_area_ha"] == 0.47 and f.metrics["record_area_ha"] == 0.41
    assert "GIS-001" not in {x.rule_id for x in rep.findings}, "polygon agrees with Khatauni for UP P012"


def test_clean_parcels_pass_all_spatial_checks(service):
    for rep in service.verifications():
        for c in rep.checks:
            if c.rule_id in ("GIS-002", "GIS-003", "GIS-004", "GIS-005", "GIS-006"):
                assert c.outcome == "pass", (rep.ulpin, c)


def test_gis_endpoint_returns_feature_and_area_comparison(client):
    r = client.get(f"/v1/parcels/{P[('GJ', 'P015')]}/gis").json()
    assert r["feature"]["type"] == "Feature" and r["feature"]["geometry"]["type"] == "Polygon"
    ac = r["area_comparison"]
    assert ac["record_area_source"] == "VF 7/12" and ac["within_tolerance"] is False
    assert any(f["rule_id"] == "GIS-001" for f in r["related_findings"])
    ok = client.get(f"/v1/parcels/{P[('GJ', 'P001')]}/gis").json()["area_comparison"]
    assert ok["within_tolerance"] is True


# -- geometry primitives ------------------------------------------------------------------
SQ = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]


def test_shared_boundary_is_not_an_overlap():
    right = [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]
    assert rings_overlap(SQ, right) is False


def test_interior_overlap_and_containment_and_duplicates():
    shifted = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]
    inner = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]]
    assert rings_overlap(SQ, shifted) and rings_overlap(SQ, inner) and rings_overlap(SQ, list(SQ))


def test_ring_validity():
    assert ring_problems(SQ) == []
    bowtie = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]
    assert any("self-intersects" in p for p in ring_problems(bowtie))
    assert any("not closed" in p for p in ring_problems([[0, 0], [1, 0], [1, 1], [0, 1]]))


def test_area_of_a_known_polygon():
    # ~0.001 deg square at the equator ~ 111.3 m x 111.3 m ~ 1.24 ha
    ring = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]
    assert 1.23 < polygon_area_ha({"type": "Polygon", "coordinates": [ring]}) < 1.25

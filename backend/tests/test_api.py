"""Unified API: common contracts across states, provenance retained, nothing fabricated."""
import pytest

from .conftest import P

CONCEPT_PATHS = ["ownership", "registration", "mutation", "planning", "building", "encumbrance", "tax",
                 "utilities", "gis", "land-records"]
REPRESENTATIVE = [("MH", "P001"), ("MH", "P009"), ("UP", "P001"), ("UP", "P012"), ("GJ", "P009"), ("GJ", "P014")]


def test_api_index_lists_versioned_endpoints(client):
    r = client.get("/v1")
    assert r.status_code == 200
    eps = r.json()["endpoints"]
    assert "/v1/health" in eps and "/v1/parcels/{ulpin}/gis" in eps


def test_health(client):
    for path in ("/health", "/v1/health"):
        body = client.get(path).json()
        assert body["status"] == "ok" and body["api_version"] == "v1"
    body = client.get("/v1/health").json()
    assert body["store"]["read_only"] is True and body["registry"]["ulpins"] == 45
    assert set(body["states"]) == {"MH", "UP", "GJ"}
    assert "revenue_cadastral.bhu_naksha" in body["states"]["UP"]["native_tables"]


def test_registry_endpoints(client):
    assert client.get("/v1/registry").json()["count"] == 45
    assert client.get("/v1/registry?state=UP").json()["count"] == 15
    assert client.get("/v1/registry?state=XX").status_code == 422
    e = client.get(f"/v1/registry/ulpin/{P[('UP', 'P013')]}").json()
    assert e["state"] == {"code": "UP", "name": "Uttar Pradesh"}
    assert e["primary_identifier"]["scheme"] == "GATA_KHASRA_NO"
    assert e["source_reference"]["locator"].startswith("uttar_pradesh/seed/parcels.json#/")


@pytest.mark.parametrize("key", REPRESENTATIVE)
def test_every_concept_endpoint_shares_the_common_contract(client, key):
    u = P[key]
    for path in CONCEPT_PATHS:
        r = client.get(f"/v1/parcels/{u}/{path}")
        assert r.status_code == 200, (path, r.text)
        body = r.json()
        assert body["api_version"] == "v1" and body["ulpin"] == u and body["state"]["code"] == key[0]
        assert {"concept", "supported", "record_count", "sources", "related_findings"} <= set(body)
        for src in body["sources"]:
            assert src["source_table"] and src["native_record_type"]
    summary = client.get(f"/v1/parcels/{u}").json()
    assert summary["registry"]["ulpin"] == u and set(summary["links"]) >= {"verification", "gis"}
    profile = client.get(f"/v1/parcels/{u}/profile").json()
    assert profile["canonical"]["identity"]["ulpin"] == u
    assert profile["verification"]["ulpin"] == u


def test_records_keep_provenance_and_native(client):
    body = client.get(f"/v1/parcels/{P[('MH', 'P013')]}/mutation").json()
    (m,) = body["records"]
    assert m["provenance"]["source_table"] == "eferfar.ferfar"
    assert m["provenance"]["source_system"] == "e-Ferfar"
    assert m["native"]["status_mr"] == "प्रलंबित" and m["status"] == "pending"
    assert body["summary"] == {"register_names": ["Ferfar"], "pending": 1, "finalized": 0}
    assert any(f["rule_id"] == "MUT-001" for f in body["related_findings"])


@pytest.mark.parametrize("key,status", [
    (("MH", "P001"), "consistent"), (("UP", "P001"), "consistent"), (("GJ", "P009"), "consistent"),
    (("MH", "P011"), "mismatch"), (("UP", "P011"), "mismatch"), (("GJ", "P011"), "mismatch"),
    (("MH", "P013"), "mismatch_pending_mutation"), (("UP", "P013"), "mismatch_pending_mutation"),
    (("GJ", "P013"), "mismatch_pending_mutation"),
])
def test_ownership_status(client, key, status):
    s = client.get(f"/v1/parcels/{P[key]}/ownership").json()["summary"]
    assert s["status"] == status, s["basis"]


def test_same_concept_different_state_systems(client):
    """One contract, genuinely different sources behind it."""
    tables = {}
    for state in ("MH", "UP", "GJ"):
        body = client.get(f"/v1/parcels/{P[(state, 'P013')]}/mutation").json()
        tables[state] = {s["source_table"] for s in body["sources"]}
        assert body["records"][0]["status"] == "pending"
    assert tables == {"MH": {"eferfar.ferfar"}, "UP": {"revenue_mutation.namantaran"}, "GJ": {"e_dhara.vf6_mutation"}}


def test_nothing_fabricated_for_absent_data(client):
    body = client.get(f"/v1/parcels/{P[('UP', 'P001')]}/building").json()
    assert body["supported"] is True and body["record_count"] == 0 and body["records"] == []
    lr = client.get(f"/v1/parcels/{P[('UP', 'P001')]}/land-records").json()
    assert "city_survey.property_card" not in {s["source_table"] for s in lr["sources"]}
    tax = client.get(f"/v1/parcels/{P[('MH', 'P001')]}/tax").json()
    assert tax["records"] == [] and tax["summary"]["outstanding_inr"] is None


def test_encumbrance_endpoint(client):
    body = client.get(f"/v1/parcels/{P[('GJ', 'P014')]}/encumbrance").json()
    assert body["summary"] == {"active": 1, "released": 0, "litigation_flagged": 1}
    assert body["litigation"][0]["case_reference"] == "MOCK-RCCMS-GJ-014"


def test_verification_endpoint(client):
    body = client.get(f"/v1/parcels/{P[('MH', 'P014')]}/verification").json()
    assert body["risk_level"] == "high"
    rules = {f["rule_id"] for f in body["findings"]}
    assert {"ENC-001", "ENC-002", "LIT-001"} <= rules
    f = body["findings"][0]
    assert {"rule_id", "severity", "status", "observations", "expectation", "message"} <= set(f)


def test_errors(client):
    r = client.get("/v1/parcels/123/ownership")
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_ULPIN"
    r = client.get("/v1/parcels/99999999999999")
    assert r.status_code == 404 and r.json()["error"]["code"] == "ULPIN_NOT_FOUND"


def test_glossary_endpoints(client):
    idx = client.get("/v1/glossary").json()
    assert "mutation" in idx["concepts"] and idx["terms"] > 40
    m = client.get("/v1/glossary/mutation").json()
    names = {s: {t["term"] for t in ts} for s, ts in m["terms_by_state"].items()}
    assert {"Ferfar"} <= names["MH"] and {"Namantaran", "Varasat"} <= names["UP"] and {"VF 6"} <= names["GJ"]
    lr = client.get("/v1/glossary/land_record").json()
    assert {"7/12"} <= {t["term"] for t in lr["terms_by_state"]["MH"]}
    assert {"Khatauni"} <= {t["term"] for t in lr["terms_by_state"]["UP"]}
    assert {"VF 7/12"} <= {t["term"] for t in lr["terms_by_state"]["GJ"]}
    miss = client.get("/v1/glossary/ferfar")
    assert miss.status_code == 404 and "mutation" in miss.json()["error"]["message"]
    res = client.get("/v1/glossary/resolve", params={"term": "खतौनी"}).json()
    assert res["terms"][0]["id"] == "UP.term.khatauni"


def test_rules_and_analytics(client):
    rules = client.get("/v1/validation/rules").json()
    assert len({r["rule_id"] for r in rules}) == len(rules) >= 30
    dq = client.get("/v1/analytics/data-quality").json()
    assert dq["totals"]["parcels"] == 45
    det = dq["labelled_issue_detection"]
    assert det["labelled_parcels"] == 15 and det["detected"] == 15
    assert dq["orphan_rows"] == [] and dq["registry"]["issues"] == []
    assert set(dq["glossary_resolution"]) <= {"en", "native", "en+native", "absent"}
    assert set(dq["by_state"]) == {"MH", "UP", "GJ"}


def test_openapi_contract_is_generated(client):
    spec = client.get("/openapi.json").json()
    for path in ("/v1/health", "/v1/registry/ulpin/{ulpin}", "/v1/parcels/{ulpin}", "/v1/parcels/{ulpin}/profile",
                 "/v1/parcels/{ulpin}/ownership", "/v1/parcels/{ulpin}/registration", "/v1/parcels/{ulpin}/mutation",
                 "/v1/parcels/{ulpin}/planning", "/v1/parcels/{ulpin}/building", "/v1/parcels/{ulpin}/encumbrance",
                 "/v1/parcels/{ulpin}/tax", "/v1/parcels/{ulpin}/utilities", "/v1/parcels/{ulpin}/gis",
                 "/v1/parcels/{ulpin}/verification", "/v1/glossary/{concept}", "/v1/analytics/data-quality"):
        assert path in spec["paths"], path

"""Portal read models, officer workflow (RBAC + jurisdiction) and assistant grounding."""
import pytest

from .conftest import P

PW = "LandStack@2026"


def login(client, username):
    r = client.post("/v1/officer/login", json={"username": username, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["officer"]


def test_gis_layer_has_every_ulpin_polygon(client):
    fc = client.get("/v1/gis/parcels").json()
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) == 45
    f = next(x for x in fc["features"] if x["id"] == P[("MH", "P015")])
    assert f["geometry"]["type"] == "Polygon"
    assert f["properties"]["native_label"] == "Khasra No. 118/1"
    assert f["properties"]["record_area_ha"] == 2.2 and 2.47 < f["properties"]["gis_area_ha"] < 2.5
    assert len(client.get("/v1/gis/parcels?state=GJ").json()["features"]) == 15


def test_admin_hierarchy(client):
    h = client.get("/v1/admin/hierarchy").json()
    states = {s["code"]: s for s in h["states"]}
    assert set(states) == {"MH", "UP", "GJ"} and states["UP"]["sub_district_type"] == "tehsil"
    saharanpur = next(d for d in states["UP"]["districts"] if d["name"] == "Saharanpur")
    behat = saharanpur["sub_districts"][0]
    assert behat["name"] == "Behat" and behat["villages"][0]["ulpins"] == [P[("UP", "P013")]]
    assert len(states["MH"]["bbox"]) == 4


@pytest.mark.parametrize("q,expected", [
    ("9625 3174", P[("MH", "P015")]),           # ULPIN prefix with spaces
    ("118/1", P[("MH", "P015")]),               # Khasra no. with part
    ("1842", P[("MH", "P009")]),                # CTS no. stated on the Property Card
    ("Behat", P[("UP", "P013")]),               # place name
])
def test_search(client, q, expected):
    res = client.get("/v1/search", params={"q": q}).json()["results"]
    assert expected in [r["ulpin"] for r in res]


def test_officer_login_rejects_bad_password(client):
    r = client.post("/v1/officer/login", json={"username": "mh.talathi.umbraj", "password": "wrong"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    r = client.post("/v1/officer/login", json={"username": "mh.talathi.umbraj", "password": "landstack@2026"})
    assert r.status_code == 401                      # password stays case-sensitive


def test_officer_login_tolerates_id_case_and_whitespace(client):
    r = client.post("/v1/officer/login", json={"username": "  MH.Talathi.Umbraj ", "password": PW + " "})
    assert r.status_code == 200 and r.json()["officer"]["username"] == "mh.talathi.umbraj"
    assert client.get("/v1/officer/work").status_code == 401


def test_state_specific_work_queues(client):
    h, me = login(client, "gj.edhara.bhuj")
    assert me["designation"] == "Deputy Mamlatdar (e-Dhara)" and me["process"]["notice_days"] == 30
    items = client.get("/v1/officer/work", headers=h).json()["items"]
    mut = next(x for x in items if x["type"] == "mutation")
    assert mut["reference"] == "VF6-2038-0013" and mut["register"] == "VF 6"
    assert set(mut["allowed_actions"]) == {"verify_entry", "generate_135d", "approve_s_form", "return"}
    assert all(x["district"] == "Kutch" for x in items), "jurisdiction scoping"

    h2, me2 = login(client, "up.tehsil.behat")
    items2 = client.get("/v1/officer/work", headers=h2).json()["items"]
    assert me2["login_category"] == "Tehsil Mutation Login"
    assert any(x["register"] == "Namantaran" and x["status"] == "pending" for x in items2)


def test_actions_are_role_checked_audited_and_do_not_touch_sources(client, service):
    h, _ = login(client, "mh.talathi.umbraj")
    item = next(x for x in client.get("/v1/officer/work", headers=h).json()["items"] if x["type"] == "mutation" and x["status"] == "pending")
    denied = client.post("/v1/officer/actions", headers=h, json={"item_id": item["item_id"], "action": "certify"})
    assert denied.status_code == 403  # a Talathi cannot certify under MLRC s.150
    needs = client.post("/v1/officer/actions", headers=h, json={"item_id": item["item_id"], "action": "register_objection"})
    assert needs.status_code == 422
    ok = client.post("/v1/officer/actions", headers=h, json={"item_id": item["item_id"], "action": "issue_notice", "remarks": "Notice posted at chawadi"})
    assert ok.status_code == 200 and "not modified" in ok.json()["note"]
    after = next(x for x in client.get("/v1/officer/work", headers=h).json()["items"] if x["item_id"] == item["item_id"])
    assert after["status"] == "notice_served"
    audit = client.get("/v1/officer/audit", headers=h).json()["entries"]
    assert audit[0]["action"] == "issue_notice" and audit[0]["officer"] == "mh.talathi.umbraj"
    # the source mutation record is unchanged
    assert service.bundle(item["ulpin"]).mutations[0].status == "pending"


def test_jurisdiction_enforced(client):
    h, _ = login(client, "up.tehsil.behat")
    assert client.get(f"/v1/officer/parcels/{P[('UP', 'P013')]}", headers=h).status_code == 200
    r = client.get(f"/v1/officer/parcels/{P[('UP', 'P001')]}", headers=h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "OUT_OF_JURISDICTION"


def test_reports(client):
    rep = client.get("/v1/reports/summary").json()
    assert rep["parcels"] == 45 and rep["mutations"]["pending"] == 3
    assert rep["discrepancies"]["ownership"] >= 6 and rep["parcels_by_discrepancy"]["area_gis"] >= 6
    h, _ = login(client, "up.board")
    orep = client.get("/v1/officer/reports", headers=h).json()
    assert orep["parcels"] == 15 and "work" in orep


def test_assistant_grounding_and_unconfigured_behaviour(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    assert client.get("/v1/assistant/status").json()["configured"] is False
    ctx = client.get(f"/v1/parcels/{P[('MH', 'P015')]}/assistant-context").json()
    assert any(f["rule"] == "GIS-001" for f in ctx["validation"]["findings"])
    assert any(r["source"].startswith("bhulekh.record_712") for r in ctx["records"])
    r = client.post("/v1/assistant/ask", json={"ulpin": P[("MH", "P015")], "question": "Why does the GIS area differ?"})
    assert r.status_code == 503 and r.json()["error"]["required_env"] == "ANTHROPIC_API_KEY"


def test_portal_is_served_at_root(client):
    r = client.get("/")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]

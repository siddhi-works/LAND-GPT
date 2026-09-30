"""LandGPT chat endpoint: provider selection, demo mode, server-side grounding."""
import pytest

from .conftest import P

KEYS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY",
        "LANDSTACK_CHAT_PROVIDER", "LANDSTACK_CHAT_MODEL")


@pytest.fixture
def no_provider(monkeypatch):
    for k in KEYS:
        monkeypatch.delenv(k, raising=False)


def ask(client, text, context=None, history=()):
    msgs = [*history, {"role": "user", "content": text}]
    return client.post("/v1/chat", json={"messages": msgs, "context": context, "lang": "en"})


def test_status_is_demo_without_provider(client, no_provider):
    s = client.get("/v1/chat/status").json()
    assert s["mode"] == "demo" and s["provider"] == "demo" and s["model"] is None


def test_provider_selection_needs_key_and_model(client, no_provider, monkeypatch):
    monkeypatch.setenv("LANDSTACK_CHAT_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    s = client.get("/v1/chat/status").json()
    assert s["mode"] == "demo" and "LANDSTACK_CHAT_MODEL" in s["reason"]
    monkeypatch.setenv("LANDSTACK_CHAT_PROVIDER", "nonsense")
    assert "Unknown" in client.get("/v1/chat/status").json()["reason"]


def test_demo_answers_known_terms(client, no_provider):
    r = ask(client, "What is ULPIN?")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "demo" and "14-digit" in body["reply"] and "demo" not in body["reply"].lower()
    assert "Ferfar" in ask(client, "What is a 7/12 record?").json()["reply"]
    k = ask(client, "What is K-Prat?").json()
    assert "not yet connected" in k["reply"]


def test_demo_explains_open_parcel_from_records_only(client, no_provider):
    u = P[("MH", "P015")]
    body = ask(client, "Explain this parcel", {"page": "profile", "ulpin": u}).json()
    assert u in body["reply"] and "GIS-001" in body["reply"]
    assert body["grounding"]["ulpin"] == u and "GIS-001" in body["grounding"]["rules"]
    assert any(link["href"] == f"#/parcel/{u}" for link in body["links"])
    area = ask(client, "What is the area?", {"ulpin": u}).json()["reply"]
    assert "5% tolerance" in area


def test_demo_without_parcel_does_not_invent(client, no_provider):
    body = ask(client, "Explain this parcel", {"page": "home"}).json()
    assert "No parcel is open" in body["reply"]


def test_location_context_is_resolved_from_registry(client, no_provider):
    body = ask(client, "Tell me about this district", {"state": "MH", "district": "Pune"}).json()
    loc = body["grounding"]["location"]
    assert loc["state"] == "Maharashtra" and loc["district"] == "Pune" and loc["ulpin_parcels"] >= 1
    # unknown names are dropped, not echoed back as facts
    loc2 = ask(client, "hi", {"state": "MH", "district": "Atlantis"}).json()["grounding"]["location"]
    assert "district" not in loc2


def test_bad_requests(client, no_provider):
    assert client.post("/v1/chat", json={"messages": [{"role": "assistant", "content": "x"}]}).status_code == 400
    assert ask(client, "Explain", {"ulpin": "00000000000000"}).status_code == 404


def test_general_land_questions(client, no_provider):
    """The citizen assistant is first a general land-information assistant."""
    assert "consolidation" in ask(client, "What is Gat?").json()["reply"]
    assert "Khatauni" in ask(client, "What is Khatauni?").json()["reply"]
    where = ask(client, "Where can I find mutation information?").json()["reply"]
    assert "Ferfar" in where and "Namantaran" in where and "VF 6" in where
    dept = ask(client, "Which department handles land records?").json()["reply"]
    assert "Revenue" in dept and "Sub-Registrar" in dept
    # a general question stays general with a parcel open; parcel questions still use the parcel
    u = P[("MH", "P001")]
    assert "Sub-Registrar" in ask(client, "Which department handles land records?", {"ulpin": u}).json()["reply"]
    assert u in ask(client, "Explain this parcel", {"ulpin": u}).json()["reply"]
    for q in ("What is Gat?", "hello"):
        assert "demo" not in ask(client, q).json()["reply"].lower()

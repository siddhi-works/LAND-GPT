"""Portal, officer-workflow and assistant routes (all under /v1)."""
from __future__ import annotations

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, Field

from .. import assistant, portal
from ..config import API_VERSION
from ..service import LandStackService
from ..workflow import AuthError, Workflow


class LoginRequest(BaseModel):
    username: str
    password: str


class ActionRequest(BaseModel):
    item_id: str
    action: str
    remarks: str = ""
    to: str | None = None


class AskRequest(BaseModel):
    ulpin: str
    question: str = Field(min_length=3, max_length=1000)


def portal_router(svc: LandStackService, wf: Workflow) -> APIRouter:
    r = APIRouter(prefix=f"/{API_VERSION}")

    # -- GIS & navigation -----------------------------------------------------------------
    @r.get("/gis/parcels", tags=["gis"])
    def gis_parcels(state: str | None = Query(None, description="MH, UP or GJ")):
        """All ULPIN-linked cadastral parcels as a GeoJSON FeatureCollection."""
        return portal.feature_collection(svc, state)

    @r.get("/admin/hierarchy", tags=["gis"])
    def admin_hierarchy():
        """State -> District -> Taluka/Tehsil -> Village tree with extents, from the registries."""
        return {"api_version": API_VERSION, **portal.hierarchy(svc)}

    @r.get("/search", tags=["registry"])
    def search(q: str = Query(..., min_length=1), state: str | None = None):
        """Search by ULPIN, native identifier (Survey/Gat/Khasra/CTS, Khata/RoR no.) or place name."""
        return {"api_version": API_VERSION, "query": q, "results": portal.search(svc, q, state)}

    @r.get("/validation/findings", tags=["validation"])
    def validation_findings(state: str | None = None, district: str | None = None):
        return {"api_version": API_VERSION, "findings": portal.findings(svc, state, district)}

    @r.get("/reports/summary", tags=["analytics"])
    def reports_summary(state: str | None = None, district: str | None = None):
        return {"api_version": API_VERSION, **portal.reports(svc, state, district)}

    # -- officer workflow ---------------------------------------------------------------------
    @r.get("/officer/accounts", tags=["officer"])
    def accounts():
        return {"accounts": wf.accounts()}

    @r.post("/officer/login", tags=["officer"])
    def login(body: LoginRequest):
        s = wf.login(body.username, body.password)
        return {"token": s.token, "officer": wf.profile(s)}

    @r.get("/officer/me", tags=["officer"])
    def me(authorization: str | None = Header(None)):
        return wf.profile(wf.session(authorization))

    @r.post("/officer/logout", tags=["officer"])
    def logout(authorization: str | None = Header(None)):
        wf.logout(wf.session(authorization))
        return {"ok": True}

    @r.get("/officer/work", tags=["officer"])
    def work(authorization: str | None = Header(None), include_completed: bool = True):
        s = wf.session(authorization)
        return {"officer": wf.profile(s), "items": wf.items(s, include_completed)}

    @r.post("/officer/actions", tags=["officer"])
    def act(body: ActionRequest, authorization: str | None = Header(None)):
        s = wf.session(authorization)
        return wf.act(s, body.item_id, body.action, body.remarks, body.to)

    @r.get("/officer/parcels/{ulpin}", tags=["officer"])
    def officer_parcel(ulpin: str, authorization: str | None = Header(None)):
        """Jurisdiction check for an officer opening a parcel (404/403 otherwise)."""
        s = wf.session(authorization)
        b = wf.require_scope(s, ulpin)
        return {"ulpin": b.identity.ulpin, "in_jurisdiction": True,
                "work_items": [x for x in wf.items(s) if x["ulpin"] == b.identity.ulpin]}

    @r.get("/officer/reports", tags=["officer"])
    def officer_reports(authorization: str | None = Header(None)):
        s = wf.session(authorization)
        jur = s.officer["jurisdiction"]
        rep = portal.reports(svc, jur["state"], jur.get("district"))
        items = wf.items(s)
        rep["work"] = {
            "mutation_pending": sum(1 for x in items if x["type"] == "mutation" and x["status"] not in ("completed", "certified", "rejected")),
            "mutation_completed": sum(1 for x in items if x["type"] == "mutation" and x["status"] in ("completed", "certified", "rejected")),
            "verification_open": sum(1 for x in items if x["type"] == "verification" and x["status"] in ("pending", "returned")),
            "verification_reviewed": sum(1 for x in items if x["type"] == "verification" and x["status"] not in ("pending", "returned")),
            "actions_this_session": sum(1 for e in wf.log if e["officer"] == s.officer["username"] and e["item_id"]),
        }
        return {"api_version": API_VERSION, **rep}

    @r.get("/officer/audit", tags=["officer"])
    def audit(authorization: str | None = Header(None), ulpin: str | None = None):
        s = wf.session(authorization)
        return {"entries": wf.audit(s, ulpin)}

    # -- assistant --------------------------------------------------------------------------
    @r.get("/assistant/status", tags=["assistant"])
    def assistant_status():
        return assistant.status()

    @r.get("/parcels/{ulpin}/assistant-context", tags=["assistant"])
    def assistant_context(ulpin: str):
        """Exactly the data the assistant is grounded on for this ULPIN."""
        return assistant.context(svc, ulpin)

    @r.post("/assistant/ask", tags=["assistant"])
    def assistant_ask(body: AskRequest):
        return assistant.ask(svc, body.ulpin, body.question)

    return r


__all__ = ["portal_router", "AuthError"]

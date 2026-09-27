"""Unified, versioned Land Stack API.

Run:  uvicorn interop.api.app:create_app --factory --app-dir backend
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse

import os
from pathlib import Path

from fastapi.staticfiles import StaticFiles

from ..analytics import data_quality
from ..assistant import AssistantUnavailable
from ..config import REPO_ROOT
from ..workflow import AuthError, Workflow
from .portal_routes import portal_router
from ..canonical.model import CONCEPTS, ParcelBundle
from ..config import API_VERSION, ENGINE_VERSION, Settings
from ..registry import StateRef, UlpinError
from ..service import LandStackService
from ..sources import JsonSourceStore
from ..validation import rule_specs
from ..validation.model import RuleSpec
from ..validation.rules import primary_area_record, transfers
from . import schemas as s

_COMPARES = {spec.rule_id: set(spec.compares) for spec in rule_specs()}


class UTF8JSONResponse(JSONResponse):
    """JSON with an explicit charset so legacy clients decode native-script values correctly."""

    media_type = "application/json; charset=utf-8"


def _state(svc: LandStackService, b: ParcelBundle) -> StateRef:
    return StateRef(code=b.identity.state_code, name=b.identity.state_name)


def _envelope(svc: LandStackService, b: ParcelBundle, concept: str, record_count: int,
              related: tuple[str, ...] | None = None) -> dict[str, Any]:
    concepts = set(related or (concept,))
    report = svc.verification(b.identity.ulpin)
    return dict(
        ulpin=b.identity.ulpin,
        state=_state(svc, b),
        concept=concept,
        supported=bool(concepts & svc.supported_concepts(b.identity.state_code)),
        record_count=record_count,
        sources=[src for src in b.sources if concepts & set(src.concepts)],
        related_findings=[f for f in report.findings if _COMPARES[f.rule_id] & concepts],
    )


def _concept_counts(b: ParcelBundle) -> dict[str, int]:
    counts = {c: 0 for c in CONCEPTS}
    counts["parcel"] = 1
    for r in b.all_records():
        counts[r.concept] += 1
    return counts


def _availability(svc: LandStackService, b: ParcelBundle) -> dict[str, s.ConceptAvailability]:
    supported = svc.supported_concepts(b.identity.state_code) | {"parcel"}
    return {c: s.ConceptAvailability(supported=c in supported, record_count=n) for c, n in _concept_counts(b).items()}


def create_app(service: LandStackService | None = None) -> FastAPI:
    settings = service.settings if service else Settings.from_env()
    svc = service or LandStackService(JsonSourceStore(settings.data_root), settings=settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        svc.warm()
        yield

    app = FastAPI(
        title="Land Stack Interoperability API",
        version=ENGINE_VERSION,
        description="Federates Maharashtra, Uttar Pradesh and Gujarat land systems through a canonical "
                    "semantic layer. State data is read-only; every response keeps state/source provenance.",
        lifespan=lifespan,
        default_response_class=UTF8JSONResponse,
    )
    app.state.service = svc
    v1 = APIRouter(prefix=f"/{API_VERSION}")

    @app.exception_handler(UlpinError)
    async def _ulpin_error(_: Request, exc: UlpinError):
        return UTF8JSONResponse(status_code=exc.status,
                            content={"error": {"code": exc.code, "message": exc.message, "ulpin": exc.ulpin}})

    errors = {404: {"model": s.ErrorResponse}, 409: {"model": s.ErrorResponse}, 422: {"model": s.ErrorResponse}}

    @app.exception_handler(AuthError)
    async def _auth_error(_: Request, exc: AuthError):
        return UTF8JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(AssistantUnavailable)
    async def _assistant_unavailable(_: Request, exc: AssistantUnavailable):
        return UTF8JSONResponse(status_code=503, content={"error": {"code": "ASSISTANT_UNAVAILABLE", "message": str(exc),
                                                                    "required_env": "ANTHROPIC_API_KEY"}})

    # -- service ------------------------------------------------------------------------
    # The web portal is served at "/" (see the StaticFiles mount below); the API index lives at /v1.
    @app.get(f"/{API_VERSION}", include_in_schema=False)
    def index() -> dict:
        return {"service": "Land Stack Interoperability API", "api_version": API_VERSION,
                "docs": "/docs", "openapi": "/openapi.json",
                # Derived from the OpenAPI schema: app.routes may contain included-router
                # wrappers without a `path` attribute, depending on the FastAPI version.
                "endpoints": sorted(p for p in app.openapi().get("paths", {})
                                    if p.startswith(f"/{API_VERSION}/"))}

    @app.get("/health", include_in_schema=False)
    @v1.get("/health", tags=["service"])
    def health() -> dict:
        desc = svc.store.describe()
        return {
            "status": "ok",
            "api_version": API_VERSION,
            "engine_version": ENGINE_VERSION,
            "glossary_version": svc.glossary.version,
            "as_of": str(svc.settings.as_of),
            "store": {
                "kind": desc.kind, "root": desc.root, "read_only": True,
                "files": [{"path": f.path, "sha256": f.sha256, "tables": list(f.tables), "rows": f.rows}
                          for f in desc.files],
            },
            "states": {
                code: {"name": a.state_name, "parcels": len(svc.registry.identities(code)),
                       "native_tables": svc.store.tables(code),
                       "supported_concepts": sorted(svc.supported_concepts(code) | {"parcel"})}
                for code, a in sorted(svc.adapters.items())
            },
            "registry": {"ulpins": len(svc.registry), "issues": svc.registry.issues},
        }

    # -- registry -----------------------------------------------------------------------
    @v1.get("/registry", tags=["registry"], response_model=s.RegistryListResponse)
    def registry_list(state: str | None = Query(None, description="State code: MH, UP, GJ")):
        if state and state not in svc.adapters:
            raise HTTPException(422, f"unknown state '{state}'; connected: {sorted(svc.adapters)}")
        items = [
            s.RegistryListItem(ulpin=i.ulpin, state=StateRef(code=i.state_code, name=i.state_name),
                               jurisdiction=i.jurisdiction.model_dump(),
                               primary_identifier=i.primary_identifier.model_dump())
            for i in sorted(svc.registry.identities(state), key=lambda i: (i.state_code, i.ulpin))
        ]
        return s.RegistryListResponse(count=len(items), items=items)

    @v1.get("/registry/ulpin/{ulpin}", tags=["registry"], responses=errors)
    def registry_ulpin(ulpin: str):
        return {"api_version": API_VERSION, **svc.registry_entry(ulpin).model_dump(mode="json")}

    # -- parcels ------------------------------------------------------------------------
    @v1.get("/parcels/{ulpin}", tags=["parcels"], response_model=s.ParcelSummaryResponse, responses=errors)
    def parcel(ulpin: str):
        b = svc.bundle(ulpin)
        rep = svc.verification(ulpin)
        u = b.identity.ulpin
        base = f"/{API_VERSION}/parcels/{u}"
        return s.ParcelSummaryResponse(
            registry=svc.registry_entry(u), context=b.identity.context,
            land_record_area=b.identity.land_record_area, declared_gis_area=b.identity.declared_gis_area,
            concepts=_availability(svc, b),
            verification=s.VerificationHeadline(risk_level=rep.risk_level, summary=rep.summary),
            dataset_label=b.identity.dataset_label.model_dump(),
            links={name: f"{base}/{name}" for name in (
                "profile", "land-records", "ownership", "registration", "mutation", "planning", "building",
                "encumbrance", "tax", "utilities", "gis", "verification")},
        )

    @v1.get("/parcels/{ulpin}/profile", tags=["parcels"], response_model=s.ProfileResponse, responses=errors)
    def profile(ulpin: str):
        b = svc.bundle(ulpin)
        return s.ProfileResponse(registry=svc.registry_entry(ulpin), concepts=_availability(svc, b),
                                 canonical=b, verification=svc.verification(ulpin))

    @v1.get("/parcels/{ulpin}/land-records", tags=["parcels"], response_model=s.LandRecordsResponse, responses=errors)
    def land_records(ulpin: str):
        b = svc.bundle(ulpin)
        return s.LandRecordsResponse(**_envelope(svc, b, "land_record", len(b.land_records)), records=b.land_records)

    @v1.get("/parcels/{ulpin}/ownership", tags=["parcels"], response_model=s.OwnershipResponse, responses=errors)
    def ownership(ulpin: str):
        b = svc.bundle(ulpin)
        rep = svc.verification(ulpin)
        holders: dict[str, s.HolderSummary] = {}
        for c in b.ownership:
            if c.role != "recorded_holder":
                continue
            key = (c.party.en or c.party.native or "").casefold()
            h = holders.setdefault(key, s.HolderSummary(party=c.party, stated_by=[], record_ids=[]))
            h.stated_by.append(c.native_record_type)
            h.record_ids.append(c.basis_record_id)
        regs = transfers(b)
        latest = regs[-1] if regs else None
        transferees = [s.TransfereeSummary(party=p, document_no=latest.document_no,
                                           registration_date=latest.registration_date)
                       for p in (latest.claimants if latest else [])]
        checks = {c.rule_id: c for c in rep.checks}
        own = [f for f in rep.findings if f.rule_id in ("OWN-001", "OWN-002")]
        if any(f.status == "open" for f in own):
            status, basis = "mismatch", "; ".join(f.message for f in own)
        elif own:
            status, basis = "mismatch_pending_mutation", "; ".join(f.message for f in own)
        elif checks["OWN-002"].outcome == "pass" or checks["OWN-001"].outcome == "pass":
            status = "consistent"
            basis = "; ".join(c.detail for c in (checks["OWN-001"], checks["OWN-002"]) if c.outcome == "pass")
        else:
            status, basis = "undetermined", checks["OWN-002"].detail
        return s.OwnershipResponse(
            **_envelope(svc, b, "ownership", len(b.ownership)),
            summary=s.OwnershipSummary(recorded_holders=list(holders.values()),
                                       latest_registered_transferee=transferees, status=status, basis=basis),
            records=b.ownership,
        )

    @v1.get("/parcels/{ulpin}/registration", tags=["parcels"], response_model=s.RegistrationResponse, responses=errors)
    def registration(ulpin: str):
        b = svc.bundle(ulpin)
        return s.RegistrationResponse(**_envelope(svc, b, "registration", len(b.registrations)),
                                      records=b.registrations)

    @v1.get("/parcels/{ulpin}/mutation", tags=["parcels"], response_model=s.MutationResponse, responses=errors)
    def mutation(ulpin: str):
        b = svc.bundle(ulpin)
        return s.MutationResponse(
            **_envelope(svc, b, "mutation", len(b.mutations)),
            summary=s.MutationSummary(register_names=sorted({m.register_name for m in b.mutations}),
                                      pending=sum(m.status == "pending" for m in b.mutations),
                                      finalized=sum(m.status == "finalized" for m in b.mutations)),
            records=b.mutations,
        )

    @v1.get("/parcels/{ulpin}/planning", tags=["parcels"], response_model=s.PlanningResponse, responses=errors)
    def planning(ulpin: str):
        b = svc.bundle(ulpin)
        n = len(b.planning) + len(b.land_use) + len(b.environmental_restrictions)
        return s.PlanningResponse(
            **_envelope(svc, b, "planning", n, ("planning", "land_use", "environmental_restriction")),
            planning=b.planning, land_use=b.land_use, environmental_restrictions=b.environmental_restrictions,
        )

    @v1.get("/parcels/{ulpin}/building", tags=["parcels"], response_model=s.BuildingResponse, responses=errors)
    def building(ulpin: str):
        b = svc.bundle(ulpin)
        return s.BuildingResponse(**_envelope(svc, b, "building_permission", len(b.building_permissions)),
                                  records=b.building_permissions)

    @v1.get("/parcels/{ulpin}/encumbrance", tags=["parcels"], response_model=s.EncumbranceResponse, responses=errors)
    def encumbrance(ulpin: str):
        b = svc.bundle(ulpin)
        return s.EncumbranceResponse(
            **_envelope(svc, b, "encumbrance", len(b.encumbrances) + len(b.litigation), ("encumbrance", "litigation")),
            summary=s.EncumbranceSummary(active=sum(e.status == "active" for e in b.encumbrances),
                                         released=sum(e.status == "released" for e in b.encumbrances),
                                         litigation_flagged=len(b.litigation)),
            encumbrances=b.encumbrances, litigation=b.litigation,
        )

    @v1.get("/parcels/{ulpin}/tax", tags=["parcels"], response_model=s.TaxResponse, responses=errors)
    def tax(ulpin: str):
        b = svc.bundle(ulpin)
        outstanding = [t.outstanding_inr for t in b.property_tax if t.outstanding_inr is not None]
        return s.TaxResponse(**_envelope(svc, b, "property_tax", len(b.property_tax)),
                             summary=s.TaxSummary(outstanding_inr=sum(outstanding) if outstanding else None),
                             records=b.property_tax)

    @v1.get("/parcels/{ulpin}/utilities", tags=["parcels"], response_model=s.UtilitiesResponse, responses=errors)
    def utilities(ulpin: str):
        b = svc.bundle(ulpin)
        return s.UtilitiesResponse(**_envelope(svc, b, "utilities", len(b.utilities)), records=b.utilities)

    @v1.get("/parcels/{ulpin}/gis", tags=["parcels"], response_model=s.GisResponse, responses=errors)
    def gis(ulpin: str):
        b = svc.bundle(ulpin)
        tol = svc.settings.tolerances.gis_area_rel
        rec = primary_area_record(b)
        rec_area = rec.area if rec else b.identity.land_record_area
        g = b.geometry[0] if b.geometry else None
        gis_area = g.computed_area if g else None
        rel = None
        if rec_area and rec_area.value_ha and gis_area and gis_area.value_ha is not None:
            rel = round(abs(gis_area.value_ha - rec_area.value_ha) / rec_area.value_ha, 4)
        feature = None if g is None else {
            "type": "Feature", "id": b.identity.ulpin, "geometry": g.geometry,
            "properties": {"ulpin": b.identity.ulpin, "state_code": b.identity.state_code,
                           **b.identity.jurisdiction.model_dump(exclude={"state_code"}),
                           "native_identifier": b.identity.primary_identifier.model_dump(),
                           "computed_area_ha": gis_area.value_ha if gis_area else None,
                           "source_locator": g.provenance.locator},
        }
        return s.GisResponse(
            **_envelope(svc, b, "geometry", len(b.geometry) + len(b.cadastral_maps)),
            area_comparison=s.AreaComparison(
                record_area=rec_area, record_area_source=rec.native_record_type if rec else "Parcel registry",
                computed_gis_area=gis_area, declared_gis_area=b.identity.declared_gis_area,
                cadastral_map_area=b.cadastral_maps[0].map_area if b.cadastral_maps else None,
                relative_difference=rel, tolerance=tol, within_tolerance=None if rel is None else rel <= tol,
            ),
            feature=feature, geometry=b.geometry, cadastral_maps=b.cadastral_maps,
        )

    @v1.get("/parcels/{ulpin}/verification", tags=["parcels"], responses=errors)
    def verification(ulpin: str):
        return {"api_version": API_VERSION, **svc.verification(ulpin).model_dump(mode="json")}

    # -- glossary -------------------------------------------------------------------------
    @v1.get("/glossary", tags=["glossary"])
    def glossary_index():
        g = svc.glossary
        return {"api_version": API_VERSION, "version": g.version, "description": g.doc["description"],
                "concepts": {k: {"label": v["label"], "definition": v["definition"]} for k, v in g.concepts.items()},
                "vocabularies": {k: {"concept": v["concept"], "entries": len(v["entries"])}
                                 for k, v in g.vocabularies.items()},
                "terms": len(g.terms)}

    @v1.get("/glossary/resolve", tags=["glossary"])
    def glossary_resolve(term: str = Query(..., description="Native term or value, e.g. Ferfar, VF 6, खतौनी"),
                         state: str | None = Query(None, description="Restrict to a state code")):
        return {"api_version": API_VERSION, **svc.glossary.find(term, state)}

    @v1.get("/glossary/{concept}", tags=["glossary"], responses={404: {"model": s.ErrorResponse}})
    def glossary_concept(concept: str):
        view = svc.glossary.concept_view(concept)
        if view is None:
            hits = svc.glossary.find(concept)
            hint = sorted({t["concept"] for t in hits["terms"]} | {v["concept"] for v in hits["values"]})
            return UTF8JSONResponse(status_code=404, content={"error": {
                "code": "CONCEPT_NOT_FOUND",
                "message": f"'{concept}' is not a canonical concept"
                           + (f"; it is a native term for: {', '.join(hint)}" if hint else ""),
                "concepts": list(svc.glossary.concepts)}})
        return {"api_version": API_VERSION, "glossary_version": svc.glossary.version, **view}

    # -- validation & analytics ---------------------------------------------------------------
    @v1.get("/validation/rules", tags=["validation"], response_model=list[RuleSpec])
    def rules():
        return rule_specs()

    @v1.get("/analytics/data-quality", tags=["analytics"])
    def analytics_dq():
        return data_quality(svc)

    app.include_router(v1)
    workflow = Workflow(svc)
    app.state.workflow = workflow
    app.include_router(portal_router(svc, workflow))

    # Web portal (citizen + officer) served from the same origin as the API.
    frontend = Path(os.environ.get("LANDSTACK_FRONTEND_DIR", str(REPO_ROOT / "frontend")))
    if frontend.is_dir():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="portal")
    return app

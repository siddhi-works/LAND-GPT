"""Validation rules. They run on *canonical* bundles (after normalization) and only read.

Each rule is a plain function registered with a :class:`RuleSpec`. A rule either records
findings (outcome ``fail``), confirms the check held (``pass``), or declares itself
``not_applicable`` when the parcel lacks the sources needed — it never assumes data that
is not there.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Iterable

from ..canonical.model import (
    CanonicalRecord,
    LandRecord,
    LocalizedText,
    ParcelBundle,
    ParcelIdentity,
    Registration,
)
from ..config import Tolerances
from ..geo import geometries_equal, outer_ring, point_in_ring, ring_problems, rings_overlap
from ..glossary import Glossary
from ..normalize import has_non_latin_letters, norm_code, norm_name, norm_term
from .model import CheckResult, Finding, Observation, RuleSpec, Severity


# ---------------------------------------------------------------------------------------
# rule context
# ---------------------------------------------------------------------------------------
@dataclass
class StateIndex:
    """Cross-parcel facts within one state needed by linkage/spatial rules."""

    documents: dict[str, str] = field(default_factory=dict)  # document_no -> ulpin
    mutation_document_refs: set[str] = field(default_factory=set)
    rings: dict[str, Any] = field(default_factory=dict)  # ulpin -> outer ring


@dataclass
class RuleContext:
    bundle: ParcelBundle
    glossary: Glossary
    tolerances: Tolerances
    as_of: date
    index: StateIndex

    @property
    def identity(self) -> ParcelIdentity:
        return self.bundle.identity


class Evaluation:
    def __init__(self, spec: RuleSpec, ctx: RuleContext):
        self.spec = spec
        self.ctx = ctx
        self.findings: list[Finding] = []
        self.outcome: str | None = None
        self.detail = ""

    def add(self, message: str, observations: list[Observation], *, expectation: str,
            severity: Severity | None = None, metrics: dict[str, Any] | None = None,
            related_keys: Iterable[str] = ()) -> None:
        ident = self.ctx.identity
        basis = message + "|" + "|".join(sorted(f"{o.record_id}:{o.field}" for o in observations))
        digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:10]
        self.findings.append(Finding(
            finding_id=f"{self.spec.rule_id}:{ident.ulpin}:{digest}",
            rule_id=self.spec.rule_id, rule_name=self.spec.name, category=self.spec.category,
            kind=self.spec.kind, severity=severity or self.spec.default_severity,
            ulpin=ident.ulpin, state_code=ident.state_code, message=message, expectation=expectation,
            observations=observations, metrics=metrics or {}, related_keys=list(related_keys),
        ))

    def not_applicable(self, detail: str) -> "Evaluation":
        self.outcome, self.detail = "not_applicable", detail
        return self

    def done(self, pass_detail: str) -> "Evaluation":
        if self.findings:
            self.outcome = "fail"
            self.detail = f"{len(self.findings)} finding(s)"
        else:
            self.outcome, self.detail = "pass", pass_detail
        return self

    def result(self) -> CheckResult:
        return CheckResult(rule_id=self.spec.rule_id, rule_name=self.spec.name, outcome=self.outcome or "pass",
                           detail=self.detail, finding_ids=[f.finding_id for f in self.findings])


RuleFn = Callable[[Evaluation], Evaluation]
RULES: list[tuple[RuleSpec, RuleFn]] = []


def rule(rule_id: str, name: str, category: str, kind: str, severity: str, description: str,
         compares: list[str]) -> Callable[[RuleFn], RuleFn]:
    def deco(fn: RuleFn) -> RuleFn:
        RULES.append((RuleSpec(rule_id=rule_id, name=name, category=category, kind=kind,
                               default_severity=severity, description=description, compares=compares), fn))
        return fn
    return deco


# ---------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------
def obs(record: CanonicalRecord, field_name: str, value: Any) -> Observation:
    p = record.provenance
    return Observation(record_id=record.record_id, state_code=p.state_code, source_system=p.source_system,
                       source_table=p.source_table, native_record_type=p.native_record_type,
                       locator=p.locator, field=field_name, value=value)


def obs_identity(identity: ParcelIdentity, field_name: str, value: Any) -> Observation:
    p = identity.provenance
    return Observation(record_id=f"{identity.state_code}:{p.source_table}:{identity.ulpin}", state_code=p.state_code,
                       source_system=p.source_system, source_table=p.source_table,
                       native_record_type=p.native_record_type, locator=p.locator, field=field_name, value=value)


def name_key(t: LocalizedText | None) -> str | None:
    if t is None:
        return None
    return norm_name(t.en) or norm_name(t.native)


def display(t: LocalizedText | None) -> str:
    if t is None:
        return "?"
    return t.en or t.native or "?"


HOLDER_CLASSES = ("record_of_rights", "holding_account", "urban_property_record")
ROR_PRIORITY = ("record_of_rights", "urban_property_record", "holding_account", "plot_register")


def holder_records(b: ParcelBundle) -> list[LandRecord]:
    return [lr for lr in b.land_records if lr.record_class in HOLDER_CLASSES and lr.holders]


def primary_area_record(b: ParcelBundle) -> LandRecord | None:
    candidates = [lr for lr in b.land_records if lr.area and lr.area.value_ha is not None]
    candidates.sort(key=lambda lr: ROR_PRIORITY.index(lr.record_class))
    return candidates[0] if candidates else None


def primary_use_record(b: ParcelBundle) -> LandRecord | None:
    for cls in ROR_PRIORITY:
        for lr in b.land_records:
            if lr.record_class == cls and lr.land_use:
                return lr
    return None


def transfers(b: ParcelBundle) -> list[Registration]:
    regs = [r for r in b.registrations if r.transaction_type in ("sale", "gift")
            or r.document_type in ("sale_deed", "gift_deed")]
    return sorted(regs, key=lambda r: (r.registration_date or date.min, r.document_no))


def rel_diff(a: float, b: float) -> float:
    return abs(a - b) / b if b else float("inf")


def source_names(b: ParcelBundle, concept: str) -> list[str]:
    return sorted({s.native_record_type for s in b.sources if concept in s.concepts})


def fmt_ha(v: float | None) -> str:
    return "n/a" if v is None else f"{v:.4f} ha"


# ---------------------------------------------------------------------------------------
# ownership
# ---------------------------------------------------------------------------------------
@rule("OWN-001", "record_holder_consistency", "ownership", "inconsistency", "high",
      "Holders named by different land records of the same parcel (7/12 vs 8A, VF 7/12 vs VF 8A, "
      "record vs Property Card) must be the same parties (normalized English transliteration).",
      ["land_record", "ownership"])
def own_001(ev: Evaluation) -> Evaluation:
    recs = holder_records(ev.ctx.bundle)
    if len(recs) < 2:
        return ev.not_applicable("fewer than two land records name holders")
    keysets = {lr.record_id: {name_key(h) for h in lr.holders} for lr in recs}
    if len({frozenset(v) for v in keysets.values()}) > 1:
        parts = ", ".join(f"{lr.native_record_type}: {', '.join(display(h) for h in lr.holders)}" for lr in recs)
        ev.add(f"Recorded holders differ between land records ({parts}).",
               [obs(lr, "holders", [h.model_dump() for h in lr.holders]) for lr in recs],
               expectation="identical holder set across all holder-bearing land records (normalized names)")
    return ev.done(f"holders agree across {', '.join(lr.native_record_type for lr in recs)}")


@rule("OWN-002", "registered_transferee_vs_recorded_holder", "ownership", "inconsistency", "high",
      "The transferee of the latest registered sale/gift must appear as a recorded holder in the "
      "record of rights / Property Card. Explained when a mutation linked to that document is pending.",
      ["registration", "land_record", "mutation"])
def own_002(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    ts = transfers(b)
    if not ts:
        return ev.not_applicable("no registered sale/gift for this parcel")
    recs = holder_records(b)
    if not recs:
        return ev.not_applicable("no land record naming holders to compare with")
    t = ts[-1]
    recorded = {name_key(h) for lr in recs for h in lr.holders}
    missing = [c for c in t.claimants if name_key(c) not in recorded]
    if missing:
        linked = [m for m in b.mutations if m.linked_document_no == t.document_no]
        pending = [m for m in linked if m.status == "pending"]
        finalized = [m for m in linked if m.status == "finalized"]
        holders_txt = "; ".join(f"{lr.native_record_type}: {', '.join(display(h) for h in lr.holders)}" for lr in recs)
        head = (f"Registered transferee '{', '.join(display(c) for c in missing)}' of {t.document_no} "
                f"({t.registration_date}) is not a recorded holder ({holders_txt})")
        if pending:
            tail = (f"; linked {pending[0].register_name} {', '.join(m.mutation_no for m in pending)} is pending, "
                    f"so the record has not yet caught up with registration.")
        elif finalized:
            tail = (f"; linked {finalized[0].register_name} {', '.join(m.mutation_no for m in finalized)} is already "
                    f"finalized ({display(finalized[0].status_label)}), yet the record still names the earlier holder.")
        else:
            tail = "; no mutation entry references this document."
        observations = [obs(t, "claimants", [c.model_dump() for c in t.claimants])]
        observations += [obs(lr, "holders", [h.model_dump() for h in lr.holders]) for lr in recs]
        observations += [obs(m, "status", m.status_label.model_dump() if m.status_label else m.status) for m in linked]
        ev.add(head + tail, observations,
               expectation="latest registered transferee is a recorded holder once the linked mutation is finalized",
               metrics={"document_no": t.document_no,
                        "linked_mutations": {m.mutation_no: m.status for m in linked}},
               related_keys=[f"document:{t.document_no}"])
    return ev.done(f"transferee of {t.document_no} is the recorded holder")


# ---------------------------------------------------------------------------------------
# registration <-> mutation
# ---------------------------------------------------------------------------------------
@rule("MUT-001", "registration_mutation_lag", "mutation", "inconsistency", "medium",
      "A mutation linked to a registered transfer is still pending. Escalated to high when pending "
      "longer than the configured lag threshold after registration.",
      ["registration", "mutation"])
def mut_001(ev: Evaluation) -> Evaluation:
    b, tol, as_of = ev.ctx.bundle, ev.ctx.tolerances, ev.ctx.as_of
    ts = transfers(b)
    if not ts:
        return ev.not_applicable("no registered sale/gift for this parcel")
    for t in ts:
        for m in (m for m in b.mutations if m.linked_document_no == t.document_no and m.status == "pending"):
            since = (as_of - t.registration_date).days if t.registration_date else None
            delay = ((m.application_date - t.registration_date).days
                     if m.application_date and t.registration_date else None)
            sev = "high" if since is not None and since > tol.mutation_lag_days_high else "medium"
            ev.add(f"{t.document_no} was registered on {t.registration_date} but linked {m.register_name} "
                   f"{m.mutation_no} ({display(m.kind_label)}) is still pending — {since} days after registration "
                   f"as of {as_of}.",
                   [obs(t, "registration_date", str(t.registration_date)),
                    obs(m, "status", m.status_label.model_dump() if m.status_label else m.status),
                    obs(m, "application_date", str(m.application_date))],
                   expectation=f"linked mutation finalized within {tol.mutation_lag_days_high} days of registration",
                   severity=sev,
                   metrics={"document_no": t.document_no, "mutation_no": m.mutation_no,
                            "days_since_registration": since, "application_delay_days": delay,
                            "threshold_days": tol.mutation_lag_days_high, "as_of": str(as_of)},
                   related_keys=[f"document:{t.document_no}"])
    return ev.done("no pending mutation linked to a registered transfer")


@rule("MUT-002", "mutation_precedes_registration", "mutation", "inconsistency", "medium",
      "A mutation that cites a registered document cannot have been applied for before that "
      "document was registered.", ["mutation", "registration"])
def mut_002(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    regs = {r.document_no: r for r in b.registrations}
    pairs = [(m, regs[m.linked_document_no]) for m in b.mutations if m.linked_document_no in regs]
    if not pairs:
        return ev.not_applicable("no mutation linked to a registration of this parcel")
    for m, r in pairs:
        if m.application_date and r.registration_date and m.application_date < r.registration_date:
            days = (r.registration_date - m.application_date).days
            ev.add(f"{m.register_name} {m.mutation_no} ({display(m.kind_label)}) was applied for on "
                   f"{m.application_date}, {days} days before its basis document {r.document_no} was registered "
                   f"({r.registration_date}).",
                   [obs(m, "application_date", str(m.application_date)),
                    obs(r, "registration_date", str(r.registration_date))],
                   expectation="mutation application_date >= registration_date of the linked document",
                   metrics={"days_before_registration": days})
    return ev.done("every linked mutation was applied for on/after registration")


@rule("MUT-003", "mutation_kind_vs_document_type", "mutation", "inconsistency", "low",
      "The canonical mutation kind (from the glossary) must be compatible with the type of the "
      "registered document it cites (glossary compatibility matrix mutation_kind_document_type).",
      ["mutation", "registration"])
def mut_003(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    matrix, skipped = ev.ctx.glossary.compat("mutation_kind_document_type")
    regs = {r.document_no: r for r in b.registrations}
    pairs = [(m, regs[m.linked_document_no]) for m in b.mutations
             if m.linked_document_no in regs and m.kind in matrix and m.kind not in skipped]
    if not pairs:
        return ev.not_applicable("no linked mutation of an evaluable kind")
    for m, r in pairs:
        allowed = matrix[m.kind]
        if r.document_type not in allowed:
            ev.add(f"{m.register_name} {m.mutation_no} is a '{display(m.kind_label)}' mutation (canonical: {m.kind}) "
                   f"but cites {display(r.document_type_label)} {r.document_no} (canonical: {r.document_type}); "
                   f"compatible document types: {allowed or 'none — this kind is not based on a conveyance deed'}.",
                   [obs(m, "kind", m.kind_label.model_dump() if m.kind_label else m.kind),
                    obs(r, "document_type", r.document_type_label.model_dump() if r.document_type_label else r.document_type)],
                   expectation=f"document_type in {allowed}",
                   metrics={"mutation_kind": m.kind, "document_type": r.document_type, "allowed": allowed})
    return ev.done("mutation kinds are compatible with their cited documents")


@rule("LNK-001", "mutation_document_link_integrity", "linkage", "missing_link", "high",
      "A document cited by a mutation must exist in the state's registration source and belong to the "
      "same ULPIN.", ["mutation", "registration"])
def lnk_001(ev: Evaluation) -> Evaluation:
    b, idx = ev.ctx.bundle, ev.ctx.index
    cited = [m for m in b.mutations if m.linked_document_no]
    if not cited:
        return ev.not_applicable("no mutation cites a document")
    for m in cited:
        owner = idx.documents.get(m.linked_document_no)
        if owner is None:
            ev.add(f"{m.register_name} {m.mutation_no} cites {m.linked_document_no}, which does not exist in the "
                   f"state registration source.", [obs(m, "linked_document_no", m.linked_document_no)],
                   expectation="cited document present in registration source")
        elif owner != b.identity.ulpin:
            ev.add(f"{m.register_name} {m.mutation_no} cites {m.linked_document_no}, which is registered against "
                   f"ULPIN {owner}.", [obs(m, "linked_document_no", m.linked_document_no)],
                   expectation="cited document registered against the same ULPIN", metrics={"document_ulpin": owner})
    return ev.done(f"all {len(cited)} cited document(s) resolve to this ULPIN")


@rule("LNK-002", "registered_transfer_without_mutation", "linkage", "missing_link", "medium",
      "A registered sale/gift should be referenced by a mutation entry. Reported as info when the "
      "record already names the transferee (updated through another channel, e.g. Property Card).",
      ["registration", "mutation", "land_record"])
def lnk_002(ev: Evaluation) -> Evaluation:
    b, idx = ev.ctx.bundle, ev.ctx.index
    ts = transfers(b)
    if not ts:
        return ev.not_applicable("no registered sale/gift for this parcel")
    recorded = {name_key(h) for lr in holder_records(b) for h in lr.holders}
    for t in ts:
        if t.document_no in idx.mutation_document_refs:
            continue
        reflected = all(name_key(c) in recorded for c in t.claimants) and bool(recorded)
        ev.add(f"No mutation entry references registered {display(t.document_type_label)} {t.document_no} "
               f"({t.registration_date})" + ("; the land record already names the transferee." if reflected else "."),
               [obs(t, "document_no", t.document_no)],
               expectation="a mutation entry citing the registered transfer",
               severity="info" if reflected else "medium", metrics={"transferee_recorded": reflected})
    return ev.done("every registered transfer is referenced by a mutation")


# ---------------------------------------------------------------------------------------
# area & GIS
# ---------------------------------------------------------------------------------------
@rule("AREA-001", "textual_record_area_consistency", "area", "inconsistency", "high",
      "All textual area statements for the parcel (record of rights, holding account, plot register, "
      "Property Card, registry land-record area) must agree within the textual tolerance.",
      ["land_record", "parcel"])
def area_001(ev: Evaluation) -> Evaluation:
    b, tol = ev.ctx.bundle, ev.ctx.tolerances
    points: list[tuple[str, float, Observation]] = []
    for lr in b.land_records:
        if lr.area and lr.area.value_ha is not None:
            points.append((lr.native_record_type, lr.area.value_ha, obs(lr, "area", lr.area.model_dump())))
    ra = b.identity.land_record_area
    if ra and ra.value_ha is not None:
        points.append(("Parcel registry", ra.value_ha, obs_identity(b.identity, "land_record_area_hectare", ra.value_ha)))
    if len(points) < 2:
        return ev.not_applicable("fewer than two textual area statements")
    values = [p[1] for p in points]
    spread = max(values) - min(values)
    if spread > tol.textual_area_abs_ha:
        ev.add("Textual area statements disagree: " + ", ".join(f"{n} {fmt_ha(v)}" for n, v, _ in points) +
               f" (spread {spread:.4f} ha).", [p[2] for p in points],
               expectation=f"all textual areas equal within {tol.textual_area_abs_ha} ha",
               metrics={"values_ha": {n: v for n, v, _ in points}, "spread_ha": round(spread, 6),
                        "tolerance_ha": tol.textual_area_abs_ha})
    return ev.done(f"{len(points)} textual area statements agree")


@rule("AREA-002", "cadastral_map_area_vs_record_area", "area", "inconsistency", "medium",
      "Area on a cadastral map record (UP BhuNaksha) must match the record-of-rights area within the "
      "GIS relative tolerance.", ["geometry", "land_record"])
def area_002(ev: Evaluation) -> Evaluation:
    b, tol = ev.ctx.bundle, ev.ctx.tolerances
    maps = [m for m in b.cadastral_maps if m.map_area and m.map_area.value_ha is not None]
    rec = primary_area_record(b)
    if not maps or rec is None:
        return ev.not_applicable("no cadastral map record with area, or no recorded area")
    for m in maps:
        d = rel_diff(m.map_area.value_ha, rec.area.value_ha)
        if d > tol.gis_area_rel:
            ev.add(f"{m.native_record_type} {m.map_ref} map area {fmt_ha(m.map_area.value_ha)} differs from "
                   f"{rec.native_record_type} area {fmt_ha(rec.area.value_ha)} by {d:.1%}.",
                   [obs(m, "map_area", m.map_area.model_dump()), obs(rec, "area", rec.area.model_dump())],
                   expectation=f"relative difference <= {tol.gis_area_rel:.0%}",
                   severity="high" if d > tol.gis_area_rel_high else "medium",
                   metrics={"map_area_ha": m.map_area.value_ha, "record_area_ha": rec.area.value_ha,
                            "relative_difference": round(d, 4), "tolerance": tol.gis_area_rel})
    return ev.done("cadastral map area matches recorded area")


@rule("GIS-001", "gis_area_vs_record_area", "gis", "inconsistency", "medium",
      "Area computed from the cadastral polygon must match the recorded area (record of rights, else "
      "Property Card, else registry) within the GIS relative tolerance.", ["geometry", "land_record"])
def gis_001(ev: Evaluation) -> Evaluation:
    b, tol = ev.ctx.bundle, ev.ctx.tolerances
    geoms = [g for g in b.geometry if g.computed_area and g.computed_area.value_ha]
    rec = primary_area_record(b)
    if rec is not None:
        rec_val, rec_obs, rec_name = rec.area.value_ha, obs(rec, "area", rec.area.model_dump()), rec.native_record_type
    elif b.identity.land_record_area and b.identity.land_record_area.value_ha:
        rec_val = b.identity.land_record_area.value_ha
        rec_obs = obs_identity(b.identity, "land_record_area_hectare", rec_val)
        rec_name = "Parcel registry"
    else:
        return ev.not_applicable("no recorded area to compare")
    if not geoms:
        return ev.not_applicable("no cadastral polygon")
    for g in geoms:
        d = rel_diff(g.computed_area.value_ha, rec_val)
        if d > tol.gis_area_rel:
            ev.add(f"Polygon area {fmt_ha(g.computed_area.value_ha)} (computed from {g.vertex_count}-vertex "
                   f"cadastral polygon) differs from {rec_name} area {fmt_ha(rec_val)} by {d:.1%}.",
                   [obs(g, "computed_area", g.computed_area.model_dump()), rec_obs],
                   expectation=f"relative difference <= {tol.gis_area_rel:.0%}",
                   severity="high" if d > tol.gis_area_rel_high else "medium",
                   metrics={"gis_area_ha": g.computed_area.value_ha, "record_area_ha": rec_val,
                            "relative_difference": round(d, 4), "tolerance": tol.gis_area_rel,
                            "method": g.computed_area.method})
    return ev.done("polygon area within tolerance of recorded area")


@rule("GIS-002", "declared_vs_computed_gis_area", "gis", "data_quality", "low",
      "The registry's declared GIS area must match the area computed from the polygon.", ["parcel", "geometry"])
def gis_002(ev: Evaluation) -> Evaluation:
    b, tol = ev.ctx.bundle, ev.ctx.tolerances
    declared = b.identity.declared_gis_area
    geoms = [g for g in b.geometry if g.computed_area and g.computed_area.value_ha]
    if not declared or declared.value_ha is None or not geoms:
        return ev.not_applicable("no declared GIS area or no polygon")
    for g in geoms:
        d = rel_diff(g.computed_area.value_ha, declared.value_ha)
        if d > tol.declared_vs_computed_rel:
            ev.add(f"Registry declares GIS area {fmt_ha(declared.value_ha)} but the polygon computes to "
                   f"{fmt_ha(g.computed_area.value_ha)} ({d:.1%}).",
                   [obs_identity(b.identity, "geometry_area_hectare", declared.value_ha),
                    obs(g, "computed_area", g.computed_area.model_dump())],
                   expectation=f"relative difference <= {tol.declared_vs_computed_rel:.0%}",
                   metrics={"relative_difference": round(d, 4)})
    return ev.done("declared GIS area consistent with polygon")


@rule("GIS-003", "registry_geometry_vs_spatial_layer", "gis", "inconsistency", "medium",
      "The geometry held on the registry row must be identical to the ULPIN's feature in the spatial layer.",
      ["parcel", "geometry"])
def gis_003(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    reg = b.identity.registry_geometry
    if not reg or not b.geometry:
        return ev.not_applicable("registry or spatial layer geometry missing")
    for g in b.geometry:
        if not geometries_equal(reg, g.geometry):
            ev.add("Registry geometry differs from the spatial-layer polygon for this ULPIN.",
                   [obs_identity(b.identity, "geometry", "registry polygon"), obs(g, "geometry", "spatial polygon")],
                   expectation="coordinates identical (tolerance 1e-9 degrees)")
    return ev.done("registry and spatial-layer geometry identical")


@rule("GIS-004", "geometry_validity", "gis", "data_quality", "medium",
      "Polygon must be a closed, non-self-intersecting ring; the registry centroid must lie inside it and "
      "the declared boundary-vertex count must match.", ["geometry", "parcel"])
def gis_004(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    if not b.geometry:
        return ev.not_applicable("no cadastral polygon")
    for g in b.geometry:
        ring = outer_ring(g.geometry)
        problems = [f"unsupported geometry type {g.geometry.get('type')}"] if ring is None else ring_problems(ring)
        c = b.identity.centroid
        if ring is not None and c and not point_in_ring((c.lon, c.lat), ring):
            problems.append(f"registry centroid ({c.lat}, {c.lon}) lies outside the polygon")
        bv = b.identity.boundary_vertices
        if bv is not None and g.vertex_count is not None and bv != g.vertex_count:
            problems.append(f"registry declares {bv} boundary vertices, polygon has {g.vertex_count}")
        if problems:
            ev.add("Geometry problems: " + "; ".join(problems) + ".", [obs(g, "geometry", g.geometry.get("type"))],
                   expectation="valid simple polygon consistent with registry metadata",
                   metrics={"problems": problems})
    return ev.done("polygon valid; centroid inside; vertex count matches")


@rule("GIS-005", "parcel_overlap", "gis", "inconsistency", "high",
      "Cadastral polygons of different ULPINs in the same state must not share interior area "
      "(shared boundaries are allowed).", ["geometry"])
def gis_005(ev: Evaluation) -> Evaluation:
    b, idx = ev.ctx.bundle, ev.ctx.index
    mine = outer_ring(b.geometry[0].geometry) if b.geometry else None
    if mine is None:
        return ev.not_applicable("no cadastral polygon")
    others = {u: r for u, r in idx.rings.items() if u != b.identity.ulpin}
    for u, ring in sorted(others.items()):
        if rings_overlap(mine, ring):
            ev.add(f"Polygon overlaps the polygon of ULPIN {u}.", [obs(b.geometry[0], "geometry", "polygon")],
                   expectation="no interior overlap with other parcels", metrics={"overlapping_ulpin": u})
    return ev.done(f"no overlap with {len(others)} other parcel polygon(s) in the state")


@rule("GIS-006", "geometry_linked", "gis", "missing_link", "high",
      "Every ULPIN must link to a cadastral polygon in the spatial layer.", ["parcel", "geometry"])
def gis_006(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    if not b.geometry:
        ev.add("No cadastral polygon is linked to this ULPIN in the spatial layer.",
               [obs_identity(b.identity, "geometry_ref", b.identity.geometry_ref)],
               expectation="one spatial-layer feature per ULPIN")
    return ev.done(f"{len(b.geometry)} polygon(s) linked")


# ---------------------------------------------------------------------------------------
# identifiers & jurisdiction
# ---------------------------------------------------------------------------------------
def _primary_records(b: ParcelBundle) -> list[CanonicalRecord]:
    seen, out = set(), []
    for r in (*b.land_records, *b.registrations, *b.mutations, *b.cadastral_maps):
        if r.record_id not in seen:
            seen.add(r.record_id)
            out.append(r)
    return out


def _same_identifier(a, b) -> bool:
    if norm_code(a.value) != norm_code(b.value):
        return False
    return a.part is None or b.part is None or norm_code(a.part) == norm_code(b.part)


@rule("ID-001", "parcel_identifier_consistency", "identity", "inconsistency", "high",
      "Every source record that states a parcel number in the registry's native scheme (gat/khasra/"
      "survey/CTS) must state the registry's number and part. Different schemes are never compared.",
      ["parcel", "land_record", "mutation", "geometry"])
def id_001(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    primary = b.identity.primary_identifier
    compared = 0
    for r in _primary_records(b):
        same_scheme = [i for i in r.parcel_identifiers if i.scheme == primary.scheme]
        if not same_scheme:
            continue
        compared += 1
        if not any(_same_identifier(i, primary) for i in same_scheme):
            stated = ", ".join(f"{i.value}" + (f"/{i.part}" if i.part else "") for i in same_scheme)
            ev.add(f"{r.native_record_type} states {primary.scheme} {stated}; registry has "
                   f"{primary.value}" + (f"/{primary.part}" if primary.part else "") + ".",
                   [obs(r, "parcel_identifiers", [i.model_dump() for i in same_scheme]),
                    obs_identity(b.identity, "primary_identifier", primary.model_dump())],
                   expectation="same number (and part, where both state one)")
    if compared == 0:
        return ev.not_applicable(f"no source record states a {primary.scheme}")
    return ev.done(f"{compared} record(s) agree on {primary.scheme} {primary.value}")


@rule("ID-002", "account_number_consistency", "identity", "inconsistency", "medium",
      "Holding/account numbers (Khata No., Record of Rights No.) stated by source records must match the "
      "registry.", ["parcel", "land_record", "mutation"])
def id_002(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    reg = {a.scheme: a for a in b.identity.account_identifiers}
    if not reg:
        return ev.not_applicable("registry states no account number")
    compared = 0
    for r in _primary_records(b):
        for a in r.account_identifiers:
            if a.scheme not in reg:
                continue
            compared += 1
            if norm_code(a.value) != norm_code(reg[a.scheme].value):
                ev.add(f"{r.native_record_type} states {a.scheme} {a.value}; registry has {reg[a.scheme].value}.",
                       [obs(r, "account_identifiers", a.model_dump()),
                        obs_identity(b.identity, "account_identifiers", reg[a.scheme].model_dump())],
                       expectation="same account number")
    if compared == 0:
        return ev.not_applicable("no source record states an account number")
    return ev.done(f"{compared} account number statement(s) agree")


@rule("ID-003", "jurisdiction_consistency", "identity", "inconsistency", "medium",
      "District, sub-district (taluka/tehsil) and village stated by source records must match the registry.",
      ["parcel", "land_record", "registration", "geometry"])
def id_003(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    j0 = b.identity.jurisdiction
    compared = 0
    for r in _primary_records(b):
        j = r.jurisdiction
        if j is None:
            continue
        for level in ("district", "sub_district", "village"):
            mine, ref = getattr(j, level), getattr(j0, level)
            if mine is None or ref is None:
                continue
            compared += 1
            if norm_term(mine) != norm_term(ref):
                ev.add(f"{r.native_record_type} states {level} '{mine}'; registry has '{ref}'.",
                       [obs(r, f"jurisdiction.{level}", mine), obs_identity(b.identity, f"jurisdiction.{level}", ref)],
                       expectation="same jurisdiction name (normalized)")
    if compared == 0:
        return ev.not_applicable("no source record states jurisdiction")
    return ev.done(f"{compared} jurisdiction statement(s) agree")


# ---------------------------------------------------------------------------------------
# encumbrance & litigation
# ---------------------------------------------------------------------------------------
def _enc_source_available(b: ParcelBundle) -> bool:
    """True if the state has an encumbrance register (the source that also carries litigation)."""
    return any({"encumbrance", "litigation"} <= set(s.concepts) for s in b.sources)


@rule("ENC-001", "active_encumbrance", "encumbrance", "risk_flag", "high",
      "An encumbrance (charge/mortgage) is active on the parcel.", ["encumbrance"])
def enc_001(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    if not _enc_source_available(b):
        return ev.not_applicable("state provides no encumbrance source")
    for e in b.encumbrances:
        if e.status == "active":
            ev.add(f"Active {display(e.type_label)} {e.reference_no} in favour of {display(e.holder)}.",
                   [obs(e, "status", e.native.get("status")), obs(e, "encumbrance_type", e.type_label.model_dump() if e.type_label else None)],
                   expectation="no subsisting encumbrance", metrics={"reference_no": e.reference_no})
    return ev.done(f"{len(b.encumbrances)} encumbrance record(s), none active")


@rule("LIT-001", "litigation_flagged", "litigation", "risk_flag", "high",
      "A litigation flag / court case reference is recorded against the parcel.", ["litigation", "encumbrance"])
def lit_001(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    if not _enc_source_available(b):
        return ev.not_applicable("state provides no litigation-bearing source")
    for lit in b.litigation:
        ev.add(f"Litigation flagged: case {lit.case_reference} (on encumbrance {lit.related_reference_no}).",
               [obs(lit, "court_case_reference", lit.case_reference), obs(lit, "litigation_flag", True)],
               expectation="no pending litigation", metrics={"case_reference": lit.case_reference})
    return ev.done("no litigation flagged")


@rule("ENC-002", "charge_release_vs_active_encumbrance", "encumbrance", "inconsistency", "high",
      "A finalized charge-release mutation contradicts an encumbrance register that still shows an active "
      "charge/mortgage.", ["mutation", "encumbrance"])
def enc_002(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    releases = [m for m in b.mutations if m.kind == "charge_release" and m.status == "finalized"]
    if not releases:
        return ev.not_applicable("no finalized charge-release mutation")
    active = [e for e in b.encumbrances if e.status == "active"]
    for m in releases:
        for e in active:
            ev.add(f"{m.register_name} {m.mutation_no} ({display(m.kind_label)}) is finalized, but "
                   f"{display(e.type_label)} {e.reference_no} is still active in the encumbrance register.",
                   [obs(m, "kind/status", {"kind": m.kind, "status": m.status}), obs(e, "status", e.native.get("status"))],
                   expectation="no active encumbrance after a finalized charge release")
    return ev.done("charge release consistent with encumbrance register")


@rule("ENC-003", "encumbrance_not_reflected_on_record", "encumbrance", "inconsistency", "medium",
      "An active encumbrance should be annotated on the record of rights where the record has a field for "
      "it (Gujarat VF 7/12 other-rights note).", ["encumbrance", "land_record"])
def enc_003(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    active = [e for e in b.encumbrances if e.status == "active"]
    rors = [lr for lr in b.land_records if lr.encumbrance_noted is not None]
    if not active or not rors:
        return ev.not_applicable("no active encumbrance or no record field for annotating it")
    for lr in rors:
        if lr.encumbrance_noted is False:
            ev.add(f"Active encumbrance {', '.join(e.reference_no or '?' for e in active)} is not annotated on "
                   f"{lr.native_record_type} (other-rights note is empty).",
                   [obs(lr, "encumbrance_noted", lr.native.get("other_rights_note"))] +
                   [obs(e, "status", e.native.get("status")) for e in active],
                   expectation="active encumbrance annotated on the record of rights")
    return ev.done("active encumbrance annotated on the record")


@rule("ENC-004", "charge_mutation_without_encumbrance_record", "encumbrance", "missing_link", "low",
      "A charge-creation/release mutation exists but the encumbrance register has no record for the parcel.",
      ["mutation", "encumbrance"])
def enc_004(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    charges = [m for m in b.mutations if m.kind in ("charge_creation", "charge_release")]
    if not charges or not _enc_source_available(b):
        return ev.not_applicable("no charge mutation, or no encumbrance source")
    if not b.encumbrances:
        for m in charges:
            ev.add(f"{m.register_name} {m.mutation_no} ({display(m.kind_label)}, {display(m.status_label)}) has no "
                   f"corresponding entry in the encumbrance register.",
                   [obs(m, "kind", m.kind_label.model_dump() if m.kind_label else m.kind)],
                   expectation="encumbrance register entry for charged parcel")
    return ev.done("charge mutations have encumbrance register entries")


# ---------------------------------------------------------------------------------------
# land use, planning, building, environment
# ---------------------------------------------------------------------------------------
@rule("PLN-001", "building_use_vs_zoning", "planning", "inconsistency", "medium",
      "An approved building use must be permitted by the planning zone (glossary matrix zone_use_building_use).",
      ["building_permission", "planning"])
def pln_001(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    matrix, _ = ev.ctx.glossary.compat("zone_use_building_use")
    bps = [p for p in b.building_permissions if p.status == "approved" and p.building_use]
    plans = [p for p in b.planning if p.permitted_use in matrix]
    if not bps or not plans:
        return ev.not_applicable("no approved building permission or no zoning record")
    for bp in bps:
        for pl in plans:
            if bp.building_use not in matrix[pl.permitted_use]:
                ev.add(f"{bp.native_record_type} {bp.permission_no} approves {bp.building_use} use, but "
                       f"{pl.plan_name} zone {pl.zone_code} permits {pl.permitted_use}.",
                       [obs(bp, "building_use", bp.native.get("building_use")),
                        obs(pl, "permitted_use", pl.native.get("permitted_use"))],
                       expectation=f"building use in {matrix[pl.permitted_use]}")
    return ev.done("approved building use permitted by zoning")


@rule("PLN-002", "land_record_use_vs_zoning", "planning", "inconsistency", "low",
      "Land use on the record of rights differs from the zone's permitted use (e.g. conversion not yet "
      "recorded).", ["land_use", "planning"])
def pln_002(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    lr = primary_use_record(b)
    plans = [p for p in b.planning if p.permitted_use]
    if lr is None or not plans:
        return ev.not_applicable("no recorded land use or no zoning record")
    for pl in plans:
        if pl.permitted_use != lr.land_use:
            ev.add(f"{lr.native_record_type} records {display(lr.land_use_label)} ({lr.land_use}); "
                   f"{pl.plan_name} zone {pl.zone_code} permits {pl.permitted_use}.",
                   [obs(lr, "land_use", lr.land_use_label.model_dump() if lr.land_use_label else lr.land_use),
                    obs(pl, "permitted_use", pl.native.get("permitted_use"))],
                   expectation="recorded land use equals zone permitted use")
    return ev.done("recorded land use matches zoning")


@rule("PLN-003", "building_use_vs_record_land_use", "planning", "inconsistency", "low",
      "An approved building use differs from the land use on the record of rights; medium when the record "
      "still shows agricultural land.", ["building_permission", "land_use"])
def pln_003(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    lr = primary_use_record(b)
    bps = [p for p in b.building_permissions if p.status == "approved" and p.building_use]
    if lr is None or not bps:
        return ev.not_applicable("no recorded land use or no approved building permission")
    for bp in bps:
        if bp.building_use != lr.land_use:
            ev.add(f"{bp.native_record_type} {bp.permission_no} approves {bp.building_use} construction on land "
                   f"recorded as {display(lr.land_use_label)} in {lr.native_record_type}.",
                   [obs(bp, "building_use", bp.native.get("building_use")),
                    obs(lr, "land_use", lr.land_use_label.model_dump() if lr.land_use_label else lr.land_use)],
                   expectation="building use equals recorded land use",
                   severity="medium" if lr.land_use == "agricultural" else "low")
    return ev.done("building use matches recorded land use")


_RESTRICTION_SEVERITY = {"road_reservation": "medium", "coastal_review": "low", "environmental_review": "low",
                         "building_control": "info"}


@rule("PLN-004", "planning_restriction_present", "planning", "risk_flag", "low",
      "The planning record notes a restriction (road reservation, coastal/environmental review, building control).",
      ["planning"])
def pln_004(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    if not b.planning:
        return ev.not_applicable("no zoning record")
    for pl in b.planning:
        if pl.restriction and pl.restriction != "none":
            ev.add(f"{pl.plan_name}: restriction '{pl.native.get('restriction_status')}' ({pl.restriction}) on zone "
                   f"{pl.zone_code}.", [obs(pl, "restriction_status", pl.native.get("restriction_status"))],
                   expectation="no planning restriction", severity=_RESTRICTION_SEVERITY.get(pl.restriction, "low"))
    return ev.done("no planning restriction")


@rule("ENV-001", "environmental_restriction_present", "environment", "risk_flag", "medium",
      "An environmental control applies (active: medium; under review: low).", ["environmental_restriction"])
def env_001(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    if not b.environmental_restrictions:
        return ev.not_applicable("no environmental record for this parcel")
    for e in b.environmental_restrictions:
        if e.is_restrictive:
            ev.add(f"{e.restriction_label} ({e.zone_name}) — status '{e.native.get('status')}'"
                   + (f", authority {e.authority}" if e.authority else "") + ".",
                   [obs(e, "restriction_type", e.restriction_label), obs(e, "status", e.native.get("status"))],
                   expectation="no environmental restriction",
                   severity="medium" if e.status == "active" else "low")
    return ev.done("environmental record present and clear")


@rule("ENV-002", "building_approval_under_environmental_restriction", "environment", "inconsistency", "medium",
      "A building permission is approved while an environmental restriction on the parcel is active or under "
      "review.", ["building_permission", "environmental_restriction"])
def env_002(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    bps = [p for p in b.building_permissions if p.status == "approved"]
    envs = [e for e in b.environmental_restrictions if e.is_restrictive]
    if not bps or not envs:
        return ev.not_applicable("no approved building permission or no environmental restriction")
    for bp in bps:
        for e in envs:
            ev.add(f"{bp.native_record_type} {bp.permission_no} approved on {bp.approval_date} while "
                   f"'{e.restriction_label}' is {e.status}.",
                   [obs(bp, "status", bp.native.get("status")), obs(e, "status", e.native.get("status"))],
                   expectation="environmental restriction resolved before building approval")
    return ev.done("no conflict")


# ---------------------------------------------------------------------------------------
# tax & valuation
# ---------------------------------------------------------------------------------------
@rule("TAX-001", "property_tax_arrears", "tax", "risk_flag", "low",
      "Property tax outstanding for the assessment year.", ["property_tax"])
def tax_001(ev: Evaluation) -> Evaluation:
    b, tol = ev.ctx.bundle, ev.ctx.tolerances
    if not b.property_tax:
        return ev.not_applicable("no property tax record")
    for t in b.property_tax:
        if (t.outstanding_inr or 0) > tol.money_abs:
            ev.add(f"{t.account_id} ({t.assessment_year}): INR {t.outstanding_inr:,.2f} outstanding of "
                   f"INR {t.demand_inr:,.2f} demanded.",
                   [obs(t, "outstanding_amount", t.outstanding_inr), obs(t, "status", t.native.get("status"))],
                   expectation="no outstanding tax", metrics={"outstanding_inr": t.outstanding_inr})
    return ev.done("no tax outstanding")


@rule("TAX-002", "property_tax_arithmetic", "tax", "data_quality", "medium",
      "Demand - paid must equal outstanding, and the status must agree with the amounts.", ["property_tax"])
def tax_002(ev: Evaluation) -> Evaluation:
    b, tol = ev.ctx.bundle, ev.ctx.tolerances
    rows = [t for t in b.property_tax if None not in (t.demand_inr, t.paid_inr, t.outstanding_inr)]
    if not rows:
        return ev.not_applicable("no property tax record with amounts")
    for t in rows:
        problems = []
        gap = t.demand_inr - t.paid_inr - t.outstanding_inr
        if abs(gap) > tol.money_abs:
            problems.append(f"demand - paid - outstanding = {gap:,.2f}")
        if t.status == "paid" and t.outstanding_inr > tol.money_abs:
            problems.append("status 'paid' with an outstanding balance")
        if t.status == "partially_paid" and (t.outstanding_inr <= tol.money_abs or t.paid_inr <= tol.money_abs):
            problems.append("status 'partially_paid' inconsistent with amounts")
        if problems:
            ev.add(f"{t.account_id}: " + "; ".join(problems) + ".",
                   [obs(t, "amounts", {"demand": t.demand_inr, "paid": t.paid_inr, "outstanding": t.outstanding_inr,
                                       "status": t.native.get("status")})],
                   expectation="consistent tax amounts and status")
    return ev.done("tax amounts and status consistent")


@rule("VAL-001", "consideration_vs_assessed_value", "valuation", "inconsistency", "medium",
      "Consideration on the latest registered transfer compared with the property-tax assessed value; a "
      "ratio outside the configured band indicates a mis-keyed amount or valuation anomaly.",
      ["registration", "property_tax"])
def val_001(ev: Evaluation) -> Evaluation:
    b, tol = ev.ctx.bundle, ev.ctx.tolerances
    ts = [t for t in transfers(b) if t.consideration_inr]
    taxes = [t for t in b.property_tax if t.assessed_value_inr]
    if not ts or not taxes:
        return ev.not_applicable("no consideration value or no assessed value")
    t, tax = ts[-1], sorted(taxes, key=lambda x: x.assessment_year or "")[-1]
    ratio = t.consideration_inr / tax.assessed_value_inr
    if not (tol.consideration_ratio_low <= ratio <= tol.consideration_ratio_high):
        ev.add(f"{t.document_no} consideration INR {t.consideration_inr:,.0f} is {ratio:,.1f}x the "
               f"{tax.assessment_year} assessed value INR {tax.assessed_value_inr:,.0f} ({tax.account_id}).",
               [obs(t, "consideration_value", t.consideration_inr), obs(tax, "assessed_value", tax.assessed_value_inr)],
               expectation=f"ratio within [{tol.consideration_ratio_low}, {tol.consideration_ratio_high}]",
               metrics={"ratio": round(ratio, 3)})
    return ev.done(f"consideration/assessed ratio {ratio:.2f} within band")


# ---------------------------------------------------------------------------------------
# coverage & data quality
# ---------------------------------------------------------------------------------------
_NON_SOURCE = ("core", "spatial")


@rule("COV-001", "declared_source_coverage", "coverage", "data_quality", "info",
      "Source systems the registry row declares as available must match the systems that actually hold "
      "records for the ULPIN (Maharashtra registry declares available_source_systems).", ["parcel"])
def cov_001(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    declared = b.identity.declared_source_systems
    if declared is None:
        return ev.not_applicable("registry row does not declare source systems")
    actual = {s.source_table.split(".")[0] for s in b.sources
              if s.record_count > 0 and s.source_table.split(".")[0] not in _NON_SOURCE}
    missing, undeclared = sorted(set(declared) - actual), sorted(actual - set(declared))
    if missing or undeclared:
        parts = []
        if missing:
            parts.append(f"declared but no records: {', '.join(missing)}")
        if undeclared:
            parts.append(f"records present but not declared: {', '.join(undeclared)}")
        ev.add("Registry source catalogue disagrees with actual data — " + "; ".join(parts) + ".",
               [obs_identity(b.identity, "available_source_systems", declared)],
               expectation="declared source systems == systems holding records",
               metrics={"declared_without_records": missing, "undeclared_with_records": undeclared})
    return ev.done("declared source systems match actual records")


@rule("COV-002", "record_of_rights_present", "coverage", "missing_link", "high",
      "Each ULPIN must be backed by a record of rights (7/12, Khatauni, VF 7/12) or an urban Property Card.",
      ["land_record"])
def cov_002(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    rors = [lr for lr in b.land_records if lr.record_class in ("record_of_rights", "urban_property_record")]
    if not rors:
        ev.add("No record of rights or Property Card is linked to this ULPIN.",
               [obs_identity(b.identity, "ulpin", b.identity.ulpin)], expectation="at least one primary land record")
    return ev.done(", ".join(sorted({r.native_record_type for r in rors})) + " present")


@rule("DQ-001", "transliteration_script_consistency", "data_quality", "data_quality", "info",
      "English/transliterated fields (*_en values and registry jurisdiction names, romanized elsewhere in the "
      "dataset) must not contain non-Latin script.", ["parcel", "ownership", "land_record"])
def dq_001(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    hits: list[Observation] = []
    j = b.identity.jurisdiction
    for level in ("district", "sub_district", "village"):
        v = getattr(j, level)
        if has_non_latin_letters(v):
            hits.append(obs_identity(b.identity, f"jurisdiction.{level}", v))
    for r in _primary_records(b):
        for k, v in r.native.items():
            if k.endswith("_en") and has_non_latin_letters(v):
                hits.append(obs(r, k, v))
    if hits:
        ev.add("Non-Latin script in fields expected to be romanized: " +
               ", ".join(f"{o.field}='{o.value}'" for o in hits) + ".", hits,
               expectation="romanized (Latin-script) value")
    return ev.done("romanized fields contain Latin script only")


@rule("DQ-002", "glossary_term_resolution", "data_quality", "data_quality", "low",
      "Every native term value must resolve deterministically through the glossary (no unmapped or "
      "conflicting en/native values).", ["parcel"])
def dq_002(ev: Evaluation) -> Evaluation:
    b = ev.ctx.bundle
    bad = []
    for r in [*_primary_records(b), *b.encumbrances, *b.planning, *b.building_permissions, *b.property_tax,
              *b.utilities, *b.environmental_restrictions]:
        for m in r.term_mappings:
            if m.matched_on in ("unmapped", "conflict"):
                bad.append((r, m))
    for m in b.identity.term_mappings:
        if m.matched_on in ("unmapped", "conflict"):
            ev.add(f"Registry value '{m.native_value}' for {m.field} is {m.matched_on} in vocabulary {m.vocabulary}.",
                   [obs_identity(b.identity, m.field, m.native_value)], expectation="glossary resolution")
    for r, m in bad:
        ev.add(f"{r.native_record_type} value '{m.native_value}'/'{m.native_script_value}' for {m.field} is "
               f"{m.matched_on} in vocabulary {m.vocabulary}.",
               [obs(r, m.field, m.native_value)], expectation="glossary resolution")
    return ev.done("all native terms resolved")

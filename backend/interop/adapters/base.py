"""State adapter framework.

A state adapter knows one state's *actual* native tables, field names, terminology and
identifier schemes, and interprets them into the canonical model. It never writes to the
source and never invents values: a canonical field is populated only from a native field,
a glossary mapping, or a documented unit conversion; otherwise it is ``None``.

Shared, state-independent derivations (ownership claims, land-use statements, litigation,
cadastral geometry) live here so every state produces them the same way.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar, Iterable

from ..canonical.model import (
    Area,
    BuildingPermission,
    CadastralGeometry,
    CadastralMapRecord,
    Centroid,
    DatasetLabel,
    Encumbrance,
    EnvironmentalRestriction,
    Jurisdiction,
    LandRecord,
    LandUse,
    Litigation,
    LocalizedText,
    Mutation,
    OwnershipClaim,
    ParcelBundle,
    ParcelIdentifier,
    ParcelIdentity,
    PlanningRecord,
    PropertyTax,
    Provenance,
    Registration,
    SourceCoverage,
    TermMapping,
    UtilityService,
)
from ..geo import AREA_METHOD, outer_ring, polygon_area_ha
from ..glossary import Glossary
from ..normalize import to_float
from ..sources.base import SourceRow, SourceStore

REGISTRY_TABLE = "core.parcel_registry"
SPATIAL_TABLE = "spatial.cadastral_parcels"


@dataclass(frozen=True)
class SourceSpec:
    """Describes one native table of a state system."""

    table: str
    term_id: str  # glossary term naming the native record type
    native_record_type: str
    key_fields: tuple[str, ...]
    concepts: tuple[str, ...]


class RowContext:
    """Interprets one native row, recording every glossary mapping it relies on."""

    def __init__(self, adapter: "StateAdapter", spec: SourceSpec, row: SourceRow, *,
                 suffix: str = "", term_id: str | None = None, native_record_type: str | None = None):
        self.adapter = adapter
        self.spec = spec
        self.row = row
        self.d = row.data
        self.suffix = suffix
        self.term_id = term_id or spec.term_id
        self.native_record_type = native_record_type or spec.native_record_type
        self.mappings: list[TermMapping] = []

    # -- value interpretation -----------------------------------------------------------
    def get(self, field: str) -> Any:
        return self.d.get(field)

    def term(self, vocabulary: str, field: str, native_field: str | None = None) -> str | None:
        m = self.adapter.glossary.resolve(
            self.adapter.state_code, vocabulary, field, self.d.get(field),
            self.d.get(native_field) if native_field else None,
        )
        self.mappings.append(m)
        return m.canonical

    def text(self, en_field: str, native_field: str | None = None) -> LocalizedText | None:
        en = self.d.get(en_field)
        nat = self.d.get(native_field) if native_field else None
        if en is None and nat is None:
            return None
        return LocalizedText(en=en, native=nat, language=self.adapter.language if nat is not None else None)

    def area(self, value_field: str, unit_field: str | None = None, *, unit: str | None = None,
             basis: str = "textual_record") -> Area | None:
        value = to_float(self.d.get(value_field))
        raw_unit = self.d.get(unit_field) if unit_field else unit
        field = unit_field or f"{value_field} (unit implied by column name)"
        m = self.adapter.glossary.resolve(self.adapter.state_code, "area_unit", field, raw_unit)
        self.mappings.append(m)
        if value is None:
            return None
        factor = self.adapter.glossary.unit_factor(m.canonical)
        return Area(
            value_ha=round(value * factor, 6) if factor is not None else None,
            native_value=value, native_unit=raw_unit, basis=basis,
        )

    def ident(self, scheme: str | None, value: Any, part: Any = None) -> ParcelIdentifier | None:
        if scheme is None or value is None:
            return None
        m = self.adapter.glossary.resolve(self.adapter.state_code, "parcel_identifier_scheme", "identifier_scheme", scheme)
        self.mappings.append(m)
        return ParcelIdentifier(scheme=scheme, scheme_class=m.canonical, value=str(value),
                                part=None if part is None else str(part))

    def jurisdiction(self, district: str | None, sub_district: str | None, village: str | None) -> Jurisdiction:
        return Jurisdiction(
            state_code=self.adapter.state_code,
            district=self.d.get(district) if district else None,
            sub_district=self.d.get(sub_district) if sub_district else None,
            sub_district_type=self.adapter.sub_district_type if sub_district else None,
            village=self.d.get(village) if village else None,
        )

    # -- record envelope ----------------------------------------------------------------
    def record_key(self) -> dict[str, Any]:
        return {k: self.d.get(k) for k in self.spec.key_fields}

    def record_id(self) -> str:
        key = self.record_key()
        if all(v is not None for v in key.values()):
            key_str = "|".join(str(v) for v in key.values())
        else:
            key_str = self.row.locator.rsplit("/", 1)[-1]
        return f"{self.adapter.state_code}:{self.spec.table}:{key_str}{self.suffix}"

    def provenance(self) -> Provenance:
        return self.adapter.provenance(self.spec, self.row, term_id=self.term_id,
                                       native_record_type=self.native_record_type)

    def envelope(self, **extra: Any) -> dict[str, Any]:
        """Common canonical fields. Call after all term()/area()/ident() calls."""
        return dict(
            record_id=self.record_id(),
            native_record_type=self.native_record_type,
            provenance=self.provenance(),
            term_mappings=list(self.mappings),
            native=self.d,
            **extra,
        )


class StateAdapter(ABC):
    state_code: ClassVar[str]
    state_name: ClassVar[str]
    language: ClassVar[str]
    sub_district_type: ClassVar[str]
    specs: ClassVar[tuple[SourceSpec, ...]]

    def __init__(self, store: SourceStore, glossary: Glossary):
        self.store = store
        self.glossary = glossary
        self._specs = {s.table: s for s in self.specs}

    # -- plumbing -----------------------------------------------------------------------
    def spec(self, table: str) -> SourceSpec:
        return self._specs[table]

    def provenance(self, spec: SourceSpec, row: SourceRow, *, term_id: str | None = None,
                   native_record_type: str | None = None) -> Provenance:
        term = self.glossary.term(term_id or spec.term_id)
        return Provenance(
            state_code=self.state_code,
            source_system=term.get("source_system", "unknown"),
            authority=term.get("authority"),
            source_table=spec.table,
            native_record_type=native_record_type or spec.native_record_type,
            glossary_term_id=term["id"],
            record_key={k: row.data.get(k) for k in spec.key_fields},
            locator=row.locator,
            snapshot=row.snapshot,
        )

    def rows(self, table: str, ulpin: str | None = None) -> list[SourceRow]:
        if table not in self.store.tables(self.state_code):
            return []
        return self.store.fetch(self.state_code, table, {"ulpin": ulpin} if ulpin else None)

    def contexts(self, table: str, ulpin: str) -> list[RowContext]:
        spec = self.spec(table)
        return [RowContext(self, spec, r) for r in self.rows(table, ulpin)]

    def native_tables(self) -> list[SourceSpec]:
        return [s for s in self.specs if s.table not in (REGISTRY_TABLE,)]

    # -- registry -----------------------------------------------------------------------
    def identities(self) -> list[ParcelIdentity]:
        spec = self.spec(REGISTRY_TABLE)
        return [self.identity_from_context(RowContext(self, spec, r)) for r in self.rows(REGISTRY_TABLE)]

    @abstractmethod
    def primary_identifier(self, ctx: RowContext) -> ParcelIdentifier: ...

    @abstractmethod
    def registry_accounts(self, ctx: RowContext) -> list[ParcelIdentifier]: ...

    def identity_from_context(self, ctx: RowContext) -> ParcelIdentity:
        d = ctx.d
        centroid = d.get("centroid")
        if isinstance(centroid, dict) and centroid.get("lat") is not None:
            c = Centroid(lat=centroid["lat"], lon=centroid["lon"])
        elif d.get("centroid_lat") is not None:  # relational column shape
            c = Centroid(lat=d["centroid_lat"], lon=d["centroid_lon"])
        else:
            c = None
        primary = self.primary_identifier(ctx)
        accounts = self.registry_accounts(ctx)
        land_area = ctx.area("land_record_area_hectare", unit="hectare", basis="registry_declared")
        gis_area = ctx.area("geometry_area_hectare", unit="hectare", basis="registry_declared")
        return ParcelIdentity(
            ulpin=str(d["ulpin"]),
            state_code=self.state_code,
            state_name=self.state_name,
            jurisdiction=ctx.jurisdiction("district", self.sub_district_type, "village"),
            primary_identifier=primary,
            account_identifiers=accounts,
            context=d.get("context"),
            land_record_area=land_area,
            declared_gis_area=gis_area,
            centroid=c,
            registry_geometry=d.get("geometry") or d.get("geometry_geojson"),
            geometry_ref=d.get("geometry_ref"),
            boundary_vertices=d.get("boundary_vertices"),
            declared_source_systems=d.get("available_source_systems"),
            dataset_label=DatasetLabel(prototype_ref=d.get("prototype_ref"), quality_class=d.get("quality_class"),
                                       issue=d.get("issue")),
            provenance=ctx.provenance(),
            term_mappings=list(ctx.mappings),
            native=d,
        )

    # -- per-state builders -------------------------------------------------------------
    @abstractmethod
    def land_records(self, ulpin: str) -> list[LandRecord]: ...

    @abstractmethod
    def registrations(self, ulpin: str) -> list[Registration]: ...

    @abstractmethod
    def mutations(self, ulpin: str) -> list[Mutation]: ...

    @abstractmethod
    def encumbrances(self, ulpin: str) -> list[Encumbrance]: ...

    @abstractmethod
    def planning(self, ulpin: str) -> list[PlanningRecord]: ...

    @abstractmethod
    def building_permissions(self, ulpin: str) -> list[BuildingPermission]: ...

    @abstractmethod
    def property_tax(self, ulpin: str) -> list[PropertyTax]: ...

    @abstractmethod
    def utilities(self, ulpin: str) -> list[UtilityService]: ...

    @abstractmethod
    def environmental_restrictions(self, ulpin: str) -> list[EnvironmentalRestriction]: ...

    def cadastral_maps(self, ulpin: str) -> list[CadastralMapRecord]:
        return []

    # -- shared builders parameterised by each state's own field names --------------------
    def _encumbrance(self, ctx: RowContext, *, type_native: str, holder_native: str) -> Encumbrance:
        fields = dict(
            encumbrance_type=ctx.term("encumbrance_type", "encumbrance_type_en", type_native),
            type_label=ctx.text("encumbrance_type_en", type_native),
            reference_no=ctx.get("reference_no"),
            holder=ctx.text("holder_name_en", holder_native),
            status=ctx.term("encumbrance_status", "status"),
            litigation_flag=bool(ctx.get("litigation_flag")),
            court_case_reference=ctx.get("court_case_reference"),
        )
        return Encumbrance(**fields, **ctx.envelope())

    def _planning(self, ctx: RowContext, *, plan_field: str, zone_native: str) -> PlanningRecord:
        fields = dict(
            planning_authority=ctx.get("planning_authority"),
            plan_name=ctx.get(plan_field),
            zone_code=ctx.get("zone_code"),
            zone_name=ctx.text("zone_name_en", zone_native),
            zone_class=ctx.term("zone_class", "zone_name_en", zone_native),
            permitted_use=ctx.term("land_use", "permitted_use"),
            restriction=ctx.term("planning_restriction", "restriction_status"),
        )
        return PlanningRecord(**fields, **ctx.envelope())

    def _environment(self, ctx: RowContext, *, authority_field: str | None) -> EnvironmentalRestriction:
        rtype = ctx.term("environmental_restriction_type", "restriction_type")
        status = ctx.term("environmental_status", "status")
        fields = dict(
            restriction_type=rtype,
            restriction_label=ctx.get("restriction_type"),
            zone_name=ctx.get("zone_name"),
            authority=ctx.get(authority_field) if authority_field else None,
            status=status,
            is_restrictive=(rtype not in (None, "none")) and status != "clear",
        )
        return EnvironmentalRestriction(**fields, **ctx.envelope())

    def _ulb_tax(self, ctx: RowContext) -> PropertyTax:
        fields = dict(
            account_id=str(ctx.get("property_tax_id")),
            local_body=ctx.get("local_body"),
            assessment_year=ctx.get("assessment_year"),
            assessed_value_inr=to_float(ctx.get("assessed_value")),
            demand_inr=to_float(ctx.get("tax_demand")),
            paid_inr=to_float(ctx.get("amount_paid")),
            outstanding_inr=to_float(ctx.get("outstanding_amount")),
            status=ctx.term("tax_status", "status"),
        )
        return PropertyTax(**fields, **ctx.envelope())

    # -- generic derivations ------------------------------------------------------------
    @staticmethod
    def derive_ownership(land: Iterable[LandRecord], regs: Iterable[Registration]) -> list[OwnershipClaim]:
        claims: list[OwnershipClaim] = []
        for lr in land:
            for i, holder in enumerate(lr.holders):
                claims.append(OwnershipClaim(
                    record_id=f"{lr.record_id}#holder{i}", native_record_type=lr.native_record_type,
                    provenance=lr.provenance, parcel_identifiers=lr.parcel_identifiers,
                    account_identifiers=lr.account_identifiers, native=lr.native,
                    party=holder, role="recorded_holder", basis_record_id=lr.record_id,
                ))
        for reg in regs:
            for role, parties in (("registered_transferee", reg.claimants), ("registered_transferor", reg.executants)):
                for i, party in enumerate(parties):
                    claims.append(OwnershipClaim(
                        record_id=f"{reg.record_id}#{role}{i}", native_record_type=reg.native_record_type,
                        provenance=reg.provenance, native=reg.native, party=party, role=role,
                        basis_record_id=reg.record_id, effective_date=reg.registration_date,
                    ))
        return claims

    @staticmethod
    def derive_land_use(land: Iterable[LandRecord]) -> list[LandUse]:
        return [
            LandUse(
                record_id=f"{lr.record_id}#land_use", native_record_type=lr.native_record_type,
                provenance=lr.provenance, native=lr.native,
                term_mappings=[m for m in lr.term_mappings if m.vocabulary == "land_use"],
                use=lr.land_use, label=lr.land_use_label, basis_record_id=lr.record_id,
            )
            for lr in land
            if lr.land_use is not None or lr.land_use_label is not None
        ]

    def derive_litigation(self, encs: Iterable[Encumbrance]) -> list[Litigation]:
        term_id = f"{self.state_code}.term.litigation_flag"
        out = []
        for e in encs:
            if not e.litigation_flag:
                continue
            prov = e.provenance.model_copy(update={"glossary_term_id": term_id})
            out.append(Litigation(
                record_id=f"{e.record_id}#litigation", native_record_type=f"{e.native_record_type} (litigation flag)",
                provenance=prov, native=e.native, case_reference=e.court_case_reference,
                related_record_id=e.record_id, related_reference_no=e.reference_no,
            ))
        return out

    def geometry(self, identity: ParcelIdentity) -> list[CadastralGeometry]:
        out = []
        for ctx in self.contexts(SPATIAL_TABLE, identity.ulpin):
            geom = ctx.get("geometry") or {}
            ring = outer_ring(geom)
            area_ha = polygon_area_ha(geom)
            out.append(CadastralGeometry(
                geometry=geom,
                computed_area=None if area_ha is None else Area(
                    value_ha=round(area_ha, 6), basis="computed_geometry", method=AREA_METHOD),
                vertex_count=None if ring is None else len(ring) - 1,
                geometry_ref=identity.geometry_ref,
                parcel_identifiers=[identity.primary_identifier],
                **ctx.envelope(),
            ))
        return out

    # -- bundle -------------------------------------------------------------------------
    def coverage(self, ulpin: str) -> list[SourceCoverage]:
        out = []
        for spec in self.specs:
            if spec.table not in self.store.tables(self.state_code):
                continue
            term = self.glossary.term(spec.term_id)
            out.append(SourceCoverage(
                source_table=spec.table, source_system=term.get("source_system", "unknown"),
                native_record_type=spec.native_record_type, concepts=list(spec.concepts),
                record_count=len(self.rows(spec.table, ulpin)),
            ))
        return out

    def supported_concepts(self) -> set[str]:
        available = set(self.store.tables(self.state_code))
        return {c for s in self.specs if s.table in available for c in s.concepts}

    def build(self, identity: ParcelIdentity) -> ParcelBundle:
        u = identity.ulpin
        land = self.land_records(u)
        regs = self.registrations(u)
        encs = self.encumbrances(u)
        return ParcelBundle(
            identity=identity,
            land_records=land,
            ownership=self.derive_ownership(land, regs),
            registrations=regs,
            mutations=self.mutations(u),
            encumbrances=encs,
            litigation=self.derive_litigation(encs),
            land_use=self.derive_land_use(land),
            planning=self.planning(u),
            building_permissions=self.building_permissions(u),
            property_tax=self.property_tax(u),
            utilities=self.utilities(u),
            environmental_restrictions=self.environmental_restrictions(u),
            geometry=self.geometry(identity),
            cadastral_maps=self.cadastral_maps(u),
            sources=self.coverage(u),
        )

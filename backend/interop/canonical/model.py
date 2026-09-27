"""Canonical Land Model.

A *common meaning* layer over genuinely different state systems. Every canonical record:

* states which canonical ``concept`` it expresses;
* keeps the ``native_record_type`` in the state's own terminology (7/12, Khatauni, VF 6 ...);
* carries full :class:`Provenance` (state, source system, native table, record key, locator);
* lists the glossary :class:`TermMapping` s used to interpret native values; and
* embeds the untouched ``native`` row so no state-specific field is ever lost.

Canonical records are immutable (frozen) and are *derived* from sources; sources are never
written back.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Concept = Literal[
    "parcel",
    "ownership",
    "land_record",
    "registration",
    "mutation",
    "encumbrance",
    "litigation",
    "land_use",
    "planning",
    "building_permission",
    "property_tax",
    "utilities",
    "environmental_restriction",
    "geometry",
]
CONCEPTS: tuple[str, ...] = Concept.__args__  # type: ignore[attr-defined]


class Canonical(BaseModel):
    model_config = ConfigDict(frozen=True)


class Provenance(Canonical):
    state_code: str
    source_system: str
    authority: str | None = None
    source_table: str = Field(description="State-native relational table name, e.g. bhulekh.record_712")
    native_record_type: str = Field(description="Record type in state terminology, e.g. '7/12', 'Khatauni', 'VF 6'")
    glossary_term_id: str
    record_key: dict[str, Any] = Field(description="Natural key of the native row")
    locator: str = Field(description="Store-specific pointer to the exact native row")
    snapshot: str | None = Field(default=None, description="Fingerprint of the backing source version")


class TermMapping(Canonical):
    field: str
    vocabulary: str
    native_value: Any = None
    native_script_value: Any = None
    canonical: str | None = None
    entry_id: str | None = None
    matched_on: Literal["en", "native", "en+native", "unmapped", "conflict", "absent"]


class LocalizedText(Canonical):
    en: str | None = None
    native: str | None = None
    language: str | None = Field(default=None, description="ISO 639-1 code of the native text (mr, hi, gu)")


class ParcelIdentifier(Canonical):
    scheme: str = Field(description="Native scheme code, e.g. GAT_NO, GATA_KHASRA_NO, SURVEY_NO, CTS_NO")
    scheme_class: str | None = Field(default=None, description="Canonical class from the glossary")
    value: str
    part: str | None = Field(default=None, description="Survey part / sub-division")


class Jurisdiction(Canonical):
    state_code: str
    district: str | None = None
    sub_district: str | None = None
    sub_district_type: str | None = Field(default=None, description="taluka | tehsil")
    village: str | None = None


class Area(Canonical):
    value_ha: float | None
    native_value: float | None = None
    native_unit: str | None = None
    basis: Literal["textual_record", "cadastral_map", "computed_geometry", "registry_declared"]
    method: str | None = None


class DatasetLabel(Canonical):
    """Test-fixture labels shipped with the synthetic dataset (not state information)."""

    prototype_ref: str | None = None
    quality_class: str | None = None
    issue: str | None = None


class CanonicalRecord(Canonical):
    record_id: str
    concept: Concept
    native_record_type: str
    provenance: Provenance
    parcel_identifiers: list[ParcelIdentifier] = Field(default_factory=list)
    account_identifiers: list[ParcelIdentifier] = Field(default_factory=list)
    jurisdiction: Jurisdiction | None = None
    term_mappings: list[TermMapping] = Field(default_factory=list)
    native: dict[str, Any] = Field(description="Native row exactly as supplied by the state source")


# -- concept records ----------------------------------------------------------------------

class LandRecord(CanonicalRecord):
    concept: Literal["land_record"] = "land_record"
    record_class: Literal["record_of_rights", "holding_account", "plot_register", "urban_property_record"]
    holders: list[LocalizedText] = Field(default_factory=list)
    area: Area | None = None
    land_use: str | None = None
    land_use_label: LocalizedText | None = None
    record_status: str | None = None
    encumbrance_noted: bool | None = Field(
        default=None,
        description="Whether the record itself annotates a charge/liability. None where the state record has no such field.",
    )


class OwnershipClaim(CanonicalRecord):
    concept: Literal["ownership"] = "ownership"
    party: LocalizedText
    role: Literal["recorded_holder", "registered_transferee", "registered_transferor"]
    basis_record_id: str
    effective_date: date | None = None


class Registration(CanonicalRecord):
    concept: Literal["registration"] = "registration"
    document_no: str
    document_type: str | None
    document_type_label: LocalizedText | None = None
    transaction_type: str | None
    registration_date: date | None
    sub_registrar_office: str | None = None
    executants: list[LocalizedText] = Field(default_factory=list, description="Sellers/donors")
    claimants: list[LocalizedText] = Field(default_factory=list, description="Buyers/donees")
    consideration_inr: float | None = None
    stamp_duty_inr: float | None = None
    registration_fee_inr: float | None = None
    status: str | None = None


class Mutation(CanonicalRecord):
    concept: Literal["mutation"] = "mutation"
    mutation_no: str
    register_name: str = Field(description="State register name: Ferfar, Namantaran, VF 6")
    kind: str | None
    kind_label: LocalizedText | None = None
    basis: str | None = None
    application_no: str | None = None
    application_date: date | None = None
    status: str | None
    status_label: LocalizedText | None = None
    linked_document_no: str | None = None
    order_no: str | None = None


class Encumbrance(CanonicalRecord):
    concept: Literal["encumbrance"] = "encumbrance"
    encumbrance_type: str | None
    type_label: LocalizedText | None = None
    reference_no: str | None = None
    holder: LocalizedText | None = None
    status: str | None
    litigation_flag: bool = False
    court_case_reference: str | None = None


class Litigation(CanonicalRecord):
    concept: Literal["litigation"] = "litigation"
    case_reference: str | None
    status: Literal["flagged"] = "flagged"
    related_record_id: str
    related_reference_no: str | None = None


class LandUse(CanonicalRecord):
    concept: Literal["land_use"] = "land_use"
    use: str | None
    label: LocalizedText | None = None
    basis_record_id: str


class PlanningRecord(CanonicalRecord):
    concept: Literal["planning"] = "planning"
    planning_authority: str | None = None
    plan_name: str | None = None
    zone_code: str | None = None
    zone_name: LocalizedText | None = None
    zone_class: str | None = None
    permitted_use: str | None = None
    restriction: str | None = None


class BuildingPermission(CanonicalRecord):
    concept: Literal["building_permission"] = "building_permission"
    permission_no: str
    application_no: str | None = None
    authority: str | None = None
    department: str | None = None
    service: str | None = None
    building_use: str | None = None
    built_up_area_sqm: float | None = None
    approval_date: date | None = None
    status: str | None = None


class PropertyTax(CanonicalRecord):
    concept: Literal["property_tax"] = "property_tax"
    account_id: str
    local_body: str | None = None
    assessment_year: str | None = None
    assessed_value_inr: float | None = None
    demand_inr: float | None = None
    paid_inr: float | None = None
    outstanding_inr: float | None = None
    status: str | None = None


class UtilityService(CanonicalRecord):
    concept: Literal["utilities"] = "utilities"
    service: Literal["electricity", "water", "road_access"]
    provider: str | None = None
    distribution_company: str | None = None
    account_no: str | None = None
    status: str | None = None
    supply_category: str | None = None


class EnvironmentalRestriction(CanonicalRecord):
    concept: Literal["environmental_restriction"] = "environmental_restriction"
    restriction_type: str | None
    restriction_label: str | None = None
    zone_name: str | None = None
    authority: str | None = None
    status: str | None = None
    is_restrictive: bool


class Centroid(Canonical):
    lat: float
    lon: float


class CadastralGeometry(CanonicalRecord):
    concept: Literal["geometry"] = "geometry"
    geometry: dict[str, Any]
    computed_area: Area | None
    vertex_count: int | None = None
    geometry_ref: str | None = None


class CadastralMapRecord(CanonicalRecord):
    concept: Literal["geometry"] = "geometry"
    map_ref: str
    plot_no: str | None = None
    sub_division: str | None = None
    map_area: Area | None = None
    map_status: str | None = None
    layers: list[str] = Field(default_factory=list)


# -- parcel identity & bundle ---------------------------------------------------------------

class ParcelIdentity(Canonical):
    ulpin: str
    state_code: str
    state_name: str
    jurisdiction: Jurisdiction
    primary_identifier: ParcelIdentifier
    account_identifiers: list[ParcelIdentifier] = Field(default_factory=list)
    context: str | None = None
    land_record_area: Area | None = None
    declared_gis_area: Area | None = None
    centroid: Centroid | None = None
    registry_geometry: dict[str, Any] | None = None
    geometry_ref: str | None = None
    boundary_vertices: int | None = None
    declared_source_systems: list[str] | None = Field(
        default=None, description="Source systems the registry row declares as available (Maharashtra only)."
    )
    dataset_label: DatasetLabel
    provenance: Provenance
    term_mappings: list[TermMapping] = Field(default_factory=list)
    native: dict[str, Any]


class SourceCoverage(Canonical):
    source_table: str
    source_system: str
    native_record_type: str
    concepts: list[str]
    record_count: int


class ParcelBundle(Canonical):
    """Everything the federation knows about one ULPIN, in canonical form."""

    identity: ParcelIdentity
    land_records: list[LandRecord] = Field(default_factory=list)
    ownership: list[OwnershipClaim] = Field(default_factory=list)
    registrations: list[Registration] = Field(default_factory=list)
    mutations: list[Mutation] = Field(default_factory=list)
    encumbrances: list[Encumbrance] = Field(default_factory=list)
    litigation: list[Litigation] = Field(default_factory=list)
    land_use: list[LandUse] = Field(default_factory=list)
    planning: list[PlanningRecord] = Field(default_factory=list)
    building_permissions: list[BuildingPermission] = Field(default_factory=list)
    property_tax: list[PropertyTax] = Field(default_factory=list)
    utilities: list[UtilityService] = Field(default_factory=list)
    environmental_restrictions: list[EnvironmentalRestriction] = Field(default_factory=list)
    geometry: list[CadastralGeometry] = Field(default_factory=list)
    cadastral_maps: list[CadastralMapRecord] = Field(default_factory=list)
    sources: list[SourceCoverage] = Field(default_factory=list)

    def all_records(self) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for name in (
            "land_records", "ownership", "registrations", "mutations", "encumbrances", "litigation",
            "land_use", "planning", "building_permissions", "property_tax", "utilities",
            "environmental_restrictions", "geometry", "cadastral_maps",
        ):
            out.extend(getattr(self, name))
        return out

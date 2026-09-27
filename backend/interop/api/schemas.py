"""Common API contracts. Every parcel-concept response shares :class:`ConceptEnvelope`
(ULPIN, state, concept support, contributing sources, related findings) and then carries
canonical records that keep full state/source provenance."""
from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..canonical.model import (
    Area,
    BuildingPermission,
    CadastralGeometry,
    CadastralMapRecord,
    Encumbrance,
    EnvironmentalRestriction,
    LandRecord,
    LandUse,
    Litigation,
    LocalizedText,
    Mutation,
    OwnershipClaim,
    ParcelBundle,
    PlanningRecord,
    PropertyTax,
    Registration,
    SourceCoverage,
    UtilityService,
)
from ..config import API_VERSION
from ..registry import RegistryEntry, StateRef
from ..validation.model import Finding, VerificationReport


class ErrorBody(BaseModel):
    code: str
    message: str
    ulpin: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class ConceptEnvelope(BaseModel):
    api_version: str = API_VERSION
    ulpin: str
    state: StateRef
    concept: str
    supported: bool = Field(description="Whether this state's connected systems provide the concept at all")
    record_count: int
    sources: list[SourceCoverage] = Field(description="State source tables that contribute to this concept")
    related_findings: list[Finding] = Field(default_factory=list,
                                            description="Validation findings whose rule compares this concept")


class LandRecordsResponse(ConceptEnvelope):
    records: list[LandRecord]


class HolderSummary(BaseModel):
    party: LocalizedText
    stated_by: list[str] = Field(description="Native record types naming this holder")
    record_ids: list[str]


class TransfereeSummary(BaseModel):
    party: LocalizedText
    document_no: str
    registration_date: date | None


class OwnershipSummary(BaseModel):
    recorded_holders: list[HolderSummary]
    latest_registered_transferee: list[TransfereeSummary]
    status: Literal["consistent", "mismatch", "mismatch_pending_mutation", "undetermined"]
    basis: str


class OwnershipResponse(ConceptEnvelope):
    summary: OwnershipSummary
    records: list[OwnershipClaim]


class RegistrationResponse(ConceptEnvelope):
    records: list[Registration]


class MutationSummary(BaseModel):
    register_names: list[str]
    pending: int
    finalized: int


class MutationResponse(ConceptEnvelope):
    summary: MutationSummary
    records: list[Mutation]


class PlanningResponse(ConceptEnvelope):
    planning: list[PlanningRecord]
    land_use: list[LandUse]
    environmental_restrictions: list[EnvironmentalRestriction]


class BuildingResponse(ConceptEnvelope):
    records: list[BuildingPermission]


class EncumbranceSummary(BaseModel):
    active: int
    released: int
    litigation_flagged: int


class EncumbranceResponse(ConceptEnvelope):
    summary: EncumbranceSummary
    encumbrances: list[Encumbrance]
    litigation: list[Litigation]


class TaxSummary(BaseModel):
    outstanding_inr: float | None


class TaxResponse(ConceptEnvelope):
    summary: TaxSummary
    records: list[PropertyTax]


class UtilitiesResponse(ConceptEnvelope):
    records: list[UtilityService]


class AreaComparison(BaseModel):
    record_area: Area | None
    record_area_source: str | None
    computed_gis_area: Area | None
    declared_gis_area: Area | None
    cadastral_map_area: Area | None
    relative_difference: float | None
    tolerance: float
    within_tolerance: bool | None


class GisResponse(ConceptEnvelope):
    area_comparison: AreaComparison
    feature: dict[str, Any] | None = Field(description="GeoJSON Feature for map clients")
    geometry: list[CadastralGeometry]
    cadastral_maps: list[CadastralMapRecord]


class ConceptAvailability(BaseModel):
    supported: bool
    record_count: int


class VerificationHeadline(BaseModel):
    risk_level: str
    summary: dict[str, Any]


class ParcelSummaryResponse(BaseModel):
    api_version: str = API_VERSION
    registry: RegistryEntry
    context: str | None
    land_record_area: Area | None
    declared_gis_area: Area | None
    concepts: dict[str, ConceptAvailability]
    verification: VerificationHeadline
    dataset_label: dict[str, Any] = Field(description="Synthetic-dataset fixture labels (not state information)")
    links: dict[str, str]


class ProfileResponse(BaseModel):
    api_version: str = API_VERSION
    registry: RegistryEntry
    concepts: dict[str, ConceptAvailability]
    canonical: ParcelBundle
    verification: VerificationReport


class RegistryListItem(BaseModel):
    ulpin: str
    state: StateRef
    jurisdiction: dict[str, Any]
    primary_identifier: dict[str, Any]


class RegistryListResponse(BaseModel):
    api_version: str = API_VERSION
    count: int
    items: list[RegistryListItem]

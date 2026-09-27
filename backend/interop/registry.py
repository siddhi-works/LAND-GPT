"""ULPIN registry: ULPIN -> state -> jurisdiction -> native identifier -> source reference.

Built from each state's own ``core.parcel_registry`` through its adapter; the registry
does not copy state data into a shared table, it only indexes where each ULPIN lives.
"""
from __future__ import annotations

from .adapters.base import SPATIAL_TABLE, StateAdapter
from .canonical.model import Canonical, Jurisdiction, ParcelIdentifier, ParcelIdentity, Provenance, SourceCoverage
from .normalize import is_valid_ulpin, normalize_ulpin


class StateRef(Canonical):
    code: str
    name: str


class SpatialReference(Canonical):
    source_table: str
    locator: str
    geometry_ref: str | None = None


class RegistryEntry(Canonical):
    ulpin: str
    state: StateRef
    jurisdiction: Jurisdiction
    primary_identifier: ParcelIdentifier
    native_identifiers: list[ParcelIdentifier]
    source_reference: Provenance
    spatial_reference: SpatialReference | None
    linked_sources: list[SourceCoverage]


class UlpinError(LookupError):
    code = "ULPIN_ERROR"
    status = 400

    def __init__(self, ulpin: str, message: str):
        super().__init__(message)
        self.ulpin = ulpin
        self.message = message


class InvalidUlpin(UlpinError):
    code, status = "INVALID_ULPIN", 422


class UlpinNotFound(UlpinError):
    code, status = "ULPIN_NOT_FOUND", 404


class UlpinAmbiguous(UlpinError):
    code, status = "ULPIN_AMBIGUOUS", 409


class UlpinRegistry:
    def __init__(self, adapters: dict[str, StateAdapter]):
        self.adapters = adapters
        self._index: dict[str, list[tuple[StateAdapter, ParcelIdentity]]] = {}
        self.issues: list[dict] = []
        for code in sorted(adapters):
            adapter = adapters[code]
            for ident in adapter.identities():
                if not is_valid_ulpin(ident.ulpin):
                    self.issues.append({"issue": "invalid_ulpin_format", "state_code": code, "ulpin": ident.ulpin,
                                        "locator": ident.provenance.locator})
                self._index.setdefault(ident.ulpin, []).append((adapter, ident))
        for ulpin, hits in self._index.items():
            if len(hits) > 1:
                self.issues.append({"issue": "ulpin_collision", "ulpin": ulpin,
                                    "locators": [i.provenance.locator for _, i in hits]})

    def __len__(self) -> int:
        return len(self._index)

    def resolve(self, raw: str) -> tuple[StateAdapter, ParcelIdentity]:
        ulpin = normalize_ulpin(raw)
        if not is_valid_ulpin(ulpin):
            raise InvalidUlpin(raw, f"'{raw}' is not a 14-digit ULPIN")
        hits = self._index.get(ulpin)
        if not hits:
            raise UlpinNotFound(ulpin, f"ULPIN {ulpin} is not registered in any connected state system")
        if len(hits) > 1:
            raise UlpinAmbiguous(ulpin, f"ULPIN {ulpin} is registered in several states: "
                                        f"{', '.join(a.state_code for a, _ in hits)}")
        return hits[0]

    def identities(self, state_code: str | None = None) -> list[ParcelIdentity]:
        return [i for hits in self._index.values() for a, i in hits if state_code in (None, a.state_code)]

    def entry(self, raw: str) -> RegistryEntry:
        adapter, ident = self.resolve(raw)
        spatial = adapter.rows(SPATIAL_TABLE, ident.ulpin)
        return RegistryEntry(
            ulpin=ident.ulpin,
            state=StateRef(code=adapter.state_code, name=adapter.state_name),
            jurisdiction=ident.jurisdiction,
            primary_identifier=ident.primary_identifier,
            native_identifiers=[ident.primary_identifier, *ident.account_identifiers],
            source_reference=ident.provenance,
            spatial_reference=SpatialReference(source_table=SPATIAL_TABLE, locator=spatial[0].locator,
                                               geometry_ref=ident.geometry_ref) if spatial else None,
            linked_sources=adapter.coverage(ident.ulpin),
        )

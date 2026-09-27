"""Source-store contract: the only seam between state data and the interoperability core.

Adapters address native data by the *state's own relational table names* taken from each
state's PostgreSQL schema (e.g. ``bhulekh.record_712`` for Maharashtra,
``revenue_mutation.namantaran`` for Uttar Pradesh, ``e_dhara.vf6_mutation`` for Gujarat).

Today :class:`~interop.sources.json_store.JsonSourceStore` serves those tables from the
supplied JSON/GeoJSON files. A future ``PostgresSourceStore`` only has to implement
:class:`SourceStore` with ``SELECT * FROM <table> WHERE ulpin = %s`` against each state's
own database — adapters, canonical model, validation and API stay unchanged.

Stores are strictly read-only: they never write, and they hand out copies so no caller can
mutate the underlying source rows.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, runtime_checkable


@dataclass(frozen=True)
class SourceRow:
    """One native record exactly as held by the state system, plus where it came from."""

    state_code: str
    table: str
    data: dict[str, Any]
    locator: str  # store-specific pointer, e.g. "maharashtra/seed/land_records.json#/record_712/3"
    snapshot: str | None = None  # content fingerprint of the backing file / table version


@dataclass(frozen=True)
class SourceFileInfo:
    path: str
    sha256: str
    tables: tuple[str, ...]
    rows: int


@dataclass(frozen=True)
class StoreDescription:
    kind: str
    root: str
    states: tuple[str, ...]
    files: tuple[SourceFileInfo, ...] = field(default_factory=tuple)


class SourceStoreError(RuntimeError):
    pass


@runtime_checkable
class SourceStore(Protocol):
    def states(self) -> list[str]:
        """State codes served by this store (e.g. ["GJ", "MH", "UP"])."""

    def tables(self, state_code: str) -> list[str]:
        """Native table names available for a state."""

    def fetch(self, state_code: str, table: str, where: Mapping[str, Any] | None = None) -> list[SourceRow]:
        """Rows of a native table, optionally filtered by column equality. Returns copies."""

    def describe(self) -> StoreDescription:
        """Store metadata for health/provenance (kind, root, file fingerprints)."""

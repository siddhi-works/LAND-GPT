"""In-memory :class:`SourceStore` — used by tests to prove adapters depend only on the
store contract (the same contract a PostgreSQL store will implement)."""
from __future__ import annotations

import copy
from typing import Any, Mapping

from .base import SourceRow, SourceStoreError, StoreDescription


class InMemorySourceStore:
    kind = "in_memory"

    def __init__(self, tables: Mapping[str, Mapping[str, list[dict]]]):
        """``tables`` = {state_code: {table_name: [row, ...]}}"""
        self._tables = {s: {t: [dict(r) for r in rows] for t, rows in ts.items()} for s, ts in tables.items()}

    def states(self) -> list[str]:
        return sorted(self._tables)

    def tables(self, state_code: str) -> list[str]:
        return sorted(self._tables.get(state_code, {}))

    def fetch(self, state_code: str, table: str, where: Mapping[str, Any] | None = None) -> list[SourceRow]:
        try:
            rows = self._tables[state_code][table]
        except KeyError:
            raise SourceStoreError(f"unknown table {state_code}:{table}") from None
        where = dict(where or {})
        return [
            SourceRow(state_code, table, copy.deepcopy(r), f"memory://{state_code}/{table}/{i}")
            for i, r in enumerate(rows)
            if all(r.get(k) == v for k, v in where.items())
        ]

    def describe(self) -> StoreDescription:
        return StoreDescription(self.kind, "memory", tuple(self.states()))

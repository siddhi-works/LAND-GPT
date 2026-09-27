"""Read-only filesystem/JSON implementation of :class:`SourceStore`."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

from .base import SourceFileInfo, SourceRow, SourceStoreError, StoreDescription
from .json_layout import STATE_LAYOUTS, StateLayout


class JsonSourceStore:
    """Serves each state's native tables from the supplied dataset files.

    Files are opened read-only, parsed once, fingerprinted (SHA-256) and indexed by ULPIN.
    ``fetch`` returns deep copies so callers can never alter the loaded source rows.
    """

    kind = "json_filesystem"

    def __init__(self, data_root: Path, layouts: Mapping[str, StateLayout] | None = None):
        self.root = Path(data_root)
        self.layouts = dict(layouts or STATE_LAYOUTS)
        self._rows: dict[tuple[str, str], list[SourceRow]] = {}
        self._by_ulpin: dict[tuple[str, str], dict[str, list[SourceRow]]] = {}
        self._files: list[SourceFileInfo] = []
        self._load()

    # -- loading -----------------------------------------------------------------------
    def _load(self) -> None:
        if not self.root.is_dir():
            raise SourceStoreError(f"data root not found: {self.root}")
        for code, layout in sorted(self.layouts.items()):
            state_dir = self.root / layout.directory
            by_file: dict[str, list[str]] = {}
            for table, loc in layout.tables.items():
                by_file.setdefault(loc.file, []).append(table)
            for rel_file, tables in sorted(by_file.items()):
                path = state_dir / rel_file
                if not path.is_file():
                    raise SourceStoreError(f"{code}: missing source file {path}")
                raw = path.read_bytes()
                digest = hashlib.sha256(raw).hexdigest()
                doc = json.loads(raw.decode("utf-8"))
                total = 0
                for table in tables:
                    loc = layout.tables[table]
                    rows = self._extract(doc, loc.key, rel_file, table)
                    pointer_base = f"{layout.directory}/{rel_file}#/" + (f"{loc.key}/" if loc.key else "")
                    source_rows = []
                    for i, row in enumerate(rows):
                        data = {**row.get("properties", {}), "geometry": row.get("geometry")} if loc.geojson else row
                        source_rows.append(SourceRow(code, table, data, f"{pointer_base}{i}", digest[:16]))
                    self._rows[(code, table)] = source_rows
                    index: dict[str, list[SourceRow]] = {}
                    for r in source_rows:
                        u = r.data.get("ulpin")
                        if u is not None:
                            index.setdefault(str(u), []).append(r)
                    self._by_ulpin[(code, table)] = index
                    total += len(source_rows)
                self._files.append(
                    SourceFileInfo(f"{layout.directory}/{rel_file}", digest, tuple(sorted(tables)), total)
                )

    @staticmethod
    def _extract(doc: Any, key: str | None, rel_file: str, table: str) -> list[dict]:
        rows = doc.get(key) if (key and isinstance(doc, dict)) else doc
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
            raise SourceStoreError(f"{rel_file}: expected a list of records for table {table}")
        return rows

    # -- SourceStore protocol --------------------------------------------------------
    def states(self) -> list[str]:
        return sorted(self.layouts)

    def tables(self, state_code: str) -> list[str]:
        layout = self.layouts.get(state_code)
        return sorted(layout.tables) if layout else []

    def fetch(self, state_code: str, table: str, where: Mapping[str, Any] | None = None) -> list[SourceRow]:
        key = (state_code, table)
        if key not in self._rows:
            raise SourceStoreError(f"unknown table {state_code}:{table}")
        where = dict(where or {})
        if set(where) == {"ulpin"}:
            candidates = self._by_ulpin[key].get(str(where["ulpin"]), [])
        else:
            candidates = [r for r in self._rows[key] if all(r.data.get(k) == v for k, v in where.items())]
        return [SourceRow(r.state_code, r.table, copy.deepcopy(r.data), r.locator, r.snapshot) for r in candidates]

    def describe(self) -> StoreDescription:
        return StoreDescription(self.kind, str(self.root), tuple(self.states()), tuple(self._files))

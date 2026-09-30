"""Source-store layer: native table names, completeness, read-only behaviour, swappability."""
import json
import re
from pathlib import Path

import pytest

from interop.adapters import ADAPTERS
from interop.glossary import default_glossary
from interop.sources import InMemorySourceStore, SourceStoreError
from interop.sources.json_layout import STATE_LAYOUTS

from .conftest import P, clone_state


def _schema_tables(data_root: Path, directory: str) -> set[str]:
    sql = (data_root / directory / "schema" / f"{directory}_schema.sql").read_text(encoding="utf-8")
    return set(re.findall(r"CREATE TABLE ([\w\.]+)", sql))


def _seed_counts(data_root: Path, directory: str) -> dict[str, int]:
    sql = (data_root / directory / "seed" / f"{directory}_seed.sql").read_text(encoding="utf-8")
    counts: dict[str, int] = {}
    for t in re.findall(r"INSERT INTO ([\w\.]+)", sql):
        counts[t] = counts.get(t, 0) + 1
    return counts


@pytest.mark.parametrize("state", ["MH", "UP", "GJ"])
def test_adapters_address_the_states_own_sql_tables(store, settings, state):
    layout = STATE_LAYOUTS[state]
    schema_tables = _schema_tables(settings.data_root, layout.directory)
    served = set(store.tables(state)) - {"spatial.cadastral_parcels"}
    assert served == schema_tables, "JSON store must expose exactly the tables of the state's SQL schema"
    adapter_tables = {s.table for s in ADAPTERS[state].specs} - {"spatial.cadastral_parcels"}
    assert adapter_tables == schema_tables


@pytest.mark.parametrize("state", ["MH", "UP", "GJ"])
def test_row_counts_match_the_sql_seed(store, settings, state):
    counts = _seed_counts(settings.data_root, STATE_LAYOUTS[state].directory)
    for table, n in counts.items():
        assert len(store.fetch(state, table)) == n, table
    assert len(store.fetch(state, "spatial.cadastral_parcels")) == 100


def test_fetch_returns_copies(store):
    u = P[("MH", "P001")]
    row = store.fetch("MH", "bhulekh.record_712", {"ulpin": u})[0]
    row.data["khatedar_name_en"] = "TAMPERED"
    assert store.fetch("MH", "bhulekh.record_712", {"ulpin": u})[0].data["khatedar_name_en"] == "Sandeep Patil"


def test_locator_points_at_the_exact_source_row(store, settings):
    row = store.fetch("GJ", "e_dhara.vf6_mutation", {"ulpin": P[("GJ", "P013")]})[0]
    path, pointer = row.locator.split("#/")
    doc = json.loads((settings.data_root / path).read_text(encoding="utf-8"))
    for part in pointer.split("/"):
        doc = doc[int(part)] if isinstance(doc, list) else doc[part]
    assert doc == row.data
    assert row.snapshot and len(row.snapshot) == 16


def test_unknown_table_raises(store):
    with pytest.raises(SourceStoreError):
        store.fetch("UP", "property_card.record")  # UP has no Property Card system


def test_describe_fingerprints_every_file(store):
    desc = store.describe()
    assert desc.kind == "json_filesystem" and set(desc.states) == {"MH", "UP", "GJ"}
    assert all(len(f.sha256) == 64 for f in desc.files)


def test_adapter_runs_unchanged_on_another_store_implementation(store):
    """The adapter depends only on the SourceStore contract (what PostgreSQL will implement)."""
    mem = InMemorySourceStore({"UP": clone_state(store, "UP")})
    a_json = ADAPTERS["UP"](store, default_glossary())
    a_mem = ADAPTERS["UP"](mem, default_glossary())
    u = P[("UP", "P013")]
    ident_json = next(i for i in a_json.identities() if i.ulpin == u)
    ident_mem = next(i for i in a_mem.identities() if i.ulpin == u)
    b1, b2 = a_json.build(ident_json), a_mem.build(ident_mem)
    strip = lambda b: [r.model_dump(exclude={"provenance"}) for r in b.all_records()]  # noqa: E731
    assert strip(b1) == strip(b2)

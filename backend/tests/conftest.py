from __future__ import annotations

import copy
from datetime import date

import pytest
from fastapi.testclient import TestClient

from interop.api import create_app
from interop.config import Settings
from interop.service import LandStackService
from interop.sources import InMemorySourceStore, JsonSourceStore

AS_OF = date(2026, 9, 28)

# Representative parcels (ULPIN) from the supplied dataset, keyed by (state, prototype_ref).
P = {
    ("MH", "P001"): "58310472961538", ("MH", "P009"): "52876041392584", ("MH", "P010"): "10395762841075",
    ("MH", "P011"): "84621573902841", ("MH", "P012"): "27590468153720", ("MH", "P013"): "71934820561493",
    ("MH", "P014"): "45082719365028", ("MH", "P015"): "96253174082615",
    ("UP", "P001"): "58427193061584", ("UP", "P003"): "21684570319265", ("UP", "P011"): "84650723190428",
    ("UP", "P012"): "27541896372051", ("UP", "P013"): "71960432851792", ("UP", "P014"): "45039182764025",
    ("UP", "P015"): "96274310582614",
    ("GJ", "P001"): "63821470593146", ("GJ", "P009"): "53947216082571", ("GJ", "P010"): "10768425391052",
    ("GJ", "P011"): "86423051794816", ("GJ", "P012"): "27351480692137", ("GJ", "P013"): "71860543912796",
    ("GJ", "P014"): "45293178064528", ("GJ", "P015"): "97641820583714",
}


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(as_of=AS_OF)


@pytest.fixture(scope="session")
def store(settings) -> JsonSourceStore:
    return JsonSourceStore(settings.data_root)


@pytest.fixture(scope="session")
def service(store, settings) -> LandStackService:
    return LandStackService(store, settings=settings)


@pytest.fixture(scope="session")
def client(service):
    with TestClient(create_app(service)) as c:
        yield c


def clone_state(store: JsonSourceStore, state: str) -> dict[str, list[dict]]:
    """Copy one state's native tables into plain rows for an InMemorySourceStore."""
    return {t: [copy.deepcopy(r.data) for r in store.fetch(state, t)] for t in store.tables(state)}


@pytest.fixture
def memory_service_factory(store, settings):
    """Build a service over an in-memory copy of a state's data, optionally altered by `mutate`."""
    def make(state: str, mutate=None) -> LandStackService:
        tables = clone_state(store, state)
        if mutate:
            mutate(tables)
        return LandStackService(InMemorySourceStore({state: tables}), settings=settings)
    return make

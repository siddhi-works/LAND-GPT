"""ULPIN registry: ULPIN -> state -> jurisdiction -> native identifier -> source reference."""
import pytest

from interop.registry import InvalidUlpin, UlpinAmbiguous, UlpinNotFound

from .conftest import P


def test_registry_holds_all_45_unique_ulpins(service):
    assert len(service.registry) == 45
    assert service.registry.issues == []
    for code in ("MH", "UP", "GJ"):
        assert len(service.registry.identities(code)) == 15


@pytest.mark.parametrize("key,scheme,value,part,account,sub_type", [
    (("MH", "P001"), "GAT_NO", "142", "2", ("KHATA_NO", "38"), "taluka"),
    (("MH", "P009"), "CTS_NO", "1842", None, None, "taluka"),
    (("MH", "P015"), "KHASRA_NO", "118", "1", ("KHATA_NO", "35"), "taluka"),
    (("UP", "P013"), "GATA_KHASRA_NO", "17", "1", ("KHATA_NO", "01308"), "tehsil"),
    (("GJ", "P001"), "SURVEY_NO", "142", "2", ("ROR_NO", "00124"), "taluka"),
    (("GJ", "P009"), "SURVEY_NO", "184", None, None, "taluka"),
])
def test_resolution_to_state_jurisdiction_and_native_identifier(service, key, scheme, value, part, account, sub_type):
    entry = service.registry_entry(P[key])
    assert entry.state.code == key[0]
    assert entry.primary_identifier.scheme == scheme
    assert entry.primary_identifier.value == value and entry.primary_identifier.part == part
    assert entry.jurisdiction.sub_district_type == sub_type
    accounts = [(i.scheme, i.value) for i in entry.native_identifiers[1:]]
    assert accounts == ([account] if account else [])
    assert entry.source_reference.source_table == "core.parcel_registry"
    assert entry.source_reference.locator.endswith("seed/parcels.json#/" + str(int(key[1][1:]) - 1))
    assert entry.spatial_reference.source_table == "spatial.cadastral_parcels"


def test_linked_sources_reflect_state_specific_systems(service):
    up = {s.source_table: s.record_count for s in service.registry_entry(P[("UP", "P012")]).linked_sources}
    assert up["revenue_cadastral.bhu_naksha"] == 1 and up["revenue_land_records.khatauni"] == 1
    assert not any("property_card" in t for t in up), "UP has no Property Card system"
    gj = {s.source_table: s.record_count for s in service.registry_entry(P[("GJ", "P009")]).linked_sources}
    assert gj["city_survey.property_card"] == 1 and gj["e_dhara.vf7_12"] == 0


def test_ulpin_input_normalization(service):
    assert service.registry_entry("5831 0472 9615 38").ulpin == P[("MH", "P001")]
    assert service.registry_entry("58310472-961538").ulpin == P[("MH", "P001")]


def test_invalid_and_unknown_ulpins(service):
    with pytest.raises(InvalidUlpin):
        service.registry.resolve("12345")
    with pytest.raises(InvalidUlpin):
        service.registry.resolve("ABCDEFGHIJKLMN")
    with pytest.raises(UlpinNotFound):
        service.registry.resolve("00000000000000")


def test_ulpin_collision_across_states_is_reported_not_guessed(store, settings):
    from interop.service import LandStackService
    from interop.sources import InMemorySourceStore

    from .conftest import clone_state

    mh, gj = clone_state(store, "MH"), clone_state(store, "GJ")
    gj["core.parcel_registry"][0]["ulpin"] = mh["core.parcel_registry"][0]["ulpin"]
    svc = LandStackService(InMemorySourceStore({"MH": mh, "GJ": gj}), settings=settings)
    assert any(i["issue"] == "ulpin_collision" for i in svc.registry.issues)
    with pytest.raises(UlpinAmbiguous):
        svc.registry.resolve(mh["core.parcel_registry"][0]["ulpin"])

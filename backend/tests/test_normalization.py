"""Normalization: native records -> canonical representations, with provenance and native preserved."""
import json

import pytest

from .conftest import P


def _follow(settings, locator):
    path, pointer = locator.split("#/")
    doc = json.loads((settings.data_root / path).read_text(encoding="utf-8"))
    for part in pointer.split("/"):
        doc = doc[int(part)] if isinstance(doc, list) else doc[part]
    return doc


@pytest.mark.parametrize("state", ["MH", "UP", "GJ"])
def test_every_canonical_record_traces_back_to_its_unmodified_source_row(service, settings, state):
    for b in service.bundles(state):
        for r in b.all_records():
            p = r.provenance
            assert p.state_code == state and p.source_table and p.glossary_term_id and p.locator
            src = _follow(settings, p.locator)
            if p.source_table == "spatial.cadastral_parcels":
                src = {**src["properties"], "geometry": src["geometry"]}
            assert r.native == src, r.record_id


def test_maharashtra_712_8a_property_card(service):
    b = service.bundle(P[("MH", "P001")])
    ror = next(lr for lr in b.land_records if lr.native_record_type == "7/12")
    assert ror.record_class == "record_of_rights" and ror.area.value_ha == 1.82
    assert ror.holders[0].en == "Sandeep Patil" and ror.holders[0].native == "संदीप पाटील"
    assert ror.holders[0].language == "mr" and ror.land_use == "agricultural"
    assert ror.parcel_identifiers[0].model_dump() == {"scheme": "GAT_NO", "scheme_class": "revenue_survey_number",
                                                      "value": "142", "part": "2"}
    assert ror.jurisdiction.sub_district == "Mulshi" and ror.jurisdiction.sub_district_type == "taluka"
    holding = next(lr for lr in b.land_records if lr.native_record_type == "8A")
    assert holding.record_class == "holding_account"
    assert holding.native["cultivable_area"] == 1.729, "state-specific 8A fields preserved in native"
    urban = service.bundle(P[("MH", "P009")])
    card = next(lr for lr in urban.land_records if lr.native_record_type == "Property Card")
    assert card.record_class == "urban_property_record"
    assert card.area.native_value == 1800 and card.area.native_unit == "sqm" and card.area.value_ha == 0.18
    assert card.parcel_identifiers[0].scheme == "CTS_NO"


def test_maharashtra_ferfar_and_utilities(service):
    b = service.bundle(P[("MH", "P013")])
    (m,) = b.mutations
    assert (m.register_name, m.kind, m.basis, m.status) == ("Ferfar", "charge_creation", "registered_document", "pending")
    assert m.status_label.native == "प्रलंबित" and m.linked_document_no == "REG-MH-2038-0013"
    services = {u.service: u.status for u in b.utilities}
    assert services == {"electricity": "connected", "water": "not_available", "road_access": "available"}
    assert len({u.provenance.locator for u in b.utilities}) == 1, "one native row -> three canonical services"


def test_uttar_pradesh_khatauni_khasra_namantaran_varasat(service):
    b = service.bundle(P[("UP", "P013")])
    classes = {lr.native_record_type: lr.record_class for lr in b.land_records}
    assert classes == {"Khatauni": "record_of_rights", "Khasra": "plot_register"}
    khasra = next(lr for lr in b.land_records if lr.native_record_type == "Khasra")
    assert khasra.holders == [], "Khasra names no holders; none are invented"
    (m,) = b.mutations
    assert (m.native_record_type, m.kind, m.status) == ("Namantaran", "transfer", "pending")
    assert m.provenance.glossary_term_id == "UP.term.namantaran"
    v = service.bundle(P[("UP", "P015")]).mutations[0]
    assert (v.native_record_type, v.kind, v.status) == ("Varasat", "succession", "finalized")
    assert v.provenance.glossary_term_id == "UP.term.varasat"
    reg = service.bundle(P[("UP", "P001")]).registrations[0]
    assert reg.stamp_duty_inr == 122280.0 and reg.registration_fee_inr == 20380.0
    assert reg.document_type == "sale_deed" and reg.document_type_label.native == "विक्रय विलेख"


def test_uttar_pradesh_has_no_property_card(service):
    for b in service.bundles("UP"):
        assert not any(lr.record_class == "urban_property_record" for lr in b.land_records)


def test_gujarat_vf712_vf8a_vf6_property_card(service):
    b = service.bundle(P[("GJ", "P013")])
    types = {lr.native_record_type for lr in b.land_records}
    assert types == {"VF 7/12", "VF 8A"}
    vf712 = next(lr for lr in b.land_records if lr.native_record_type == "VF 7/12")
    assert vf712.encumbrance_noted is False and vf712.account_identifiers[0].scheme == "ROR_NO"
    (m,) = b.mutations
    assert (m.register_name, m.kind, m.status) == ("VF 6", "transfer", "pending")
    assert m.status_label.native == "બાકી"
    card = next(lr for lr in service.bundle(P[("GJ", "P009")]).land_records)
    assert card.native_record_type == "Property Card" and card.parcel_identifiers[0].scheme == "CITY_SURVEY_NO"
    assert card.area.value_ha == 0.165


def test_ownership_claims_are_derived_not_invented(service):
    b = service.bundle(P[("GJ", "P011")])
    roles = sorted((c.role, c.party.en, c.native_record_type) for c in b.ownership)
    assert roles == [
        ("recorded_holder", "Rahul Patel", "VF 7/12"),
        ("recorded_holder", "Rahul Patel", "VF 8A"),
        ("registered_transferee", "Vinod Shah", "Registered document"),
        ("registered_transferor", "Synthetic Seller", "Registered document"),
    ]


def test_litigation_derived_from_encumbrance_flag(service):
    b = service.bundle(P[("UP", "P014")])
    (lit,) = b.litigation
    assert lit.case_reference == "MOCK-RCCMS-014" and lit.related_reference_no == "MTG-UP-014"
    assert lit.provenance.glossary_term_id == "UP.term.litigation_flag"


def test_normalization_is_deterministic(service, store, settings):
    from interop.service import LandStackService
    other = LandStackService(store, settings=settings)
    for u in P.values():
        assert service.bundle(u).model_dump() == other.bundle(u).model_dump()

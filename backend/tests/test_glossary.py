"""Semantic glossary: deterministic, explainable mapping of state terminology to canonical concepts."""
import copy

import pytest

from interop.adapters import ADAPTERS
from interop.glossary import Glossary, GlossaryError, default_glossary


@pytest.fixture(scope="module")
def g() -> Glossary:
    return default_glossary()


@pytest.mark.parametrize("state,term,concept,canonical_class", [
    ("MH", "Ferfar", "mutation", "mutation_entry"),
    ("MH", "फेरफार", "mutation", "mutation_entry"),
    ("UP", "Namantaran", "mutation", "mutation_entry"),
    ("UP", "नामान्तरण", "mutation", "mutation_entry"),
    ("GJ", "VF 6", "mutation", "mutation_entry"),
    ("GJ", "VF6", "mutation", "mutation_entry"),
    ("GJ", "Hakk Patrak", "mutation", "mutation_entry"),
    ("MH", "7/12", "land_record", "record_of_rights"),
    ("MH", "सातबारा उतारा", "land_record", "record_of_rights"),
    ("UP", "Khatauni", "land_record", "record_of_rights"),
    ("GJ", "VF 7/12", "land_record", "record_of_rights"),
    ("MH", "8A", "land_record", "holding_account"),
    ("GJ", "VF 8A", "land_record", "holding_account"),
    ("UP", "Khasra", "land_record", "plot_register"),
    ("UP", "BhuNaksha", "geometry", "cadastral_map"),
    ("MH", "Property Card", "land_record", "urban_property_record"),
])
def test_state_terms_map_to_canonical_concepts(g, state, term, concept, canonical_class):
    hits = g.find(term, state)["terms"]
    assert hits, f"{term} not found for {state}"
    assert {(t["concept"], t["canonical_class"]) for t in hits} == {(concept, canonical_class)}


@pytest.mark.parametrize("state,en,native,canonical", [
    ("MH", "Disposed", "निकाली", "finalized"),
    ("UP", "Disposed", "निस्तारित", "finalized"),
    ("GJ", "Certified", "પ્રમાણિત", "finalized"),
    ("GJ", "Pending", "બાકી", "pending"),
])
def test_mutation_status_equivalence_across_states(g, state, en, native, canonical):
    m = g.resolve(state, "mutation_status", "status_en", en, native)
    assert m.canonical == canonical and m.matched_on == "en+native" and m.entry_id.startswith(state)


@pytest.mark.parametrize("state,en,native,canonical", [
    ("MH", "Heirship Entry", "वारस नोंद", "succession"),
    ("UP", "Varasat", "वरासत", "succession"),
    ("GJ", "Inheritance", "વારસાઈ", "succession"),
    ("MH", "Registered Sale", "खरेदीखत", "transfer_sale"),
    ("UP", "Namantaran", "नामान्तरण", "transfer"),
    ("GJ", "Right Transfer", "હક હસ્તાંતરણ", "transfer"),
])
def test_mutation_kind_equivalence_across_states(g, state, en, native, canonical):
    assert g.resolve(state, "mutation_kind", "k", en, native).canonical == canonical


def test_broader_relation(g):
    assert g.broader("mutation_kind", "transfer_sale") == "transfer"
    assert g.broader("mutation_kind", "succession") == "succession"


def test_resolution_is_exact_not_fuzzy(g):
    assert g.resolve("MH", "mutation_status", "s", "  disposed ").canonical == "finalized"  # normalization only
    assert g.resolve("MH", "mutation_status", "s", "Disposd").matched_on == "unmapped"
    assert g.resolve("MH", "mutation_status", "s", "Certified").matched_on == "unmapped"  # GJ-only term
    assert g.resolve("MH", "mutation_status", "s", None).matched_on == "absent"


def test_conflicting_english_and_native_values_are_flagged(g):
    m = g.resolve("MH", "mutation_status", "status_en", "Disposed", "प्रलंबित")
    assert m.matched_on == "conflict" and m.canonical is None


def test_state_scoped_entries_take_precedence_and_are_reported(g):
    m = g.resolve("UP", "document_type", "document_type_en", "Sale Deed", "विक्रय विलेख")
    assert m.entry_id == "UP.document_type.sale_deed"
    m = g.resolve("MH", "document_type", "document_type", "Sale Deed")
    assert m.entry_id == "ALL.document_type.sale_deed"


def test_every_adapter_source_is_described_by_a_glossary_term(g):
    for code, cls in ADAPTERS.items():
        for spec in cls.specs:
            term = g.term(spec.term_id)
            assert term["state"] == code
            assert term["source_table"] == spec.table


def test_every_native_value_in_the_dataset_resolves(service):
    bad = []
    for b in service.bundles():
        for m in b.identity.term_mappings:
            if m.matched_on in ("unmapped", "conflict"):
                bad.append((b.identity.ulpin, m))
        for r in b.all_records():
            bad += [(r.record_id, m) for m in r.term_mappings if m.matched_on in ("unmapped", "conflict")]
    assert bad == []


def test_concept_view_lists_terms_per_state(g):
    view = g.concept_view("mutation")
    names = {s: {t["term"] for t in ts} for s, ts in view["terms_by_state"].items()}
    assert "Ferfar" in names["MH"] and "Namantaran" in names["UP"] and "VF 6" in names["GJ"]
    assert "mutation_kind" in view["vocabularies"] and "mutation_kind_document_type" in view["compatibility"]


def test_integrity_errors_are_rejected(g):
    doc = copy.deepcopy(g.doc)
    doc["vocabularies"]["mutation_status"]["entries"].append(
        {"id": "MH.bad", "state": "MH", "en": "Disposed", "canonical": "pending"})
    with pytest.raises(GlossaryError):
        Glossary(doc)
    doc = copy.deepcopy(g.doc)
    doc["vocabularies"]["mutation_status"]["entries"][0]["canonical"] = "not_a_code"
    with pytest.raises(GlossaryError):
        Glossary(doc)

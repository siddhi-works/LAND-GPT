"""Machine-readable semantic glossary and deterministic term resolver.

Resolution algorithm (fully reproducible):

1. Normalize the English/transliterated value and the native-script value with
   :func:`interop.normalize.norm_term` (NFKC, casefold, whitespace collapse).
2. Look each up in the vocabulary's index for the record's state; if absent, in the
   state-agnostic ('*') index.
3. If both values resolve and disagree -> ``conflict`` (canonical = None).
   If one resolves -> that entry. If a value is present but nothing resolves -> ``unmapped``.

There is no fuzzy matching, ranking or model inference anywhere in this module.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..canonical.model import CONCEPTS, TermMapping
from ..normalize import norm_term

GLOSSARY_PATH = Path(__file__).with_name("glossary.json")


class GlossaryError(ValueError):
    pass


class Glossary:
    def __init__(self, doc: dict[str, Any]):
        self.doc = doc
        self.version: str = doc["version"]
        self.concepts: dict[str, dict] = doc["concepts"]
        self.terms: list[dict] = doc["terms"]
        self.vocabularies: dict[str, dict] = doc["vocabularies"]
        self.compatibility: dict[str, dict] = doc.get("compatibility", {})
        self._terms_by_id = {t["id"]: t for t in self.terms}
        self._terms_by_table: dict[tuple[str, str], dict] = {}
        self._index: dict[tuple[str, str], dict[str, dict]] = {}
        self._validate_and_index()

    # -- construction -------------------------------------------------------------------
    @classmethod
    def load(cls, path: Path = GLOSSARY_PATH) -> "Glossary":
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def _validate_and_index(self) -> None:
        errors: list[str] = []
        if set(self.concepts) != set(CONCEPTS):
            errors.append(f"concepts {sorted(self.concepts)} differ from canonical model {sorted(CONCEPTS)}")
        seen: set[str] = set()
        for t in self.terms:
            if t["id"] in seen:
                errors.append(f"duplicate term id {t['id']}")
            seen.add(t["id"])
            if t["concept"] not in self.concepts:
                errors.append(f"term {t['id']}: unknown concept {t['concept']}")
            if t.get("source_table") and t["state"] != "*":
                key = (t["state"], t["source_table"])
                # the first term declared for a table is its primary record-type term
                self._terms_by_table.setdefault(key, t)
        for vname, vocab in self.vocabularies.items():
            if vocab.get("concept") not in self.concepts:
                errors.append(f"vocabulary {vname}: unknown concept {vocab.get('concept')}")
            codes = set(vocab["canonical_values"])
            for broader_from, broader_to in vocab.get("broader", {}).items():
                if broader_from not in codes or broader_to not in codes:
                    errors.append(f"vocabulary {vname}: broader relation uses unknown code")
            for e in vocab["entries"]:
                if e["id"] in seen:
                    errors.append(f"duplicate entry id {e['id']}")
                seen.add(e["id"])
                if e["canonical"] not in codes:
                    errors.append(f"{e['id']}: canonical '{e['canonical']}' not declared in {vname}")
                for value in (e.get("en"), e.get("native")):
                    key = norm_term(value)
                    if key is None:
                        continue
                    bucket = self._index.setdefault((vname, e["state"]), {})
                    prior = bucket.get(key)
                    if prior and prior["canonical"] != e["canonical"]:
                        errors.append(f"{vname}/{e['state']}: '{value}' maps to both {prior['canonical']} and {e['canonical']}")
                    bucket.setdefault(key, e)
        for cname, comp in self.compatibility.items():
            left = set(self.vocabularies[comp["left_vocabulary"]]["canonical_values"])
            right = set(self.vocabularies[comp["right_vocabulary"]]["canonical_values"])
            for k, allowed in comp["matrix"].items():
                if k not in left or not set(allowed) <= right:
                    errors.append(f"compatibility {cname}: row {k} references undeclared codes")
        if errors:
            raise GlossaryError("; ".join(errors))

    # -- resolution ---------------------------------------------------------------------
    def _lookup(self, vocabulary: str, state: str, value: Any) -> dict | None:
        key = norm_term(value)
        if key is None:
            return None
        for scope in (state, "*"):
            hit = self._index.get((vocabulary, scope), {}).get(key)
            if hit:
                return hit
        return None

    def resolve(self, state: str, vocabulary: str, field: str, value: Any, native_value: Any = None) -> TermMapping:
        if vocabulary not in self.vocabularies:
            raise GlossaryError(f"unknown vocabulary {vocabulary}")
        en_hit = self._lookup(vocabulary, state, value)
        nat_hit = self._lookup(vocabulary, state, native_value)
        common = dict(field=field, vocabulary=vocabulary, native_value=value, native_script_value=native_value)
        if value is None and native_value is None:
            return TermMapping(**common, matched_on="absent")
        if en_hit and nat_hit and en_hit["canonical"] != nat_hit["canonical"]:
            return TermMapping(**common, matched_on="conflict")
        hit = en_hit or nat_hit
        if not hit:
            return TermMapping(**common, matched_on="unmapped")
        matched = "en+native" if (en_hit and nat_hit) else ("en" if en_hit else "native")
        return TermMapping(**common, canonical=hit["canonical"], entry_id=hit["id"], matched_on=matched)

    # -- accessors ----------------------------------------------------------------------
    def term(self, term_id: str) -> dict:
        return self._terms_by_id[term_id]

    def term_for_table(self, state: str, table: str) -> dict | None:
        return self._terms_by_table.get((state, table))

    def unit_factor(self, canonical_unit: str | None) -> float | None:
        factors = self.vocabularies["area_unit"].get("factor_to_hectare", {})
        return factors.get(canonical_unit) if canonical_unit else None

    def broader(self, vocabulary: str, code: str | None) -> str | None:
        if code is None:
            return None
        return self.vocabularies[vocabulary].get("broader", {}).get(code, code)

    def compat(self, name: str) -> tuple[dict[str, list[str]], set[str]]:
        comp = self.compatibility[name]
        return comp["matrix"], set(comp.get("not_evaluated", []))

    def concept_view(self, concept: str) -> dict | None:
        if concept not in self.concepts:
            return None
        by_state: dict[str, list[dict]] = {}
        for t in self.terms:
            if t["concept"] == concept:
                by_state.setdefault(t["state"], []).append(t)
        vocabs = {
            name: {
                "description": v["description"],
                "canonical_values": v["canonical_values"],
                "broader": v.get("broader", {}),
                "entries": v["entries"],
            }
            for name, v in self.vocabularies.items()
            if v["concept"] == concept
        }
        comps = {
            name: c for name, c in self.compatibility.items()
            if self.vocabularies[c["left_vocabulary"]]["concept"] == concept
            or self.vocabularies[c["right_vocabulary"]]["concept"] == concept
        }
        return {
            "concept": concept,
            **self.concepts[concept],
            "terms_by_state": dict(sorted(by_state.items())),
            "vocabularies": vocabs,
            "compatibility": comps,
        }

    def find(self, text: str, state: str | None = None) -> dict:
        """Exact (normalized) lookup of a native term or value across terms and vocabularies."""
        key = norm_term(text)
        terms = []
        for t in self.terms:
            if state and t["state"] not in (state, "*"):
                continue
            names = [t["term"], t.get("native_script"), *t.get("aliases", [])]
            if key in {norm_term(n) for n in names if n}:
                terms.append(t)
        values = []
        for vname, v in self.vocabularies.items():
            for e in v["entries"]:
                if state and e["state"] not in (state, "*"):
                    continue
                if key in {norm_term(e.get("en")), norm_term(e.get("native"))}:
                    values.append({"vocabulary": vname, "concept": v["concept"], **e})
        return {"query": text, "normalized": key, "state": state, "terms": terms, "values": values}


@lru_cache(maxsize=1)
def default_glossary() -> Glossary:
    return Glossary.load()

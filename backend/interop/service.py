"""Application service: the single entry point used by the API (and tests).

store -> state adapters -> canonical bundles (glossary-normalized) -> validation.
All results are derived and cached in memory; source data is never modified.
"""
from __future__ import annotations

import threading

from .adapters import ADAPTERS, StateAdapter
from .canonical.model import ParcelBundle
from .config import Settings
from .glossary import Glossary, default_glossary
from .registry import RegistryEntry, UlpinRegistry
from .sources.base import SourceStore
from .validation import VerificationReport, build_state_index, verify
from .validation.rules import StateIndex


class LandStackService:
    def __init__(self, store: SourceStore, *, glossary: Glossary | None = None, settings: Settings | None = None):
        self.store = store
        self.settings = settings or Settings.from_env()
        self.glossary = glossary or default_glossary()
        self.adapters: dict[str, StateAdapter] = {
            code: cls(store, self.glossary) for code, cls in ADAPTERS.items() if code in store.states()
        }
        self.registry = UlpinRegistry(self.adapters)
        self._lock = threading.Lock()
        self._bundles: dict[str, ParcelBundle] = {}
        self._indexes: dict[str, StateIndex] = {}
        self._reports: dict[str, VerificationReport] = {}

    # -- canonical ----------------------------------------------------------------------
    def bundle(self, ulpin: str) -> ParcelBundle:
        adapter, ident = self.registry.resolve(ulpin)
        cached = self._bundles.get(ident.ulpin)
        if cached is None:
            cached = adapter.build(ident)
            with self._lock:
                self._bundles.setdefault(ident.ulpin, cached)
        return self._bundles[ident.ulpin]

    def bundles(self, state_code: str | None = None) -> list[ParcelBundle]:
        return [self.bundle(i.ulpin) for i in self.registry.identities(state_code)]

    def registry_entry(self, ulpin: str) -> RegistryEntry:
        return self.registry.entry(ulpin)

    def supported_concepts(self, state_code: str) -> set[str]:
        return self.adapters[state_code].supported_concepts()

    # -- validation ---------------------------------------------------------------------
    def state_index(self, state_code: str) -> StateIndex:
        idx = self._indexes.get(state_code)
        if idx is None:
            idx = build_state_index(self.bundles(state_code))
            with self._lock:
                self._indexes.setdefault(state_code, idx)
        return self._indexes[state_code]

    def verification(self, ulpin: str) -> VerificationReport:
        b = self.bundle(ulpin)
        report = self._reports.get(b.identity.ulpin)
        if report is None:
            report = verify(b, glossary=self.glossary, tolerances=self.settings.tolerances,
                            as_of=self.settings.as_of, index=self.state_index(b.identity.state_code))
            with self._lock:
                self._reports.setdefault(b.identity.ulpin, report)
        return self._reports[b.identity.ulpin]

    def verifications(self, state_code: str | None = None) -> list[VerificationReport]:
        return [self.verification(i.ulpin) for i in self.registry.identities(state_code)]

    def warm(self) -> None:
        self.verifications()

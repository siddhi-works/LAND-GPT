"""Runtime configuration. Tolerances are explicit so every validation outcome is explainable."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

ENGINE_VERSION = "1.0.0"
API_VERSION = "v1"

# backend/interop/config.py -> repository root is two levels above backend/
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_ROOT = REPO_ROOT / "landstack"


@dataclass(frozen=True)
class Tolerances:
    # Two textual records (7/12 vs 8A, Khatauni vs Khasra ...) must agree to within 10 m^2.
    textual_area_abs_ha: float = 0.001
    # Map/GIS area vs recorded area: relative difference allowed before flagging.
    gis_area_rel: float = 0.05
    # Above this relative difference a GIS/record mismatch is escalated to high severity.
    gis_area_rel_high: float = 0.20
    # Registry-declared GIS area vs area computed from the polygon.
    declared_vs_computed_rel: float = 0.02
    # Pending mutation older than this (days since registration) is escalated to high severity.
    mutation_lag_days_high: int = 90
    # Registered consideration / tax-assessed value outside [low, high] is flagged.
    consideration_ratio_low: float = 0.1
    consideration_ratio_high: float = 10.0
    # Rupee rounding tolerance for tax arithmetic.
    money_abs: float = 0.5


@dataclass(frozen=True)
class Settings:
    data_root: Path = DEFAULT_DATA_ROOT
    as_of: date = field(default_factory=date.today)
    tolerances: Tolerances = field(default_factory=Tolerances)

    @classmethod
    def from_env(cls) -> "Settings":
        root = Path(os.environ.get("LANDSTACK_DATA_ROOT", str(DEFAULT_DATA_ROOT)))
        as_of_raw = os.environ.get("LANDSTACK_AS_OF")
        as_of = date.fromisoformat(as_of_raw) if as_of_raw else date.today()
        return cls(data_root=root, as_of=as_of)

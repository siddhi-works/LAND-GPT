from .base import REGISTRY_TABLE, SPATIAL_TABLE, SourceSpec, StateAdapter
from .gujarat import GujaratAdapter
from .maharashtra import MaharashtraAdapter
from .uttar_pradesh import UttarPradeshAdapter

ADAPTERS: dict[str, type[StateAdapter]] = {
    MaharashtraAdapter.state_code: MaharashtraAdapter,
    UttarPradeshAdapter.state_code: UttarPradeshAdapter,
    GujaratAdapter.state_code: GujaratAdapter,
}

__all__ = [
    "ADAPTERS",
    "REGISTRY_TABLE",
    "SPATIAL_TABLE",
    "SourceSpec",
    "StateAdapter",
    "MaharashtraAdapter",
    "UttarPradeshAdapter",
    "GujaratAdapter",
]
